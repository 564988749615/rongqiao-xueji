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


class Task2PreviewTests(ScoreEditsBaseTest):
    def test_preview_diffs_cutoffs_non_mutating_and_validation(self):
        ds1 = _sample_dataset('exam-prev-1', '初三一测', '2026-09-15')
        ds2 = _sample_dataset('exam-prev-2', '初三二测', '2026-10-15')
        self._post('/api/exams', {'dataset': ds1})
        self._post('/api/exams', {'dataset': ds2, 'rules': {'full_marks': {'数学': 150}}})

        with server.db() as conn:
            before_row = conn.execute('SELECT updated_at, data_version FROM exams WHERE id=?', (ds2['id'],)).fetchone()

        # Raise 李二 (student:102, total 333 -> 363) above 赵四 (355) & 张一 (345) — shifts rank AND 30% cutoff!
        preview = self._post(f"/api/exams/{ds2['id']}/scores/preview", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 148}],
        })
        self.assertTrue(preview['students'])
        first_stu = preview['students'][0]
        self.assertEqual(first_stu['row_id'], 'student:102')
        self.assertTrue(first_stu['edited'])
        self.assertEqual(first_stu['diff']['scores.数学'], [118, 148.0])
        self.assertEqual(first_stu['diff']['total'], [333.0, 363.0])
        self.assertEqual(first_stu['diff']['rank'], [3, 1])
        self.assertGreater(preview['summary']['cutoffs_changed'], 0)
        self.assertIn('总分', preview['cutoffs'])
        self.assertNotEqual(preview['cutoffs']['总分'][0], preview['cutoffs']['总分'][1])
        self.assertTrue(any('历次' in w for w in preview['warnings']))

        # Ensure DB was NOT mutated
        with server.db() as conn:
            after_row = conn.execute('SELECT updated_at, data_version FROM exams WHERE id=?', (ds2['id'],)).fetchone()
        self.assertEqual(before_row['updated_at'], after_row['updated_at'])
        self.assertEqual(before_row['data_version'], after_row['data_version'])

        # Validation errors (Chinese messages)
        code, msg = self._post_expect_error(f"/api/exams/{ds2['id']}/scores/preview", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 151}],
        })
        self.assertEqual(code, 400)
        self.assertIn('满分', msg)

        code, msg = self._post_expect_error(f"/api/exams/{ds2['id']}/scores/preview", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': -5}],
        })
        self.assertEqual(code, 400)
        self.assertIn('不能小于 0', msg)

        code, msg = self._post_expect_error(f"/api/exams/{ds2['id']}/scores/preview", {
            'edits': [{'row_id': 'student:102', 'subject': '物理', 'value': 80}],
        })
        self.assertEqual(code, 400)
        self.assertIn('不存在', msg)

        code, msg = self._post_expect_error(f"/api/exams/{ds2['id']}/scores/preview", {
            'edits': [{'row_id': 'student:999', 'subject': '数学', 'value': 100}],
        })
        self.assertEqual(code, 400)
        self.assertIn('找不到', msg)


class Task3SaveListRevokeTests(ScoreEditsBaseTest):
    def test_save_list_revoke_history_brief_and_missing_policies(self):
        ds1 = _sample_dataset('exam-s-1', '初三一测', '2026-09-15')
        ds2 = _sample_dataset('exam-s-2', '初三二测', '2026-10-15')
        self._post('/api/exams', {'dataset': ds1})
        self._post('/api/exams', {'dataset': ds2})

        ana_before = self._post('/api/analyze', {'exam_id': ds2['id']})
        hist_before = self._post('/api/history', {'grade': '初三'})
        li_hist_before = next(s for s in hist_before['students'] if s['id'] == 'student:102')

        # Empty reason rejected
        code, msg = self._post_expect_error(f"/api/exams/{ds2['id']}/scores", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 148}],
            'reason': '   ',
        })
        self.assertEqual(code, 400)
        self.assertIn('原因', msg)

        # No-op edit rejected
        code, msg = self._post_expect_error(f"/api/exams/{ds2['id']}/scores", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 118}],
            'reason': '复核更正',
        })
        self.assertEqual(code, 400)
        self.assertIn('没有需要保存的修改', msg)

        # Save edit #1: 李二 数学 118 -> 148
        res1 = self._post(f"/api/exams/{ds2['id']}/scores", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 148}],
            'reason': '复核漏加分',
        })
        self.assertTrue(res1['ok'])
        self.assertEqual(res1['data_version'], 2)
        self.assertEqual(res1['edit_count'], 1)

        ana_after1 = self._post('/api/analyze', {'exam_id': ds2['id']})
        li_after1 = next(s for s in ana_after1['students'] if s['id'] == 'student:102')
        self.assertEqual(li_after1['scores']['数学'], 148.0)
        self.assertEqual(li_after1['total'], 363.0)
        self.assertEqual(li_after1['rank'], 1)
        self.assertEqual(ana_after1['metadata']['data_version'], 2)
        self.assertEqual(ana_after1['metadata']['edit_count'], 1)

        # /api/history & /api/class-brief reflect new score
        hist_after = self._post('/api/history', {'grade': '初三'})
        li_hist_after = next(s for s in hist_after['students'] if s['id'] == 'student:102')
        self.assertLess(li_hist_after['composite'], li_hist_before['composite'])
        brief = self._post('/api/class-brief', {'exam_id': ds2['id'], 'class': '01'})
        li_comp = next(r for r in brief['student_comparison']['rows'] if r['name'] == '李二')
        self.assertEqual(li_comp['total'], 363.0)

        # Save edit #2 on same cell: 148 -> 138
        res2 = self._post(f"/api/exams/{ds2['id']}/scores", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 138}],
            'reason': '二次复核',
        })
        self.assertEqual(res2['data_version'], 3)
        self.assertEqual(res2['edit_count'], 2)

        edits_list = self._get_json(f"/api/exams/{ds2['id']}/scores/edits")
        self.assertEqual(len(edits_list['edits']), 2)
        self.assertEqual(edits_list['data_version'], 3)
        edit2_id = edits_list['edits'][0]['id']
        edit1_id = edits_list['edits'][1]['id']

        # Revoke edit #2 -> reverts to edit #1 (148.0)
        rev2 = self._post(f"/api/exams/{ds2['id']}/scores/edits/{edit2_id}/revoke", {})
        self.assertTrue(rev2['ok'])
        self.assertEqual(rev2['data_version'], 4)
        self.assertEqual(rev2['edit_count'], 1)
        ana_rev2 = self._post('/api/analyze', {'exam_id': ds2['id']})
        self.assertEqual(next(s for s in ana_rev2['students'] if s['id'] == 'student:102')['scores']['数学'], 148.0)

        # Double revoke rejected
        code, _ = self._post_expect_error(f"/api/exams/{ds2['id']}/scores/edits/{edit2_id}/revoke", {})
        self.assertEqual(code, 400)

        # Revoke edit #1 -> exact match with original ana_before!
        self._post(f"/api/exams/{ds2['id']}/scores/edits/{edit1_id}/revoke", {})
        ana_restored = self._post('/api/analyze', {'exam_id': ds2['id']})
        self.assertEqual(ana_restored['students'], ana_before['students'])
        self.assertEqual(ana_restored['cutoffs'], ana_before['cutoffs'])
        self.assertEqual(ana_restored['class_stats'], ana_before['class_stats'])

        # Test null (缺考) under exclude_total vs zero policy
        self._post(f"/api/exams/{ds2['id']}/scores", {
            'edits': [{'row_id': 'student:103', 'subject': '英语', 'value': None}],
            'reason': '补录缺考',
        })
        ana_null_excl = self._post('/api/analyze', {'exam_id': ds2['id']})
        wang_excl = next(s for s in ana_null_excl['students'] if s['id'] == 'student:103')
        self.assertIsNone(wang_excl['total'])
        self.assertIsNone(wang_excl['rank'])

        self._post(f"/api/exams/{ds2['id']}/rules", {'rules': {'missing_policy': 'zero'}})
        ana_null_zero = self._post('/api/analyze', {'exam_id': ds2['id']})
        wang_zero = next(s for s in ana_null_zero['students'] if s['id'] == 'student:103')
        self.assertEqual(wang_zero['total'], 205.0)
        self.assertIsNotNone(wang_zero['rank'])

        # Archived exam rejects score edit
        self._post(f"/api/exams/{ds2['id']}/archive", {})
        code, msg = self._post_expect_error(f"/api/exams/{ds2['id']}/scores", {
            'edits': [{'row_id': 'student:101', 'subject': '数学', 'value': 130}],
            'reason': '尝试改归档',
        })
        self.assertEqual(code, 400)
        self.assertIn('归档', msg)


class Task4BackupSyncTests(ScoreEditsBaseTest):
    def test_backup_restore_v1_compat_and_smart_merge_score_edits(self):
        ds = _sample_dataset('exam-bk-1', '初三备份测', '2026-10-15')
        self._post('/api/exams', {'dataset': ds})
        self._post(f"/api/exams/{ds['id']}/scores", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 142}],
            'reason': '复核更正A',
        })
        ana_expected = self._post('/api/analyze', {'exam_id': ds['id']})
        backup = self._get_json('/api/backup')
        self.assertEqual(backup['version'], 2)
        self.assertEqual(len(backup['score_edits']), 1)

        # 1. Restore into a brand-new empty data dir
        with tempfile.TemporaryDirectory() as fresh_dir:
            prev_data = server.DATA
            server.DATA = Path(fresh_dir)
            try:
                server.init_db()
                self._post('/api/restore', {'backup': backup, 'mode': 'smart_merge'})
                ana_restored = self._post('/api/analyze', {'exam_id': ds['id']})
                self.assertEqual(ana_restored['students'], ana_expected['students'])
                edits_restored = self._get_json(f"/api/exams/{ds['id']}/scores/edits")
                self.assertEqual(edits_restored['edit_count'], 1)

                # 2. Restore a v1 backup lacking score_edits -> succeeds cleanly
                v1_backup = {k: v for k, v in backup.items() if k != 'score_edits'}
                v1_backup['version'] = 1
                self._post('/api/restore', {'backup': v1_backup, 'mode': 'append_only'})

                # 3. Side B edits another student (student:101), while Side A revokes student:102's edit
                self._post(f"/api/exams/{ds['id']}/scores", {
                    'edits': [{'row_id': 'student:101', 'subject': '语文', 'value': 125}],
                    'reason': '机器B更正',
                })
                # Build cloud snapshot where edit_A is revoked AND edit_C exists on student:103
                edit_a = dict(backup['score_edits'][0])
                edit_a['revoked_at'] = '2026-10-17T08:00:00Z'
                edit_c = {
                    'id': 'edit-cloud-c',
                    'exam_id': ds['id'],
                    'row_id': 'student:103',
                    'source_row': 4,
                    'subject': '英语',
                    'old_value': 102.0,
                    'new_value': 119.0,
                    'reason': '机器A更正',
                    'editor': '',
                    'batch_id': 'batch-c',
                    'created_at': '2026-10-17T08:01:00Z',
                    'revoked_at': None,
                }
                cloud_snap = dict(backup)
                cloud_snap['score_edits'] = [edit_a, edit_c]
                self._post('/api/restore', {'backup': cloud_snap, 'mode': 'smart_merge'})

                merged_edits = self._get_json(f"/api/exams/{ds['id']}/scores/edits")
                by_id = {x['id']: x for x in merged_edits['edits']}
                self.assertIsNotNone(by_id[edit_a['id']]['revoked_at'])
                self.assertIn('edit-cloud-c', by_id)
                self.assertEqual(merged_edits['edit_count'], 2)

                ana_merged = self._post('/api/analyze', {'exam_id': ds['id']})
                by_stu = {s['id']: s for s in ana_merged['students']}
                self.assertEqual(by_stu['student:102']['scores']['数学'], 118)   # revoked -> back to raw
                self.assertEqual(by_stu['student:101']['scores']['语文'], 125.0) # local edit kept
                self.assertEqual(by_stu['student:103']['scores']['英语'], 119.0) # cloud edit merged
            finally:
                server.DATA = prev_data
                server.invalidate_cache()


class Task6BatchImportTests(ScoreEditsBaseTest):
    def test_import_score_edits_template_and_preview_with_unmatched_and_absent(self):
        ds = _sample_dataset('exam-imp-1', '初三更正表测', '2026-10-15')
        self._post('/api/exams', {'dataset': ds})

        # 1. Template download
        tpl_bytes, headers = self._get('/api/templates/score-edits.xlsx')
        self.assertIn('spreadsheetml', headers.get('Content-Type', ''))
        wb_tpl = openpyxl.load_workbook(io.BytesIO(tpl_bytes))
        ws_tpl = wb_tpl.active
        self.assertEqual([ws_tpl.cell(1, c).value for c in range(1, 5)], ['学号或姓名', '班级', '科目', '新分数'])

        # 2. Build 3-row correction sheet (2 matched incl. 缺考 -> None, 1 unmatched)
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(['学号或姓名', '班级', '科目', '新分数'])
        ws.append(['102', '01', '数学', 140])
        ws.append(['王三', '01', '英语', '缺考'])
        ws.append(['999999', '02', '数学', 100])
        buf = io.BytesIO()
        wb.save(buf)

        res = self._post(f"/api/exams/{ds['id']}/scores/import", {
            'filename': '更正表.xlsx',
            'content': base64.b64encode(buf.getvalue()).decode('ascii'),
            'reason': '批量复核更正',
        })
        self.assertEqual(len(res['matched_edits']), 2)
        self.assertEqual(res['matched_edits'][0]['row_id'], 'student:102')
        self.assertEqual(res['matched_edits'][0]['value'], 140.0)
        self.assertEqual(res['matched_edits'][1]['row_id'], 'student:103')
        self.assertIsNone(res['matched_edits'][1]['value'])
        self.assertEqual(len(res['unmatched']), 1)
        self.assertEqual(res['unmatched'][0]['row'], 4)
        self.assertTrue(res['unmatched'][0]['reason'])
        self.assertEqual(res['summary']['edited_cells'], 2)

        # Ensure import only previews and did NOT save yet
        edits_now = self._get_json(f"/api/exams/{ds['id']}/scores/edits")
        self.assertEqual(edits_now['edit_count'], 0)


class Task7VersionStampTests(ScoreEditsBaseTest):
    def test_excel_abc_zip_and_brief_contain_data_version_stamp(self):
        import zipfile

        ds = _sample_dataset('exam-ver-1', '初三版本测', '2026-10-15')
        self._post('/api/exams', {'dataset': ds})

        ana_v1 = self._post('/api/analyze', {'exam_id': ds['id']})
        req = Request(
            f'http://127.0.0.1:{self.port}/api/export/xlsx',
            data=json.dumps({'analysis': ana_v1}, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urlopen(req, timeout=5) as resp:
            wb_v1 = openpyxl.load_workbook(io.BytesIO(resp.read()))
        ws1_v1 = wb_v1.active
        self.assertIn('数据版本 v1 · 原始导入', str(ws1_v1['A2'].value or '') + ' ' + str(ws1_v1.oddFooter.left.text or ''))

        # Make 1 edit -> v2
        self._post(f"/api/exams/{ds['id']}/scores", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 135}],
            'reason': '核分更正',
        })
        ana_v2 = self._post('/api/analyze', {'exam_id': ds['id']})
        req2 = Request(
            f'http://127.0.0.1:{self.port}/api/export/xlsx',
            data=json.dumps({'analysis': ana_v2}, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urlopen(req2, timeout=5) as resp:
            wb_v2 = openpyxl.load_workbook(io.BytesIO(resp.read()))
        ws1_v2 = wb_v2.active
        self.assertIn('数据版本 v2 · 含 1 处更正', str(ws1_v2['A2'].value or '') + ' ' + str(ws1_v2.oddFooter.left.text or ''))

        # ABC Excel contains version stamp
        abc_raw, _ = self._get(f"/api/exams/{ds['id']}/class-abc.xlsx?mode=six")
        wb_abc = openpyxl.load_workbook(io.BytesIO(abc_raw))
        ws_abc = wb_abc['01班']
        self.assertIn('数据版本 v2 · 含 1 处更正', str(ws_abc['A2'].value or '') + ' ' + str(ws_abc.oddFooter.left.text or ''))

        # Class packages ZIP HTML contains version stamp
        zip_raw, _ = self._get(f"/api/exams/{ds['id']}/class-packages.zip")
        with zipfile.ZipFile(io.BytesIO(zip_raw)) as zf:
            html_str = zf.read('01班/01班_班情分析打印版.html').decode('utf-8')
            self.assertIn('数据版本 v2 · 含 1 处更正', html_str)

        # Class brief meta exposes version & edit_count
        brief = self._post('/api/class-brief', {'exam_id': ds['id'], 'class': '01'})
        self.assertEqual(brief['meta']['data_version'], 2)
        self.assertEqual(brief['meta']['edit_count'], 1)


class Task8QuickEditsSaveTests(ScoreEditsBaseTest):
    def test_save_exam_with_initial_quick_edits_preserves_raw_dataset(self):
        ds = _sample_dataset('exam-qk-1', '初三快速出表测', '2026-10-15')
        saved = self._post('/api/exams', {
            'dataset': ds,
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 145}],
        })
        self.assertEqual(saved['edit_count'], 1)
        self.assertEqual(saved['data_version'], 2)

        detail = self._get_json(f"/api/exams/{ds['id']}")
        self.assertEqual(next(r for r in detail['dataset']['rows'] if r['id'] == 'student:102')['scores']['数学'], 118)
        self.assertEqual(next(r for r in detail['effective_dataset']['rows'] if r['id'] == 'student:102')['scores']['数学'], 145.0)

        edits = self._get_json(f"/api/exams/{ds['id']}/scores/edits")
        self.assertEqual(len(edits['edits']), 1)
        self.assertEqual(edits['edits'][0]['reason'], '快速出表中修改')

        ana = self._post('/api/analyze', {'exam_id': ds['id']})
        self.assertEqual(next(s for s in ana['students'] if s['id'] == 'student:102')['scores']['数学'], 145.0)


class Task9PublishLockTests(ScoreEditsBaseTest):
    def test_publish_blocks_edits_and_unlock_logs_audit_record(self):
        ds = _sample_dataset('exam-pub-1', '初三发布测', '2026-10-15')
        self._post('/api/exams', {'dataset': ds})

        pub = self._post(f"/api/exams/{ds['id']}/publish", {})
        self.assertTrue(pub['published_at'])

        code, msg = self._post_expect_error(f"/api/exams/{ds['id']}/scores", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 130}],
            'reason': '尝试改已发布',
        })
        self.assertEqual(code, 400)
        self.assertIn('发布', msg)

        code, msg = self._post_expect_error(f"/api/exams/{ds['id']}/unlock", {'reason': ''})
        self.assertEqual(code, 400)
        self.assertIn('原因', msg)

        unl = self._post(f"/api/exams/{ds['id']}/unlock", {'reason': '教务核分复查解锁'})
        self.assertEqual(unl['published_at'], '')
        self.assertEqual(unl['edit_count'], 0)

        edits = self._get_json(f"/api/exams/{ds['id']}/scores/edits")
        self.assertTrue(any(e['subject'] == '__unlock__' and e['reason'] == '教务核分复查解锁' for e in edits['edits']))

        saved = self._post(f"/api/exams/{ds['id']}/scores", {
            'edits': [{'row_id': 'student:102', 'subject': '数学', 'value': 130}],
            'reason': '解锁后更正',
        })
        self.assertEqual(saved['edit_count'], 1)


class Task10EndToEndWalkthroughTests(ScoreEditsBaseTest):
    def test_full_walkthrough_edit_3_revoke_1_export_backup_restore_fresh_dir(self):
        import zipfile
        ds = _sample_dataset('exam-e2e-1', '初三全流程验收', '2026-11-24')
        self._post('/api/exams', {'dataset': ds})

        # Edit 3 cells in one batch -> data_version=2, edit_count=3
        save_res = self._post(f"/api/exams/{ds['id']}/scores", {
            'edits': [
                {'row_id': 'student:102', 'subject': '数学', 'value': 142},
                {'row_id': 'student:103', 'subject': '语文', 'value': 132},
                {'row_id': 'student:201', 'subject': '英语', 'value': None},
            ],
            'reason': '考后复核三处更正',
        })
        self.assertEqual(save_res['data_version'], 2)
        self.assertEqual(save_res['edit_count'], 3)

        # Revoke 1 edit (student:103 语文) -> data_version=3, edit_count=2
        edits_before = self._get_json(f"/api/exams/{ds['id']}/scores/edits")['edits']
        e_103 = next(x for x in edits_before if x['row_id'] == 'student:103' and x['subject'] == '语文')
        rev_res = self._post(f"/api/exams/{ds['id']}/scores/edits/{e_103['id']}/revoke", {})
        self.assertEqual(rev_res['data_version'], 3)
        self.assertEqual(rev_res['edit_count'], 2)

        # Verify analysis & exports carry v3 + 2 edits
        ana_orig = self._post('/api/analyze', {'exam_id': ds['id']})
        self.assertEqual(ana_orig['metadata']['data_version'], 3)
        self.assertEqual(ana_orig['metadata']['edit_count'], 2)

        abc_raw, _ = self._get(f"/api/exams/{ds['id']}/class-abc.xlsx?mode=six")
        wb_abc = openpyxl.load_workbook(io.BytesIO(abc_raw))
        ws_abc = wb_abc['01班']
        self.assertIn('数据版本 v3 · 含 2 处更正', str(ws_abc['A2'].value or '') + ' ' + str(ws_abc.oddFooter.left.text or ''))

        zip_raw, _ = self._get(f"/api/exams/{ds['id']}/class-packages.zip")
        with zipfile.ZipFile(io.BytesIO(zip_raw)) as zf:
            self.assertIn('数据版本 v3 · 含 2 处更正', zf.read('01班/01班_班情分析打印版.html').decode('utf-8'))

        # Backup v2
        backup_payload = self._get_json('/api/backup')
        self.assertEqual(backup_payload['version'], 2)

        # Restore into completely fresh data dir
        with tempfile.TemporaryDirectory() as fresh_dir:
            prev_data = server.DATA
            try:
                server.DATA = Path(fresh_dir)
                server.init_db()
                server.invalidate_cache()

                restored = self._post('/api/restore', {'backup': backup_payload})
                self.assertEqual(restored['count'], 1)

                ana_fresh = self._post('/api/analyze', {'exam_id': ds['id']})
                self.assertEqual(ana_fresh['metadata']['data_version'], 3)
                self.assertEqual(ana_fresh['metadata']['edit_count'], 2)
                self.assertEqual(ana_fresh['cutoffs'], ana_orig['cutoffs'])
                self.assertEqual(
                    [(s['id'], s['total'], s['rank'], s['scores']) for s in ana_fresh['students']],
                    [(s['id'], s['total'], s['rank'], s['scores']) for s in ana_orig['students']],
                )
                # Raw dataset untouched even after backup/restore
                detail_fresh = self._get_json(f"/api/exams/{ds['id']}")
                raw_102 = next(r for r in detail_fresh['dataset']['rows'] if r['id'] == 'student:102')
                self.assertEqual(raw_102['scores']['数学'], 118)
                eff_102 = next(r for r in detail_fresh['effective_dataset']['rows'] if r['id'] == 'student:102')
                self.assertEqual(eff_102['scores']['数学'], 142.0)
            finally:
                server.DATA = prev_data
                server.invalidate_cache()


if __name__ == '__main__':
    unittest.main()
