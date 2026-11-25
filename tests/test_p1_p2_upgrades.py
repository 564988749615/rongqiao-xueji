"""Tests for P1 & P2 upgrades: cross-exam alerts, student headline summary, item-level analysis, and import diagnostics."""
from __future__ import annotations

import base64
import io
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

import openpyxl

import item_analysis
import server
import workbook


class ItemAnalysisUnitTests(unittest.TestCase):
    def test_parse_and_analyze_items_with_and_without_full_marks(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(['学号', '姓名', '班级', '第1题(4分)', '第2题(10分)', '附加题'])
        rows = [
            ('S1', '甲', '01', 4, 10, 8),
            ('S2', '乙', '01', 4, 9, 7),
            ('S3', '丙', '01', 4, 6, 5),
            ('S4', '丁', '01', 0, 4, 3),
            ('S5', '戊', '02', 0, 2, 2),
            ('S6', '己', '02', 0, 1, 1),
            ('S7', '庚', '02', 4, 5, 4),
            ('S8', '辛', '02', 0, 3, 2),
        ]
        for r in rows:
            ws.append(list(r))
        buf = io.BytesIO()
        wb.save(buf)

        parsed = item_analysis.parse_item_scores_file('math_items.xlsx', buf.getvalue(), subject='数学')
        self.assertEqual(parsed['subject'], '数学')
        self.assertEqual(len(parsed['items']), 3)
        self.assertEqual(parsed['items'][0]['full_mark'], 4.0)
        self.assertIsNone(parsed['items'][2]['full_mark'])  # Never guesses missing full mark!

        ana = item_analysis.analyze_item_scores(parsed)
        self.assertEqual(ana['summary']['student_count'], 8)
        self.assertTrue(ana['summary']['has_discrimination'])
        by_name = {x['item']: x for x in ana['items']}
        self.assertEqual(by_name['第1题']['score_rate'], 50.0)
        self.assertGreater(by_name['第2题']['discrimination'], 0.5)
        # Missing full mark item has None score_rate & no_full_mark priority
        self.assertIsNone(by_name['附加题']['score_rate'])
        self.assertEqual(by_name['附加题']['priority_code'], 'no_full_mark')

        # Class filter works
        cls1 = item_analysis.analyze_item_scores(parsed, class_name='01')
        self.assertEqual(cls1['summary']['student_count'], 4)
        self.assertFalse(cls1['summary']['has_discrimination'])  # < 6 students

    def test_friendly_import_error_includes_actionable_steps(self):
        with self.assertRaises(ValueError) as ctx:
            workbook.parse_workbook(b'dummy', 'old.xls')
        self.assertIn('排查建议', str(ctx.exception))


class P1P2ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.old_data = server.DATA
        server.DATA = Path(self.tmpdir.name)
        server.invalidate_cache()
        server.init_db()
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        server.DATA = self.old_data
        server.invalidate_cache()
        self.tmpdir.cleanup()

    def _req(self, path: str, body: dict | None = None):
        url = f'http://127.0.0.1:{self.port}{path}'
        headers = {'Origin': f'http://127.0.0.1:{self.port}'}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(url, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read(), resp.headers

    def test_cross_exam_alerts_profile_headline_and_item_analysis_api(self):
        # 3 exams where S01 drops steadily (#1 -> #4 -> #7 out of 8) to trigger alert
        def make_exam(eid: str, name: str, date: str, s1_score: int) -> dict:
            rows = [
                {'id': 'S01', 'source_row': 2, 'class': '01', 'name': '张下滑', 'scores': {'语文': s1_score, '数学': s1_score - 10}, 'identity_reliable': True},
                {'id': 'S02', 'source_row': 3, 'class': '01', 'name': '李稳健', 'scores': {'语文': 125, '数学': 125}, 'identity_reliable': True},
                {'id': 'S03', 'source_row': 4, 'class': '01', 'name': '王三', 'scores': {'语文': 120, '数学': 120}, 'identity_reliable': True},
                {'id': 'S04', 'source_row': 5, 'class': '01', 'name': '赵四', 'scores': {'语文': 115, '数学': 115}, 'identity_reliable': True},
                {'id': 'S05', 'source_row': 6, 'class': '02', 'name': '钱五', 'scores': {'语文': 110, '数学': 110}, 'identity_reliable': True},
                {'id': 'S06', 'source_row': 7, 'class': '02', 'name': '孙六', 'scores': {'语文': 105, '数学': 105}, 'identity_reliable': True},
                {'id': 'S07', 'source_row': 8, 'class': '02', 'name': '周七', 'scores': {'语文': 100, '数学': 100}, 'identity_reliable': True},
                {'id': 'S08', 'source_row': 9, 'class': '02', 'name': '吴八', 'scores': {'语文': 80, '数学': 80}, 'identity_reliable': True},
            ]
            return {
                'id': eid, 'name': name, 'grade': '初三', 'date': date, 'filename': f'{name}.xlsx',
                'imported_at': '2026-11-20T08:00:00Z', 'subjects': ['语文', '数学'], 'classes': ['01', '02'],
                'rows': rows, 'warnings': [], 'mapping': {},
            }

        e1 = json.loads(self._req('/api/exams', {'dataset': make_exam('e1', '一模', '2026-09-10', 135)})[1])['id']
        e2 = json.loads(self._req('/api/exams', {'dataset': make_exam('e2', '二模', '2026-10-10', 118)})[1])['id']
        e3 = json.loads(self._req('/api/exams', {'dataset': make_exam('e3', '三模', '2026-11-10', 95)})[1])['id']

        # 1. History API returns alerts & alert_summary
        status, raw, _ = self._req('/api/history', {'grade': '初三', 'exam_ids': [e1, e2, e3], 'weights': {}})
        self.assertEqual(status, 200)
        hist = json.loads(raw)
        self.assertGreaterEqual(hist['alert_summary']['total'], 1)
        alert_s1 = next((a for a in hist['alerts'] if a['id'] == 'S01'), None)
        self.assertIsNotNone(alert_s1)
        self.assertEqual(alert_s1['level'], 'high')
        self.assertGreaterEqual(alert_s1['consec_drops'], 2)

        # 2. Student profile returns one-sentence headline_summary
        status, raw, _ = self._req('/api/students/profile?student_id=S01')
        self.assertEqual(status, 200)
        prof = json.loads(raw)
        self.assertIn('headline_summary', prof['student'])
        self.assertIn('近 3 场', prof['student']['headline_summary'])

        # 3. Item-analysis template, import, query, and delete
        status, tpl_bytes, _ = self._req('/api/templates/item-scores.xlsx')
        self.assertEqual(status, 200)
        self.assertTrue(len(tpl_bytes) > 1000)

        status, raw, _ = self._req(
            f'/api/exams/{e3}/item-analyses/import',
            {'subject': '数学', 'filename': 'math_tpl.xlsx', 'content': base64.b64encode(tpl_bytes).decode('ascii')},
        )
        self.assertEqual(status, 200)
        imp = json.loads(raw)
        self.assertTrue(imp['ok'])
        self.assertEqual(imp['analysis']['subject'], '数学')
        self.assertEqual(imp['analysis']['summary']['item_count'], 5)

        status, raw, _ = self._req(f'/api/exams/{e3}/item-analyses')
        self.assertEqual(status, 200)
        fetched = json.loads(raw)
        self.assertEqual(len(fetched['subjects']), 1)
        self.assertEqual(fetched['analysis']['subject'], '数学')

        status, raw, _ = self._req(f'/api/exams/{e3}/item-analyses/delete', {'subject': '数学'})
        self.assertEqual(status, 200)
        fetched2 = json.loads(self._req(f'/api/exams/{e3}/item-analyses')[1])
        self.assertEqual(len(fetched2['subjects']), 0)


if __name__ == '__main__':
    unittest.main()
