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
            conn.execute('DELETE FROM teachers')
            conn.execute('DELETE FROM notes')
            conn.execute('DELETE FROM exams')
            conn.execute('DELETE FROM settings')
        server.invalidate_cache()

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
        note2 = self.call('/api/notes', dict(exam_id=d['id'], **{'class':'02'}, text='最新一条跟进记录。'))
        notes = self.call('/api/notes?exam_id='+d['id'])['notes']
        self.assertEqual([n['id'] for n in notes], [note2['id'], note['id']])
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
        self.assertEqual(first['composite'],1.78)
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

    def test_edit_exam_meta_delete_archived_and_note_crud(self):
        d = self.imported()
        self.call('/api/exams', dict(dataset=d))
        updated = self.call('/api/exams/' + d['id'] + '/meta', dict(name='初2027届阶段一', grade='初2027届', date='2026-11-20'))
        self.assertEqual((updated['name'], updated['grade'], updated['date']), ('初2027届阶段一', '初2027届', '2026-11-20'))
        note = self.call('/api/notes', dict(exam_id=d['id'], **{'class': '01'}, text='初始跟进记录'))
        edited = self.call('/api/notes/' + note['id'] + '/update', dict(**{'class': '02'}, text='已修改的跟进记录'))
        self.assertEqual(edited['class'], '02')
        self.assertEqual(edited['text'], '已修改的跟进记录')
        self.call('/api/notes/' + note['id'] + '/delete', {})
        self.assertEqual(self.call('/api/notes?exam_id=' + d['id'])['notes'], [])
        with self.assertRaises(HTTPError) as caught:
            self.call('/api/exams/' + d['id'] + '/delete', {})
        self.assertEqual(caught.exception.code, 400)
        self.call('/api/exams/' + d['id'] + '/archive', {})
        self.call('/api/exams/' + d['id'] + '/delete', {})
        self.assertEqual(self.call('/api/exams?archived=1')['exams'], [])

    def test_legacy_db_migration_and_cache_invalidation(self):
        legacy_dir = tempfile.TemporaryDirectory(prefix='zhixu-legacy-test-')
        old_data = server.DATA
        try:
            server.DATA = Path(legacy_dir.name)
            with server.db() as conn:
                conn.executescript('''
                  CREATE TABLE exams (
                    id TEXT PRIMARY KEY, dataset TEXT NOT NULL, rules TEXT NOT NULL,
                    archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                  );
                  CREATE TABLE notes (
                    id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id),
                    class_name TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, created_at TEXT NOT NULL
                  );
                ''')
                legacy_ds = {
                    'id': 'legacy-1', 'name': '旧库考试', 'grade': '初2027届', 'date': '2026-09-15',
                    'filename': 'old.xlsx', 'imported_at': '2026-09-15T08:00:00+08:00',
                    'subjects': ['语文'], 'classes': ['01'], 'warnings': [],
                    'rows': [{'id': 'student:1', 'source_row': 2, 'class': '01', 'name': '甲', 'scores': {'语文': 95}, 'identity_reliable': True}],
                }
                conn.execute(
                    'INSERT INTO exams VALUES(?,?,?,?,?,?)',
                    ('legacy-1', server.encode(legacy_ds), '{}', 0, '2026-09-15T00:00:00+00:00', '2026-09-15T00:00:00+00:00'),
                )
            server.init_db()
            with server.db() as conn:
                row = conn.execute('SELECT * FROM exams WHERE id=?', ('legacy-1',)).fetchone()
            self.assertEqual(row['name'], '旧库考试')
            self.assertEqual(row['grade'], '初2027届')
            self.assertEqual(row['row_count'], 1)
            self.assertEqual(row['subject_count'], 1)
        finally:
            server.DATA = old_data
            server.invalidate_cache()
            legacy_dir.cleanup()

        d = self.imported()
        self.call('/api/exams', dict(dataset=d))
        first = self.call('/api/analyze', dict(exam_id=d['id']))
        self.assertEqual(first['summary']['participants'], 4)
        self.call('/api/exams/' + d['id'] + '/rules', dict(rules={'classes': ['01']}))
        second = self.call('/api/analyze', dict(exam_id=d['id']))
        self.assertEqual(second['summary']['participants'], 2)
        self.call('/api/exams/' + d['id'] + '/meta', dict(name='同秒改名', grade='初三', date='2026-10-19'))
        third = self.call('/api/analyze', dict(exam_id=d['id']))
        self.assertEqual(third['metadata']['name'], '同秒改名')

    def test_shutdown_endpoint_stops_dedicated_server(self):
        class Quiet(server.Handler):
            def log_message(self, *args):
                pass
        temp_httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
        temp_thread = threading.Thread(target=temp_httpd.serve_forever, daemon=True)
        temp_thread.start()
        try:
            url = f'http://127.0.0.1:{temp_httpd.server_port}/api/shutdown'
            req = Request(url, headers={'Content-Type': 'application/json'}, data=b'{}')
            with urlopen(req, timeout=5) as resp:
                body = json.loads(resp.read())
            self.assertTrue(body['ok'])
            temp_thread.join(timeout=3)
            self.assertFalse(temp_thread.is_alive())
        finally:
            temp_httpd.server_close()

    def test_class_brief_dual_line_teachers_flow_and_templates(self):
        exam1_csv = (
            '班级,学号,姓名,语文,数学,英语\n'
            '01,S01,甲一,130,140,135\n'
            '01,S02,甲二,120,130,125\n'
            '01,S03,甲三,115,105,120\n'
            '01,S04,甲四,100,95,90\n'
            '01,S05,甲五,85,80,75\n'
            '02,S06,乙一,128,138,130\n'
            '02,S07,乙二,118,125,115\n'
            '02,S08,乙三,108,110,105\n'
            '02,S09,乙四,95,90,88\n'
            '02,S10,乙五,80,72,70\n'
        )
        exam2_csv = (
            '班级,学号,姓名,语文,数学,英语\n'
            '01,S01,甲一,132,142,138\n'
            '01,S02,甲二,105,102,108\n'
            '01,S03,甲三,126,132,128\n'
            '01,S04,甲四,118,116,114\n'
            '01,S05,甲五,86,82,78\n'
            '02,S06,乙一,130,139,133\n'
            '02,S07,乙二,122,127,120\n'
            '02,S08,乙三,110,112,106\n'
            '02,S09,乙四,94,88,86\n'
            '02,S10,乙五,78,70,68\n'
        )
        d1 = self.imported('初一上半期', exam1_csv)
        d1['name'], d1['date'] = '初一上半期', '2026-10-01'
        d2 = self.imported('初一上期末', exam2_csv)
        d2['name'], d2['date'] = '初一上期末', '2026-11-01'
        self.call('/api/exams', dict(dataset=d1))
        self.call('/api/exams', dict(dataset=d2))

        teacher_csv = (
            '考试名称,班级,班主任,语文,数学,英语\n'
            '初一上半期,01,周老师,周老师,张老师,王老师\n'
            '初一上半期,02,李老师,陈老师,张老师,赵老师\n'
            '初一上期末,01,周老师,周老师,张老师,刘老师\n'
            '初一上期末,02,李老师,陈老师,张老师,赵老师\n'
        )
        imported_t = self.call('/api/teachers/import', dict(
            filename='教师基本信息.csv',
            content=base64.b64encode(teacher_csv.encode()).decode(),
            grade='初三',
        ))
        self.assertEqual(imported_t['matched_exams'], 2)
        self.assertEqual(imported_t['updated'], 4)

        brief = self.call('/api/class-brief', dict(exam_id=d2['id'], **{'class': '01'}, high_ratio=0.2, main_ratio=0.4))
        self.assertEqual(brief['meta']['homeroom'], '周老师')
        self.assertEqual(brief['headline']['high']['count'], 1)
        self.assertEqual(brief['headline']['main']['count'], 2)
        self.assertTrue(len(brief['headline']['talking_points']) >= 1)
        math_diag = next(s for s in brief['subject_diagnosis'] if s['subject'] == '数学')
        self.assertEqual(math_diag['teacher'], '张老师')
        self.assertEqual([o['class'] for o in math_diag['same_teacher_other_classes']], ['02'])
        eng_diag = next(s for s in brief['subject_diagnosis'] if s['subject'] == '英语')
        self.assertTrue(eng_diag['teacher_changed'])
        self.assertEqual(eng_diag['prev_teacher'], '王老师')
        self.assertTrue(brief['flow']['available'])
        self.assertEqual(brief['flow']['main_drop_count'], 1)  # S02 dropped out of top 40%
        self.assertEqual(brief['flow']['main_rise_count'], 1)  # S03 rose into top 40%
        self.assertEqual(len(brief['timeline']), 2)
        self.assertEqual([r['cutoff'] for r in brief['current_weak_summary']], [200, 400, 600])

        batch = self.call('/api/class-brief', dict(exam_id=d2['id'], all_classes=True))
        self.assertEqual(len(batch['briefs']), 2)

        backup = self.call('/api/backup')
        self.assertEqual(len(backup['teachers']), 4)

    def test_extended_rules_persist_and_flow_into_class_brief(self):
        exam_csv = (
            '班级,学号,姓名,语文,数学,英语\n'
            '01,S01,甲一,130,140,135\n'
            '01,S02,甲二,120,130,125\n'
            '01,S03,甲三,115,105,120\n'
            '01,S04,甲四,100,95,90\n'
            '01,S05,甲五,85,80,75\n'
            '02,S06,乙一,128,138,130\n'
            '02,S07,乙二,118,125,115\n'
            '02,S08,乙三,108,110,105\n'
            '02,S09,乙四,95,90,88\n'
            '02,S10,乙五,80,72,70\n'
        )
        d = self.imported('初一自定义口径', exam_csv)
        d['name'], d['date'] = '初一自定义口径', '2026-11-10'
        self.call('/api/exams', dict(dataset=d))
        custom_rules = {
            'cutoff_ratio': 0.4,
            'high_ratio': 0.3,
            'main_ratio': 0.5,
            'borderline_band': 2,
            'tie_mode': 'dense',
            'weak_cutoffs': [3, 6, 9],
            'mentor_range': [3, 7],
            'abc_bounds': [['A', 0.3], ['B', 0.7], ['C', 1.0]],
            'level_bounds': [['A1', 0.2], ['A2', 0.4], ['B1', 0.6], ['B2', 0.8], ['C1', 0.9], ['C2', 1.0]],
        }
        self.call('/api/exams/' + d['id'] + '/rules', dict(rules=custom_rules))
        brief = self.call('/api/class-brief', dict(exam_id=d['id'], **{'class': '01'}))
        self.assertAlmostEqual(brief['headline']['high']['ratio'], 0.3)
        self.assertAlmostEqual(brief['headline']['main']['ratio'], 0.5)
        self.assertEqual([r['cutoff'] for r in brief['current_weak_summary']], [3, 6, 9])
        self.assertEqual(brief['meta']['mentor_range'], [3, 7])
        self.assertTrue(len(brief['action_lists']['mentor_list']) >= 1)
        for item in brief['action_lists']['mentor_list']:
            self.assertGreaterEqual(item['rank'], 3)
            self.assertLessEqual(item['rank'], 7)

    def test_default_rules_inheritance_and_apply_to_grade(self):
        # 1. Save school-wide default rules
        default_payload = {
            'cutoff_ratio': 0.4,
            'cutoff_rounding': 'round',
            'high_ratio': 0.15,
            'main_ratio': 0.35,
            'tie_mode': 'dense',
            'abc_bounds': [['A', 0.25], ['B', 0.55], ['C', 0.85], ['D', 1.0]],
        }
        saved_def = self.call('/api/default-rules', dict(rules=default_payload))
        self.assertTrue(saved_def['ok'])
        self.assertTrue(saved_def['has_custom'])

        # 2. Newly saved exam without explicit rules inherits school defaults automatically
        d1 = self.imported('默认口径一')
        d1['date'] = '2026-10-01'
        self.call('/api/exams', dict(dataset=d1))
        a1 = self.call('/api/analyze', dict(exam_id=d1['id']))
        self.assertAlmostEqual(a1['rules']['cutoff_ratio'], 0.4)
        self.assertEqual(a1['rules']['cutoff_rounding'], 'round')
        self.assertEqual(a1['rules']['tie_mode'], 'dense')
        self.assertEqual([x['label'] for x in a1['rules']['abc_bounds']], ['A', 'B', 'C', 'D'])

        # 3. Second exam in same grade + sync rules across grade
        d2 = self.imported('默认口径二')
        d2['date'] = '2026-11-01'
        self.call('/api/exams', dict(dataset=d2))
        sync_res = self.call('/api/exams/' + d1['id'] + '/rules', dict(
            rules={**a1['rules'], 'cutoff_ratio': 0.25, 'high_ratio': 0.20, 'main_ratio': 0.45},
            apply_to_grade=True,
            save_as_default=True,
        ))
        self.assertEqual(sync_res['synced_exams'], 2)
        self.assertTrue(sync_res['saved_default'])
        a2 = self.call('/api/analyze', dict(exam_id=d2['id']))
        self.assertAlmostEqual(a2['rules']['cutoff_ratio'], 0.25)
        self.assertAlmostEqual(a2['rules']['main_ratio'], 0.45)

        # 4. Backup includes default_rules
        backup = self.call('/api/backup')
        self.assertAlmostEqual(backup['default_rules']['cutoff_ratio'], 0.25)

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
