"""Tests for P0 upgrades: distribution shape classification & standalone parent HTML ZIP."""
from __future__ import annotations

import io
import json
import tempfile
import unittest
import urllib.request
import zipfile
from pathlib import Path
from unittest.mock import patch

import class_brief
import server


def _make_dataset(rows: list[dict], exam_name: str = '期中考试', date: str = '2026-11-20') -> dict:
    classes = sorted({r['class'] for r in rows})
    return {
        'id': 'ds-p0-midterm',
        'name': exam_name,
        'grade': '初三',
        'date': date,
        'filename': f'{exam_name}.xlsx',
        'imported_at': '2026-11-20T08:00:00Z',
        'subjects': ['语文', '数学', '英语'],
        'classes': classes,
        'rows': rows,
        'warnings': [],
        'mapping': {},
    }


class DistributionShapeTests(unittest.TestCase):
    def test_classify_all_five_shapes_and_small_sample(self):
        # 1. Small sample (< 5)
        small = class_brief._classify_distribution_shape(
            [500, 480, 460], mean=480.0, std=16.3, grade_std=30.0, high_rate=33.3, bottom20_rate=0.0
        )
        self.assertEqual(small['type'], 'insufficient')

        # 2. Left-skewed / tail_heavy: majority high, a few very low pull mean far below median
        tail_vals = [560, 555, 550, 548, 545, 540, 535, 320, 310, 300]
        mean_tail = sum(tail_vals) / len(tail_vals)  # 476.3 vs median 542.5
        tail = class_brief._classify_distribution_shape(
            tail_vals, mean=mean_tail, std=104.0, grade_std=95.0, high_rate=20.0, bottom20_rate=30.0
        )
        self.assertEqual(tail['type'], 'tail_heavy')
        self.assertIn('捞尾巴', tail['focus'])
        self.assertLess(tail['mean_median_gap'], 0)

        # 3. Right-skewed / top_pulled: a few super high pull mean above median
        top_vals = [690, 680, 500, 495, 490, 488, 485, 482, 480, 478]
        mean_top = sum(top_vals) / len(top_vals)  # 526.8 vs median 489.0
        top = class_brief._classify_distribution_shape(
            top_vals, mean=mean_top, std=79.0, grade_std=75.0, high_rate=20.0, bottom20_rate=10.0
        )
        self.assertEqual(top['type'], 'top_pulled')
        self.assertIn('虚高', top['focus'])
        self.assertGreater(top['mean_median_gap'], 0)

        # 4. Bimodal: both top and bottom shares high
        bimodal_vals = [620, 610, 600, 520, 510, 500, 490, 350, 340, 330]
        bim = class_brief._classify_distribution_shape(
            bimodal_vals, mean=487.0, std=108.0, grade_std=80.0, high_rate=30.0, bottom20_rate=30.0
        )
        self.assertEqual(bim['type'], 'bimodal')
        self.assertIn('分层', bim['focus'])

        # 5. Clustered middle: few top, few bottom
        mid_vals = [520, 515, 512, 510, 508, 505, 502, 500, 498, 495]
        mid = class_brief._classify_distribution_shape(
            mid_vals, mean=506.5, std=7.7, grade_std=40.0, high_rate=10.0, bottom20_rate=10.0
        )
        self.assertEqual(mid['type'], 'clustered_mid')
        self.assertIn('培优', mid['focus'])

        # 6. Balanced
        bal_vals = [560, 545, 535, 525, 515, 505, 495, 485, 475, 460]
        bal = class_brief._classify_distribution_shape(
            bal_vals, mean=510.0, std=31.0, grade_std=32.0, high_rate=20.0, bottom20_rate=20.0
        )
        self.assertEqual(bal['type'], 'balanced')


class P0ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.old_data = server.DATA
        server.DATA = Path(self.tmpdir.name)
        server.invalidate_cache()
        server.init_db()
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.port = self.httpd.server_address[1]
        import threading
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

    def test_brief_includes_distribution_shape_and_student_cards_zip_is_isolated(self):
        # Build 2 classes: 01班 has mid-upper body + steep low tail (tail_heavy); 02班 holds top slots
        rows = []
        c1_scores = [
            ('张一', 118, 118, 118), ('李二', 117, 117, 117), ('王三', 116, 116, 116),
            ('赵四', 115, 115, 115), ('钱五', 114, 114, 114), ('孙六', 113, 113, 113),
            ('周七', 112, 112, 112), ('吴八', 55, 50, 52), ('郑九', 50, 48, 46), ('冯十', 45, 42, 40),
        ]
        c2_scores = [
            ('陈一', 140, 140, 140), ('褚二', 136, 136, 136), ('卫三', 132, 132, 132),
            ('蒋四', 128, 128, 128), ('沈五', 124, 124, 124), ('韩六', 110, 110, 110),
            ('杨七', 105, 105, 105), ('朱八', 100, 100, 100), ('秦九', 95, 95, 95), ('尤十', 90, 90, 90),
        ]
        idx = 1
        for cls, items in (('01', c1_scores), ('02', c2_scores)):
            for name, yw, sx, yy in items:
                rows.append({
                    'id': f'S{idx:03d}',
                    'source_row': idx + 1,
                    'class': cls,
                    'name': name,
                    'scores': {'语文': yw, '数学': sx, '英语': yy},
                    'identity_reliable': True,
                })
                idx += 1

        ds = _make_dataset(rows)
        status, raw, _ = self._req('/api/exams', {'dataset': ds})
        self.assertEqual(status, 200)
        exam_id = json.loads(raw)['id']

        # 1. Verify class_brief exposes median, mean_median_gap, distribution_shape
        status, raw, _ = self._req('/api/class-brief', {'exam_id': exam_id, 'class': '01'})
        self.assertEqual(status, 200)
        brief = json.loads(raw)
        hl = brief['headline']
        self.assertIsNotNone(hl['median'])
        self.assertIsNotNone(hl['mean_median_gap'])
        self.assertEqual(hl['distribution_shape']['type'], 'tail_heavy')
        self.assertTrue(any('形态：' in t['text'] for t in hl['tags']))
        self.assertTrue(any('分布形态判型' in p for p in hl['talking_points']))

        # 2. Verify /api/student-cards includes data_version, edit_count, and class_mean
        status, raw, _ = self._req('/api/student-cards', {'exam_id': exam_id, 'class': '01'})
        self.assertEqual(status, 200)
        cards_res = json.loads(raw)
        self.assertEqual(cards_res['meta']['data_version'], 1)
        self.assertEqual(cards_res['meta']['edit_count'], 0)
        self.assertIsNotNone(cards_res['cards'][0]['subjects'][0]['class_mean'])

        # 3. Verify GET /api/exams/<id>/student-cards.zip (hide_score=1)
        status, zip_bytes, headers = self._req(
            f'/api/exams/{exam_id}/student-cards.zip?class=01&hide_rank=1&hide_score=1'
        )
        self.assertEqual(status, 200)
        self.assertIn('application/zip', headers.get('Content-Type', ''))
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf:
            names = zf.namelist()
            self.assertIn('使用说明.txt', names)
            html_files = [n for n in names if n.endswith('.html')]
            self.assertEqual(len(html_files), 10)
            target_file = next(n for n in html_files if '张一' in n)
            content = zf.read(target_file).decode('utf-8')
            self.assertIn('张一', content)
            self.assertIn('数据版本 v1', content)
            self.assertIn('仅等级与相对强弱', content)
            self.assertIn('<svg class="sc-radar"', content)
            # Zero other-student exposure!
            self.assertNotIn('李二', content)
            self.assertNotIn('陈一', content)
            # Raw score hidden in hide_score=1 mode
            self.assertNotIn('354.0', content)


if __name__ == '__main__':
    unittest.main()
