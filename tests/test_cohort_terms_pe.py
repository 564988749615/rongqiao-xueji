"""Tests for cohort/term hierarchy (初xx届 -> 初一上..初三下) and standalone PE/subject supplement merge."""
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

import server


class CohortTermAndSubjectMergeTests(unittest.TestCase):
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

    def test_term_inference_meta_update_and_pe_merge_toggle(self):
        # 1. Create an exam under 初2028届 with name "初三上半期" -> auto-infers term "初三上"
        ds = {
            'id': 'exam-term-1',
            'name': '初三上半期',
            'grade': '初2028届',
            'date': '2026-11-20',
            'filename': '初三上半期.xlsx',
            'imported_at': '2026-11-20T08:00:00Z',
            'subjects': ['语文', '数学', '英语', '物理', '化学'],
            'classes': ['01'],
            'rows': [
                {'id': 'id:202801', 'source_row': 2, 'class': '01', 'name': '张一', 'scores': {'语文': 120, '数学': 130, '英语': 125, '物理': 85, '化学': 75}, 'identity_reliable': True},
                {'id': 'id:202802', 'source_row': 3, 'class': '01', 'name': '李二', 'scores': {'语文': 115, '数学': 125, '英语': 120, '物理': 80, '化学': 70}, 'identity_reliable': True},
                {'id': 'id:202803', 'source_row': 4, 'class': '01', 'name': '王三', 'scores': {'语文': 110, '数学': 120, '英语': 115, '物理': 75, '化学': 65}, 'identity_reliable': True},
            ],
            'warnings': [],
            'mapping': {},
        }
        status, raw, _ = self._req('/api/exams', {'dataset': ds})
        self.assertEqual(status, 200)
        summary = json.loads(raw)
        self.assertEqual(summary['grade'], '初2028届')
        self.assertEqual(summary['term'], '初三上')

        # 2. Update term explicitly via /meta
        status, raw, _ = self._req('/api/exams/exam-term-1/meta', {
            'name': '初三定时练习一', 'grade': '初2028届', 'term': '初三下', 'date': '2026-11-21',
        })
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['term'], '初三下')

        # 3. Download PE template and build a standalone PE Excel file
        status, tpl_bytes, _ = self._req('/api/templates/pe-scores.xlsx')
        self.assertEqual(status, 200)
        self.assertTrue(len(tpl_bytes) > 1000)

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(['班级', '姓名', '体育'])
        ws.append(['01', '张一', 48])
        ws.append(['01', '李二', 50])
        ws.append(['01', '王三', 45])
        buf = io.BytesIO()
        wb.save(buf)
        b64 = base64.b64encode(buf.getvalue()).decode('ascii')

        # 4. Preview PE merge (non-mutating)
        status, raw, _ = self._req('/api/exams/exam-term-1/merge-subject', {
            'subject': '体育', 'filename': 'pe.xlsx', 'content': b64, 'include_in_total': True, 'preview_only': True,
        })
        self.assertEqual(status, 200)
        prev = json.loads(raw)
        self.assertEqual(prev['matched_count'], 3)
        self.assertEqual(prev['unmatched_count'], 0)

        # 5. Commit PE merge with include_in_total=True -> total includes PE!
        status, raw, _ = self._req('/api/exams/exam-term-1/merge-subject', {
            'subject': '体育', 'filename': 'pe.xlsx', 'content': b64, 'include_in_total': True, 'preview_only': False,
        })
        self.assertEqual(status, 200)
        merged = json.loads(raw)
        self.assertTrue(merged['included_in_total'])
        ana_with_pe = json.loads(self._req('/api/analyze', {'exam_id': 'exam-term-1'})[1])
        self.assertIn('体育', ana_with_pe['subjects'])
        self.assertIn('体育', ana_with_pe['rules']['total_subjects'])
        s1_with = next(s for s in ana_with_pe['students'] if s['name'] == '张一')
        self.assertEqual(s1_with['total'], 120 + 130 + 125 + 85 + 75 + 48)

        # 6. One-click toggle PE out of total -> total excludes PE while keeping PE column!
        status, raw, _ = self._req('/api/exams/exam-term-1/toggle-subject-total', {'subject': '体育', 'include': False})
        self.assertEqual(status, 200)
        ana_no_pe = json.loads(self._req('/api/analyze', {'exam_id': 'exam-term-1'})[1])
        self.assertIn('体育', ana_no_pe['subjects'])
        self.assertNotIn('体育', ana_no_pe['rules']['total_subjects'])
        s1_no = next(s for s in ana_no_pe['students'] if s['name'] == '张一')
        self.assertEqual(s1_no['total'], 120 + 130 + 125 + 85 + 75)


if __name__ == '__main__':
    unittest.main()
