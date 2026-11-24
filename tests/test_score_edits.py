"""TDD test suite for score editing (non-destructive overlay, preview, save, revoke, import, backup/sync, versioning, publish lock)."""
from __future__ import annotations

import base64
import io
import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / '.runtime'))

import server


def _sample_dataset(exam_id: str = 'exam-edit-1', name: str = '初三测试一', date: str = '2026-10-15') -> dict:
    return {
        'id': exam_id,
        'name': name,
        'grade': '初三',
        'date': date,
        'filename': '测试成绩.xlsx',
        'subjects': ['语文', '数学', '英语'],
        'classes': ['01', '02'],
        'rows': [
            {'id': 'student:101', 'source_row': 2, 'class': '01', 'name': '张一', 'scores': {'语文': 110, '数学': 120, '英语': 115}, 'identity_reliable': True},
            {'id': 'student:102', 'source_row': 3, 'class': '01', 'name': '李二', 'scores': {'语文': 105, '数学': 118, '英语': 110}, 'identity_reliable': True},
            {'id': 'student:103', 'source_row': 4, 'class': '01', 'name': '王三', 'scores': {'语文': 100, '数学': 105, '英语': 102}, 'identity_reliable': True},
            {'id': 'student:201', 'source_row': 5, 'class': '02', 'name': '赵四', 'scores': {'语文': 112, '数学': 125, '英语': 118}, 'identity_reliable': True},
            {'id': 'student:202', 'source_row': 6, 'class': '02', 'name': '陈五', 'scores': {'语文': 96, '数学': 99, '英语': 100}, 'identity_reliable': True},
            {'id': 'student:203', 'source_row': 7, 'class': '02', 'name': '周六', 'scores': {'语文': 88, '数学': 92, '英语': 95}, 'identity_reliable': True},
        ],
        'warnings': [],
    }


class ScoreEditsBaseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_data = server.DATA
        server.DATA = Path(self.tmp.name)
        server.init_db()
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        server.DATA = self.old_data
        server.invalidate_cache()
        self.tmp.cleanup()

    def _get(self, path: str) -> tuple[bytes, dict]:
        with urlopen(f'http://127.0.0.1:{self.port}{path}', timeout=5) as resp:
            return resp.read(), dict(resp.headers)

    def _get_json(self, path: str) -> dict:
        raw, _ = self._get(path)
        return json.loads(raw.decode('utf-8'))

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

    def _post_expect_error(self, path: str, payload: dict) -> tuple[int, str]:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = Request(
            f'http://127.0.0.1:{self.port}{path}',
            data=body,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        try:
            with urlopen(req, timeout=5) as resp:
                self.fail(f'Expected HTTPError, got {resp.status}')
        except HTTPError as err:
            data = json.loads(err.read().decode('utf-8'))
            return err.code, data.get('error', '')


class Task1EffectiveDatasetTests(ScoreEditsBaseTest):
    def test_score_edits_table_and_effective_dataset_overlay(self):
        ds = _sample_dataset()
        saved = self._post('/api/exams', {'dataset': ds})
        self.assertEqual(saved['edit_count'], 0)
        self.assertEqual(saved['data_version'], 1)
        self.assertEqual(saved['published_at'], '')

        # Insert 1st edit directly into score_edits
        with server.db() as conn:
            conn.execute(
                '''INSERT INTO score_edits(
                     id, exam_id, row_id, source_row, subject, old_value, new_value,
                     reason, editor, batch_id, created_at, revoked_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)''',
                ('edit-1', ds['id'], 'student:102', 3, '数学', 118.0, 126.0, '复核更正', '', 'batch-1', '2026-10-16T08:00:00Z'),
            )
            row = conn.execute('SELECT * FROM exams WHERE id=?', (ds['id'],)).fetchone()
            eff = server.effective_dataset(conn, row)
            raw = json.loads(row['dataset'])

        # Effective dataset has 126.0 while raw dataset remains 118
        eff_stu = next(r for r in eff['rows'] if r['id'] == 'student:102')
        raw_stu = next(r for r in raw['rows'] if r['id'] == 'student:102')
        self.assertEqual(eff_stu['scores']['数学'], 126.0)
        self.assertEqual(raw_stu['scores']['数学'], 118)

        # Insert 2nd edit on same cell: later edit wins
        with server.db() as conn:
            conn.execute(
                '''INSERT INTO score_edits(
                     id, exam_id, row_id, source_row, subject, old_value, new_value,
                     reason, editor, batch_id, created_at, revoked_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)''',
                ('edit-2', ds['id'], 'student:102', 3, '数学', 126.0, 130.0, '二次复核', '', 'batch-2', '2026-10-16T09:00:00Z'),
            )
            row = conn.execute('SELECT * FROM exams WHERE id=?', (ds['id'],)).fetchone()
            eff2 = server.effective_dataset(conn, row)
        self.assertEqual(next(r for r in eff2['rows'] if r['id'] == 'student:102')['scores']['数学'], 130.0)

        # Revoke 2nd edit: reverts to 1st edit value (126.0)
        with server.db() as conn:
            conn.execute("UPDATE score_edits SET revoked_at='2026-10-16T10:00:00Z' WHERE id='edit-2'")
            row = conn.execute('SELECT * FROM exams WHERE id=?', (ds['id'],)).fetchone()
            eff3 = server.effective_dataset(conn, row)
        self.assertEqual(next(r for r in eff3['rows'] if r['id'] == 'student:102')['scores']['数学'], 126.0)

        # GET /api/exams/<id> returns both original dataset and effective_dataset
        detail = self._get_json(f"/api/exams/{ds['id']}")
        self.assertEqual(next(r for r in detail['dataset']['rows'] if r['id'] == 'student:102')['scores']['数学'], 118)
        self.assertEqual(next(r for r in detail['effective_dataset']['rows'] if r['id'] == 'student:102')['scores']['数学'], 126.0)


if __name__ == '__main__':
    unittest.main()
