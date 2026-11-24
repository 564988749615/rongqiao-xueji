"""Comprehensive tests for PM upgrades 1, 2, 5, 6:
1. Multi-sheet workbook batch import + teacher auto-detect + standard templates
2. Roster hygiene assistant (typos, class transfers, duplicate names) + auto name fixes
5. Safe distribution: per-class isolated ZIP packages + zero-exposure student diagnostic cards
6. Scientific scales (PR / T-score) in trends & history + S3 diff preview & smart timestamp merge
"""
from __future__ import annotations

import base64
import io
import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from urllib.request import Request, urlopen
import zipfile

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / '.runtime'))

import server
from tests.test_s3 import _MockS3State, _make_mock_s3_handler


def _make_multi_xlsx() -> bytes:
    wb = openpyxl.Workbook()
    # Sheet 1: Ignored instructions
    ws_guide = wb.active
    ws_guide.title = '使用指南'
    ws_guide.append(['填写说明', '这是说明页'])

    # Sheet 2: Exam 1
    ws1 = wb.create_sheet('初三一诊_2026-09-15')
    ws1.append(['班级', '姓名', '语文', '数学', '英语'])
    ws1.append(['01', '张锋', 110, 120, 115])
    ws1.append(['01', '李明', 100, 105, 108])
    ws1.append(['01', '王磊', 95, 90, 92])
    ws1.append(['02', '王磊', 88, 94, 91])
    ws1.append(['02', '赵敏', 125, 132, 128])
    ws1.append(['02', '周涛', 82, 79, 85])

    # Sheet 3: Exam 2 (张锋->张峰 typo in 01班, 李明 transferred 01->02, 王磊 dup across 01/02)
    ws2 = wb.create_sheet('初三二诊_2026-10-20')
    ws2.append(['班级', '姓名', '语文', '数学', '英语'])
    ws2.append(['01', '张峰', 116, 126, 120])
    ws2.append(['01', '王磊', 98, 95, 96])
    ws2.append(['02', '李明', 108, 112, 110])
    ws2.append(['02', '王磊', 90, 96, 94])
    ws2.append(['02', '赵敏', 128, 136, 130])
    ws2.append(['02', '周涛', 86, 84, 88])

    # Sheet 4: Teachers sheet
    ws_t = wb.create_sheet('教师基本信息')
    ws_t.append(['考试名称', '班级', '班主任', '语文', '数学', '英语'])
    ws_t.append(['初三一诊_2026-09-15', '01', '陈老师', '陈老师', '刘老师', '林老师'])
    ws_t.append(['初三一诊_2026-09-15', '02', '吴老师', '陈老师', '孙老师', '林老师'])
    ws_t.append(['初三二诊_2026-10-20', '01', '陈老师', '陈老师', '刘老师', '林老师'])
    ws_t.append(['初三二诊_2026-10-20', '02', '吴老师', '陈老师', '孙老师', '林老师'])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class PMUpgradesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_data = server.DATA
        server.DATA = Path(self.tmp.name)
        server.init_db()
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

        self.s3_state = _MockS3State()
        handler = _make_mock_s3_handler(self.s3_state, 'school-bucket', 'AK123')
        self.s3_httpd = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.s3_port = self.s3_httpd.server_address[1]
        self.s3_thread = threading.Thread(target=self.s3_httpd.serve_forever, daemon=True)
        self.s3_thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.s3_httpd.shutdown()
        self.s3_httpd.server_close()
        server.DATA = self.old_data
        self.tmp.cleanup()

    def _get(self, path: str) -> tuple[bytes, dict]:
        with urlopen(f'http://127.0.0.1:{self.port}{path}', timeout=5) as resp:
            return resp.read(), dict(resp.headers)

    def _post(self, path: str, payload: dict) -> dict:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = Request(
            f'http://127.0.0.1:{self.port}{path}',
            data=body,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def test_1_2_multi_import_hygiene_and_templates(self):
        # 1. Standard templates download
        for ep in ('/api/templates/scores.xlsx', '/api/templates/teachers.xlsx'):
            raw, headers = self._get(ep)
            self.assertIn('spreadsheetml', headers.get('Content-Type', ''))
            wb = openpyxl.load_workbook(io.BytesIO(raw))
            self.assertGreaterEqual(len(wb.sheetnames), 2)
            wb.close()

        # 2. Multi-workbook inspect
        raw_multi = _make_multi_xlsx()
        inspected = self._post('/api/workbook/inspect', {
            'filename': '初三历次总表.xlsx',
            'content': base64.b64encode(raw_multi).decode('ascii'),
            'grade': '初三',
            'default_date': '2026-10-20',
        })
        self.assertEqual(len(inspected['score_sheets']), 2)
        self.assertEqual(len(inspected['teacher_sheets']), 1)
        self.assertEqual(len(inspected['ignored_sheets']), 1)

        s1, s2 = inspected['score_sheets']
        self.assertEqual(s1['exam_date'], '2026-09-15')
        self.assertEqual(s2['exam_date'], '2026-10-20')
        self.assertEqual(s1['status'], 'new')

        # Roster hygiene on sheet 2 (compared against sheet 1):
        hyg = s2['hygiene']
        self.assertTrue(hyg['has_baseline'])
        self.assertEqual(len(hyg['typo_candidates']), 1)
        self.assertEqual(hyg['typo_candidates'][0]['incoming_name'], '张峰')
        self.assertEqual(hyg['typo_candidates'][0]['suggested_name'], '张锋')
        self.assertEqual(len(hyg['class_transfers']), 1)
        self.assertEqual(hyg['class_transfers'][0]['name'], '李明')
        self.assertEqual(hyg['class_transfers'][0]['from_class'], '01')
        self.assertEqual(hyg['class_transfers'][0]['to_class'], '02')
        self.assertEqual(len(hyg['duplicate_names']), 1)
        self.assertEqual(hyg['duplicate_names'][0]['name'], '王磊')

        # 3. Batch commit with typo fix applied
        res = self._post('/api/exams/batch-import', {
            'grade': '初三',
            'exams': [
                {'dataset': s1['dataset'], 'name': s1['exam_name'], 'date': s1['exam_date'], 'mode': 'create'},
                {
                    'dataset': s2['dataset'],
                    'name': s2['exam_name'],
                    'date': s2['exam_date'],
                    'mode': 'create',
                    'name_fixes': hyg['typo_candidates'],
                },
            ],
            'teacher_sheets': [{'parsed': inspected['teacher_sheets'][0]['parsed']}],
        })
        self.assertEqual(res['imported'], 2)
        self.assertEqual(res['fixes_applied'], 1)
        self.assertEqual(res['teachers_updated'], 4)

        # Verify 张峰 was corrected to 张锋 and connects cleanly in history
        hist = self._post('/api/history', {'grade': '初三'})
        zf = next((st for st in hist['students'] if st['name'] == '张锋'), None)
        self.assertIsNotNone(zf)
        self.assertEqual(zf['attempts'], 2)
        # Verify PR and T-score exist on history
        self.assertIsNotNone(zf['mean_pr'])
        self.assertIsNotNone(zf['mean_t'])
        self.assertIsNotNone(zf['history'][0]['pr'])
        self.assertIsNotNone(zf['history'][0]['t_score'])

        # Re-inspecting should mark both score sheets as 'exists'
        re_inspected = self._post('/api/workbook/inspect', {
            'filename': '初三历次总表.xlsx',
            'content': base64.b64encode(raw_multi).decode('ascii'),
            'grade': '初三',
            'default_date': '2026-10-20',
        })
        self.assertTrue(all(x['status'] == 'exists' for x in re_inspected['score_sheets']))

    def test_5_6_distribution_scales_and_s3_smart_merge(self):
        # Import the 2 exams first
        raw_multi = _make_multi_xlsx()
        inspected = self._post('/api/workbook/inspect', {
            'filename': '总表.xlsx',
            'content': base64.b64encode(raw_multi).decode('ascii'),
            'grade': '初三',
            'default_date': '2026-10-20',
        })
        s1, s2 = inspected['score_sheets']
        batch = self._post('/api/exams/batch-import', {
            'grade': '初三',
            'exams': [
                {'dataset': s1['dataset'], 'name': s1['exam_name'], 'date': s1['exam_date'], 'mode': 'create'},
                {
                    'dataset': s2['dataset'], 'name': s2['exam_name'], 'date': s2['exam_date'],
                    'mode': 'create', 'name_fixes': s2['hygiene']['typo_candidates'],
                },
            ],
            'teacher_sheets': [{'parsed': inspected['teacher_sheets'][0]['parsed']}],
        })
        exam1_id, exam2_id = batch['exam_ids']

        # Feature 6A: /api/trends enriched with PR & T-score
        trends_raw, _ = self._get('/api/trends?grade=%E5%88%9D%E4%B8%89')
        trends = json.loads(trends_raw.decode('utf-8'))
        self.assertEqual(len(trends['exams']), 2)
        c01 = trends['exams'][1]['class_stats'][0]
        self.assertIn('t_score', c01)
        self.assertIn('pr', c01)
        self.assertTrue(0 <= c01['pr'] <= 100)
        self.assertIn('t_score', c01['subjects']['语文'])
        self.assertIn('pr', c01['subjects']['语文'])

        # Feature 5A: Class packages ZIP privacy isolation
        zip_bytes, headers = self._get(f'/api/exams/{exam2_id}/class-packages.zip')
        self.assertEqual(headers.get('Content-Type'), 'application/zip')
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf:
            names = zf.namelist()
            self.assertIn('分发说明.txt', names)
            self.assertIn('01班/01班_成绩与学科诊断.xlsx', names)
            self.assertIn('01班/01班_班情分析打印版.html', names)
            self.assertIn('02班/02班_成绩与学科诊断.xlsx', names)
            html01 = zf.read('01班/01班_班情分析打印版.html').decode('utf-8')
            self.assertNotIn('赵敏', html01)  # 02班学生绝不能出现在01班文件里
            self.assertNotIn('周涛', html01)
            wb01 = openpyxl.load_workbook(io.BytesIO(zf.read('01班/01班_成绩与学科诊断.xlsx')))
            s1_text = ' '.join(str(v) for row in wb01['01班成绩明细'].iter_rows(values_only=True) for v in row if v)
            self.assertIn('张锋', s1_text)
            self.assertNotIn('赵敏', s1_text)
            self.assertNotIn('周涛', s1_text)
            wb01.close()

        # Feature 5B: Student personal diagnostic cards (zero other-student exposure)
        cards_res = self._post('/api/student-cards', {'exam_id': exam2_id, 'student_id': 'name:01:张锋'})
        self.assertEqual(len(cards_res['cards']), 1)
        card = cards_res['cards'][0]
        self.assertEqual(card['name'], '张锋')
        self.assertEqual(len(card['history']), 2)
        self.assertIsNotNone(card['pr'])
        self.assertIsNotNone(card['t_score'])
        self.assertTrue(card['advice']['strength_text'])
        self.assertTrue(card['advice']['focus_text'])
        dumped = json.dumps(cards_res, ensure_ascii=False)
        self.assertNotIn('赵敏', dumped)
        self.assertNotIn('周涛', dumped)

        # Feature 6B: S3 Diff Preview & Smart Merge
        self._post('/api/s3/config', {
            'config': {
                'provider': 'bitiful',
                'endpoint': f'http://127.0.0.1:{self.s3_port}',
                'region': 'cn-east-1',
                'bucket': 'school-bucket',
                'access_key': 'AK123',
                'secret_key': 'SK456',
                'prefix': 'rq/',
                'path_style': True,
            }
        })
        # Create a note on exam2, wait 1.1s, modify rules + note, upload snapshot
        note = self._post('/api/notes', {'exam_id': exam2_id, 'class': '01', 'text': '初始教研结论'})
        # Save a snapshot of this "old" local state first to simulate machine A
        old_backup = json.loads(self._get('/api/backup')[0].decode('utf-8'))

        # Simulate machine B making newer edits (update rules + update note + add note)
        time.sleep(1.1)
        self._post(f'/api/exams/{exam2_id}/rules', {'rules': {'high_ratio': 0.15, 'main_ratio': 0.35}})
        self._post(f"/api/notes/{note['id']}/update", {'class': '01', 'text': '云端更新后的教研结论'})
        self._post('/api/notes', {'exam_id': exam2_id, 'class': '02', 'text': '云端新增记录'})
        snap = self._post('/api/s3/backup', {'label': 'machine-b'})

        # Reset local DB back to machine A's older state (and remove exam1 to test missing-exam add too!)
        with server.db() as conn:
            conn.execute('DELETE FROM teachers')
            conn.execute('DELETE FROM notes')
            conn.execute('DELETE FROM exams')
        server.invalidate_cache()
        old_backup_partial = {**old_backup, 'exams': [ex for ex in old_backup['exams'] if ex['id'] == exam2_id]}
        self._post('/api/restore', {'backup': old_backup_partial, 'mode': 'append_only'})

        # Now run /api/s3/diff -> should detect 1 new exam (exam1), 1 updated exam (exam2 rules), 1 new note, 1 updated note
        diff = self._post('/api/s3/diff', {'key': snap['key']})
        self.assertEqual(len(diff['exams']['only_cloud']), 1)
        self.assertEqual(len(diff['exams']['updated_in_cloud']), 1)
        self.assertIn('口径', diff['exams']['updated_in_cloud'][0]['changes'])
        self.assertEqual(diff['notes']['only_cloud'], 1)
        self.assertEqual(diff['notes']['updated_in_cloud'], 1)

        # Smart merge restore!
        merged = self._post('/api/s3/restore', {'key': snap['key'], 'mode': 'smart_merge'})
        self.assertEqual(merged['exams_added'], 1)
        self.assertEqual(merged['exams_updated'], 1)
        self.assertEqual(merged['notes_added'], 1)
        self.assertEqual(merged['notes_updated'], 1)

        # Verify updated rules & updated note actually landed in local DB
        ex2_after = json.loads(self._get(f'/api/exams/{exam2_id}')[0].decode('utf-8'))
        self.assertAlmostEqual(ex2_after['rules']['high_ratio'], 0.15, places=3)
        notes_after = json.loads(self._get(f'/api/notes?exam_id={exam2_id}')[0].decode('utf-8'))['notes']
        texts = {x['text'] for x in notes_after}
        self.assertIn('云端更新后的教研结论', texts)
        self.assertIn('云端新增记录', texts)

    def test_student_comparison_and_compare_exam_switch(self):
        raw_multi = _make_multi_xlsx()
        inspected = self._post('/api/workbook/inspect', {
            'filename': '总表.xlsx',
            'content': base64.b64encode(raw_multi).decode('ascii'),
            'grade': '初三',
            'default_date': '2026-10-20',
        })
        s1, s2 = inspected['score_sheets']
        # Also create a 3rd exam where 张锋 drops significantly so we test baseline switch (exam3 vs exam2 vs exam1)
        wb3 = openpyxl.Workbook()
        ws3 = wb3.active
        ws3.title = '初三三诊_2026-11-20'
        ws3.append(['班级', '姓名', '语文', '数学', '英语'])
        ws3.append(['01', '张锋', 85, 82, 88])
        ws3.append(['01', '王磊', 112, 118, 115])
        ws3.append(['02', '李明', 105, 110, 108])
        ws3.append(['02', '王磊', 95, 98, 96])
        ws3.append(['02', '赵敏', 130, 138, 134])
        ws3.append(['02', '周涛', 90, 92, 91])
        buf3 = io.BytesIO()
        wb3.save(buf3)
        ds3 = self._post('/api/import', {
            'filename': '三诊.xlsx',
            'content': base64.b64encode(buf3.getvalue()).decode('ascii'),
            'metadata': {'name': '初三三诊_2026-11-20', 'grade': '初三', 'date': '2026-11-20'},
        })

        batch = self._post('/api/exams/batch-import', {
            'grade': '初三',
            'exams': [
                {'dataset': s1['dataset'], 'name': s1['exam_name'], 'date': s1['exam_date'], 'mode': 'create'},
                {'dataset': s2['dataset'], 'name': s2['exam_name'], 'date': s2['exam_date'], 'mode': 'create', 'name_fixes': s2['hygiene']['typo_candidates']},
            ],
        })
        exam1_id, exam2_id = batch['exam_ids']
        exam3 = self._post('/api/exams', {'dataset': ds3})
        exam3_id = exam3['id']

        # Default compare for exam3 -> compares against exam2
        brief_default = self._post('/api/class-brief', {'exam_id': exam3_id, 'class': '01'})
        comp = brief_default['student_comparison']
        self.assertEqual(comp['compare_exam']['id'], exam2_id)
        self.assertEqual(len(comp['compare_options']), 2)
        zf = next(r for r in comp['rows'] if r['name'] == '张锋')
        self.assertEqual(zf['prev_total'], 362)
        self.assertEqual(zf['prev_rank'], 2)
        self.assertEqual(zf['total'], 255)
        self.assertEqual(zf['rank'], 6)
        self.assertEqual(zf['rank_gain'], -4)  # dropped from #2 to #6
        self.assertTrue(len(zf['weak']) >= 1)
        self.assertIsNotNone(zf['weak'][0]['score'])
        self.assertIsNotNone(zf['weak'][0]['rank'])

        # Switch compare_exam_id to exam1 -> compares against exam1!
        brief_vs_1 = self._post('/api/class-brief', {'exam_id': exam3_id, 'class': '01', 'compare_exam_id': exam1_id})
        comp1 = brief_vs_1['student_comparison']
        self.assertEqual(comp1['compare_exam']['id'], exam1_id)
        zf1 = next(r for r in comp1['rows'] if r['name'] == '张锋')
        self.assertEqual(zf1['prev_total'], 345)
        self.assertEqual(zf1['prev_rank'], 2)

        # all_classes batch brief respects compare_exam_id
        batch_briefs = self._post('/api/class-brief', {'exam_id': exam3_id, 'all_classes': True, 'compare_exam_id': exam1_id})
        self.assertEqual(len(batch_briefs['briefs']), 2)
        self.assertTrue(all(b['student_comparison']['compare_exam']['id'] == exam1_id for b in batch_briefs['briefs']))

        # Verify level_profile (A1/A2/B1/B2/C1/C2 teacher levers) has ZERO scores and ZERO ranks!
        lp = brief_default['level_profile']
        self.assertEqual(lp['tiers'], ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
        self.assertEqual(len(lp['total_distribution']), 6)
        self.assertTrue(lp['transitions']['available'])
        self.assertEqual(len(lp['subject_synergy']), 3)
        self.assertEqual(len(lp['subject_synergy'][0]['teaching_groups']), 4)
        self.assertGreaterEqual(len(lp['student_levers']), 2)

        # Recursive privacy check: zero score/rank keys anywhere inside level_profile
        forbidden_keys = {'score', 'scores', 'total', 'rank', 'ranks', 'class_rank', 'mean', 'cutoff', 'prev_total', 'prev_rank', 'rank_gain'}
        def _walk_keys(obj):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    self.assertNotIn(k, forbidden_keys, f'Forbidden key {k} leaked into level_profile!')
                    _walk_keys(v)
            elif isinstance(obj, list):
                for it in obj:
                    _walk_keys(it)
        _walk_keys(lp)


if __name__ == '__main__':
    unittest.main()
