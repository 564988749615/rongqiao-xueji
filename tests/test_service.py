"""Integration checks for real import, persistence, restore and export."""
import base64
import copy
import io
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import openpyxl
import server


class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory(prefix='zhixu-service-test-')
        server.DATA = Path(cls.folder.name)
        server.init_db()
        class Quiet(server.Handler):
            def log_message(self, *args):
                pass
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.httpd.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        cls.folder.cleanup()

    def setUp(self):
        with server.db() as conn:
            conn.execute('DELETE FROM notes')
            conn.execute('DELETE FROM exams')

    def call(self, path, body=None, raw=False, extra=None):
        headers = {'Content-Type':'application/json'}
        headers.update(extra or {})
        request = Request(self.base+path, headers=headers,
                          data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
        with urlopen(request, timeout=20) as response:
            value = response.read()
            return value if raw else json.loads(value)

    def imported(self, suffix='一', content=None):
        content = content or '班级,学号,姓名,语文,数学\n01,001,测试甲,100,100\n01,002,测试乙,90,90\n02,003,测试丙,90,90\n02,004,测试丁,80,80\n'
        return self.call('/api/import', dict(filename='测试.csv', content=base64.b64encode(content.encode()).decode(),
                         metadata=dict(name='检测'+suffix, grade='初三', date='2026-10-19')))

    def test_import_analyze_save_reload_notes_archive_restore(self):
        d = self.imported()
        a = self.call('/api/analyze', dict(dataset=d, rules={'cutoff_ratio':.5}))
        self.assertEqual(a['summary']['elite_count'], 3)
        saved = self.call('/api/exams', dict(dataset=d, rules=a['rules']))
        self.assertEqual(saved['row_count'], 4)
        reloaded = self.call('/api/exams/'+d['id'])
        self.assertEqual(reloaded['dataset'], d)
        self.assertEqual(reloaded['rules']['cutoff_ratio'], .5)
        server.init_db()  # Reopen database; existing rows remain intact.
        self.assertEqual(len(self.call('/api/exams')['exams']),1)
        note = self.call('/api/notes', dict(exam_id=d['id'], **{'class':'01'}, text='下周核对学科支持计划。'))
        self.assertEqual(self.call('/api/notes?exam_id='+d['id'])['notes'][0], note)
        self.call('/api/exams/'+d['id']+'/archive', {})
        self.assertEqual(self.call('/api/exams')['exams'], [])
        self.assertEqual(len(self.call('/api/exams?archived=1')['exams']),1)
        self.call('/api/exams/'+d['id']+'/restore', {})
        self.assertEqual(len(self.call('/api/exams')['exams']),1)

    def test_import_preview_and_save_validation(self):
        content = '班级,学号,姓名,语文,数学\n01,001,测试甲,88,缺考\n01,002,测试乙,90,91\n'
        preview = self.call('/api/import', dict(
            filename='核验.csv',
            content=base64.b64encode(content.encode()).decode(),
            metadata=dict(name='核验考试', grade='初三', date='2026-10-20'),
        ))
        self.assertEqual(preview['mapping']['identity'], '稳定学号')
        self.assertEqual(preview['mapping']['header_row'], 1)
        self.assertEqual(preview['mapping']['subjects'], {'语文': 4, '数学': 5})
        self.assertTrue(any('缺失或无效成绩' in item['message'] for item in preview['warnings']))
        self.assertEqual(self.call('/api/exams')['exams'], [])
        saved = self.call('/api/exams', dict(dataset=preview))
        self.assertEqual(saved['name'], '核验考试')
        reloaded = self.call('/api/exams/' + preview['id'])
        self.assertEqual(reloaded['dataset']['mapping'], preview['mapping'])

    def test_school_never_merges_scores_across_grades(self):
        a=self.imported()
        b=self.imported('二', '班级,学号,语文\n01,901,50\n')
        b['grade']='初一'
        self.call('/api/exams', dict(dataset=a))
        self.call('/api/exams', dict(dataset=b))
        school=self.call('/api/school')
        self.assertEqual(school['totals'],dict(grades=2,classes=3,registered=5,participants=5))
        self.assertNotIn('mean',school['totals'])
        self.assertEqual(len(school['grades']),2)

    def test_backup_restore_is_idempotent_and_invalid_restore_is_atomic(self):
        d=self.imported()
        self.call('/api/exams',dict(dataset=d))
        self.call('/api/notes',dict(exam_id=d['id'],text='保留记录'))
        backup=self.call('/api/backup')
        self.assertEqual(self.call('/api/restore',dict(backup=backup))['count'],0)
        with server.db() as conn:
            conn.execute('DELETE FROM notes');conn.execute('DELETE FROM exams')
        self.assertEqual(self.call('/api/restore',dict(backup=backup))['count'],1)
        self.assertEqual(len(self.call('/api/notes?exam_id='+d['id'])['notes']),1)
        bad=copy.deepcopy(backup)
        bad['exams'][0]['id']='new-test'
        bad['exams'][0]['dataset']['id']='new-test'
        bad['notes'][0]['text']=123
        with self.assertRaises(HTTPError) as caught:
            self.call('/api/restore',dict(backup=bad))
        self.assertEqual(caught.exception.code,400)
        self.assertEqual(len(self.call('/api/exams')['exams']),1)

    def test_history_weights_missing_and_anon(self):
        ids=[]
        for i,content in enumerate([
            '班级,学号,姓名,语文\n01,001,测试甲,80\n01,002,测试乙,100\n',
            '班级,学号,姓名,语文\n01,001,测试甲,100\n01,002,测试乙,80\n',
            '班级,学号,姓名,语文\n01,001,测试甲,80\n01,002,测试乙,100\n',
        ]):
            d=self.imported(str(i),content);d['date']=f'2026-10-{i+1:02d}'
            self.call('/api/exams',dict(dataset=d));ids.append(d['id'])
        h=self.call('/api/history',dict(grade='初三',weights={ids[0]:1,ids[1]:2,ids[2]:3}))
        first=next(s for s in h['students'] if s['id']=='student:001')
        self.assertEqual(first['attempts'],3)
        self.assertEqual(first['mean'],1.67)
        self.assertEqual(first['trimmed'],2)
        self.assertEqual(first['weighted'],1.67)
        a=self.imported('匿名','班级,语文\n01,70\n');self.call('/api/exams',dict(dataset=a))
        h=self.call('/api/history',dict(grade='初三'))
        self.assertEqual(len(h['students']),2)
        self.assertTrue(any('没有姓名' in x for x in h['warnings']))

    def test_history_selected_exams_and_growth(self):
        ids = []
        contents = [
            '班级,学号,姓名,语文,数学\n01,001,测试甲,80,90\n01,002,测试乙,70,80\n',
            '班级,学号,姓名,语文,数学\n02,001,测试甲,90,95\n01,002,测试乙,75,85\n',
            '班级,学号,姓名,语文,数学\n02,001,测试甲,95,98\n01,002,测试乙,80,88\n',
        ]
        for i, content in enumerate(contents, 1):
            dataset = self.imported(str(i), content)
            dataset['date'] = f'2026-10-{i:02d}'
            self.call('/api/exams', dict(dataset=dataset))
            ids.append(dataset['id'])
        history = self.call('/api/history', dict(grade='初三', exam_ids=ids[1:]))
        self.assertEqual(history['selected_exam_ids'], ids[1:])
        self.assertEqual([item['id'] for item in history['exams']], ids[1:])
        student = next(item for item in history['students'] if item['id'] == 'student:001')
        self.assertEqual(student['attempts'], 2)
        self.assertEqual([item['class'] for item in student['history']], ['02', '02'])
        self.assertEqual(student['history'][0]['total'], 185)
        self.assertEqual(student['history'][0]['scores']['语文'], 90)
        self.assertIn('subject_trends', history)

    def test_history_stable_id_survives_class_transfer(self):
        first = self.imported('转班前', '班级,学号,姓名,语文\n01,001,测试甲,80\n')
        second = self.imported('转班后', '班级,学号,姓名,语文\n02,001,测试甲,90\n')
        first['date'], second['date'] = '2026-10-01', '2026-10-08'
        self.call('/api/exams', dict(dataset=first))
        self.call('/api/exams', dict(dataset=second))
        history = self.call('/api/history', dict(grade='初三', exam_ids=[first['id'], second['id']]))
        self.assertEqual(len(history['students']), 1)
        student = history['students'][0]
        self.assertEqual(student['id'], 'student:001')
        self.assertEqual([item['class'] for item in student['history']], ['01', '02'])

    def test_export_is_real_xlsx_with_safe_text(self):
        d=self.imported(content='班级,姓名,语文\n01,=1+1,90\n')
        a=self.call('/api/analyze',dict(dataset=d))
        data=self.call('/api/export/xlsx',dict(analysis=a),raw=True)
        wb=openpyxl.load_workbook(io.BytesIO(data),data_only=False)
        self.assertGreaterEqual(len(wb.sheetnames),9)
        self.assertEqual(wb['成绩与排名']['C6'].data_type,'s')
        self.assertEqual(wb['成绩与排名']['C6'].value,"'=1+1")
        self.assertEqual(wb['成绩与排名']['D6'].value,90)
        self.assertTrue(wb['成绩与排名'].print_area)

    def test_rejects_cross_origin_write_and_keeps_data(self):
        with self.assertRaises(HTTPError) as caught:
            self.call('/api/exams', {}, extra={'Origin':'https://unrelated.example'})
        self.assertEqual(caught.exception.code,403)
        self.assertEqual(self.call('/api/exams')['exams'],[])

    def test_real_input_api_and_saved_rule_change(self):
        d=self.call('/api/example')
        self.assertEqual(len(d['rows']),967)
        self.call('/api/exams',dict(dataset=d))
        r={'classes':[str(x).zfill(2) for x in range(1,21)]}
        self.call('/api/exams/'+d['id']+'/rules',dict(rules=r))
        a=self.call('/api/analyze',dict(exam_id=d['id']))
        self.assertEqual(a['summary']['participants'],878)
        self.assertEqual(a['summary']['cutoff'],527)
        self.assertEqual(len(a['classes']),20)


if __name__=='__main__':
    unittest.main()
