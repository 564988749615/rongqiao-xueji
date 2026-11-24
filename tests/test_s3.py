"""Unit and end-to-end tests for zero-dependency S3 / Bitiful storage support."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen
from xml.sax.saxutils import escape as xml_escape

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import s3_store
import server


class _MockS3State:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.last_auth: str = ''


def _make_mock_s3_handler(state: _MockS3State, expected_bucket: str, expected_ak: str):
    class MockS3Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _check_auth(self) -> bool:
            auth = self.headers.get('Authorization', '')
            state.last_auth = auth
            if not auth.startswith('AWS4-HMAC-SHA256 ') or f'Credential={expected_ak}/' not in auth:
                self.send_response(403)
                body = b'<Error><Code>InvalidAccessKeyId</Code><Message>Bad key</Message></Error>'
                self.send_header('Content-Type', 'application/xml')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return False
            return True

        def _parse_bucket_key(self) -> tuple[str, str]:
            parsed = urlparse(self.path)
            path = unquote(parsed.path).lstrip('/')
            parts = path.split('/', 1)
            bucket = parts[0] if parts else ''
            key = parts[1] if len(parts) > 1 else ''
            return bucket, key

        def do_GET(self):
            if not self._check_auth():
                return
            bucket, key = self._parse_bucket_key()
            if bucket != expected_bucket:
                self.send_response(404)
                body = b'<Error><Code>NoSuchBucket</Code><Message>Not found</Message></Error>'
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            qs = parse_qs(urlparse(self.path).query)
            if not key and qs.get('list-type') == ['2']:
                prefix = qs.get('prefix', [''])[0]
                nodes = []
                for obj_key, (data, modified) in sorted(state.objects.items()):
                    if obj_key.startswith(prefix):
                        nodes.append(
                            f'<Contents><Key>{xml_escape(obj_key)}</Key>'
                            f'<LastModified>{modified}</LastModified>'
                            f'<Size>{len(data)}</Size></Contents>'
                        )
                xml = (
                    '<?xml version="1.0" encoding="UTF-8"?>'
                    '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                    + ''.join(nodes)
                    + '</ListBucketResult>'
                ).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/xml')
                self.send_header('Content-Length', str(len(xml)))
                self.end_headers()
                self.wfile.write(xml)
                return
            if key not in state.objects:
                self.send_response(404)
                body = b'<Error><Code>NoSuchKey</Code><Message>Missing</Message></Error>'
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            data, _ = state.objects[key]
            self.send_response(200)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_PUT(self):
            if not self._check_auth():
                return
            bucket, key = self._parse_bucket_key()
            if bucket != expected_bucket or not key:
                self.send_response(404)
                self.end_headers()
                return
            length = int(self.headers.get('Content-Length', '0'))
            data = self.rfile.read(length)
            modified = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
            state.objects[key] = (data, modified)
            self.send_response(200)
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_DELETE(self):
            if not self._check_auth():
                return
            bucket, key = self._parse_bucket_key()
            if bucket == expected_bucket:
                state.objects.pop(key, None)
            self.send_response(204)
            self.end_headers()

    return MockS3Handler


class S3StoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s3_state = _MockS3State()
        cls.s3_httpd = ThreadingHTTPServer(
            ('127.0.0.1', 0),
            _make_mock_s3_handler(cls.s3_state, 'rongqiao-bucket', 'AK_BITIFUL_TEST'),
        )
        cls.s3_thread = threading.Thread(target=cls.s3_httpd.serve_forever, daemon=True)
        cls.s3_thread.start()
        cls.s3_endpoint = f'http://127.0.0.1:{cls.s3_httpd.server_port}'

        cls.folder = tempfile.TemporaryDirectory(prefix='zhixu-s3-test-')
        server.DATA = Path(cls.folder.name)
        server.init_db()

        class Quiet(server.Handler):
            def log_message(self, *args):
                pass

        cls.app_httpd = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
        cls.app_thread = threading.Thread(target=cls.app_httpd.serve_forever, daemon=True)
        cls.app_thread.start()
        cls.base = f'http://127.0.0.1:{cls.app_httpd.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.app_httpd.shutdown()
        cls.app_httpd.server_close()
        cls.app_thread.join()
        cls.s3_httpd.shutdown()
        cls.s3_httpd.server_close()
        cls.s3_thread.join()
        cls.folder.cleanup()

    def setUp(self):
        self.s3_state.objects.clear()
        with server.db() as conn:
            conn.execute('DELETE FROM teachers')
            conn.execute('DELETE FROM notes')
            conn.execute('DELETE FROM exams')
            conn.execute('DELETE FROM settings')
        server.invalidate_cache()

    def call(self, path, body=None):
        req = Request(
            self.base + path,
            headers={'Content-Type': 'application/json'},
            data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
        )
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())

    def test_sigv4_signing_and_bitiful_defaults(self):
        cfg = s3_store.validate_config({
            'provider': 'bitiful',
            'endpoint': 'https://s3.bitiful.net',
            'region': 'cn-east-1',
            'bucket': 'school-archive',
            'access_key': 'AK123',
            'secret_key': 'SK456',
            'prefix': 'rongqiao-xueji',
            'path_style': True,
        })
        self.assertEqual(cfg['prefix'], 'rongqiao-xueji/')
        fixed_dt = datetime(2026, 11, 22, 12, 0, 0, tzinfo=timezone.utc)
        url, headers = s3_store.sign_s3_request(
            cfg, 'PUT', 'rongqiao-xueji/snapshots/测试.json.gz', body=b'hello', now_dt=fixed_dt
        )
        self.assertIn('https://s3.bitiful.net/school-archive/rongqiao-xueji/snapshots/', url)
        self.assertTrue(headers['Authorization'].startswith('AWS4-HMAC-SHA256 Credential=AK123/20261122/cn-east-1/s3/aws4_request'))
        self.assertEqual(headers['Host'], 's3.bitiful.net')

        # Virtual-hosted style switches Host to <bucket>.<host>
        vh_cfg = {**cfg, 'path_style': False}
        vh_url, vh_headers = s3_store.sign_s3_request(vh_cfg, 'GET', 'rongqiao-xueji/latest.json.gz', now_dt=fixed_dt)
        self.assertTrue(vh_url.startswith('https://school-archive.s3.bitiful.net/rongqiao-xueji/latest.json.gz'))
        self.assertEqual(vh_headers['Host'], 'school-archive.s3.bitiful.net')

    def test_s3_config_backup_list_restore_and_delete_roundtrip(self):
        # 1. Default unconfigured state uses Bitiful preset
        init_cfg = self.call('/api/s3/config')
        self.assertFalse(init_cfg['config']['configured'])
        self.assertEqual(init_cfg['config']['endpoint'], 'https://s3.bitiful.net')
        self.assertEqual(init_cfg['config']['region'], 'cn-east-1')

        # 2. Save S3 config targeting mock S3 server and verify secret masking
        s3_cfg = {
            'provider': 'bitiful',
            'endpoint': self.s3_endpoint,
            'region': 'cn-east-1',
            'bucket': 'rongqiao-bucket',
            'access_key': 'AK_BITIFUL_TEST',
            'secret_key': 'SUPER_SECRET_KEY_9999',
            'prefix': 'rongqiao-xueji/',
            'path_style': True,
            'auto_sync': False,
        }
        saved = self.call('/api/s3/config', {'config': s3_cfg})
        self.assertTrue(saved['config']['configured'])
        self.assertTrue(saved['config']['has_secret'])
        self.assertNotIn('secret_key', saved['config'])
        self.assertTrue(saved['config']['secret_key_masked'].endswith('9999'))

        # Updating without secret_key preserves stored secret
        updated = self.call('/api/s3/config', {'config': {**s3_cfg, 'secret_key': '', 'prefix': 'school-a/'}})
        self.assertEqual(updated['config']['prefix'], 'school-a/')
        self.assertTrue(updated['config']['has_secret'])

        # 3. Test connection
        tested = self.call('/api/s3/test', {})
        self.assertTrue(tested['ok'])
        self.assertEqual(tested['bucket'], 'rongqiao-bucket')

        # 4. Seed local exam, note, default rules, and ensure /api/backup never leaks S3 secret
        csv = '班级,学号,姓名,语文,数学\n01,001,张一,120,130\n02,002,李二,110,115\n'
        ds = self.call('/api/import', {
            'filename': '期末.csv',
            'content': base64.b64encode(csv.encode()).decode(),
            'metadata': {'name': '初三上期末', 'grade': '初2027届', 'date': '2026-11-20'},
        })
        self.call('/api/exams', {'dataset': ds})
        self.call('/api/notes', {'exam_id': ds['id'], 'class': '01', 'text': '重点关注数学临界生'})
        local_backup = self.call('/api/backup')
        self.assertNotIn('SUPER_SECRET_KEY_9999', json.dumps(local_backup))

        # 5. Upload snapshot to S3
        up = self.call('/api/s3/backup', {'label': 'manual'})
        self.assertTrue(up['ok'])
        self.assertEqual(up['exam_count'], 1)
        self.assertTrue(up['key'].startswith('school-a/snapshots/'))
        self.assertIn('school-a/latest.json.gz', self.s3_state.objects)

        # 6. List cloud snapshots
        listed = self.call('/api/s3/backups')
        keys = [x['key'] for x in listed['snapshots']]
        self.assertIn('school-a/latest.json.gz', keys)
        self.assertIn(up['key'], keys)

        # 7. Wipe local exams/notes and restore cleanly from S3
        with server.db() as conn:
            conn.execute('DELETE FROM notes')
            conn.execute('DELETE FROM exams')
        server.invalidate_cache()
        self.assertEqual(self.call('/api/exams')['exams'], [])

        restored = self.call('/api/s3/restore', {'key': up['key']})
        self.assertTrue(restored['ok'])
        self.assertEqual(restored['count'], 1)
        self.assertEqual(len(self.call('/api/exams')['exams']), 1)
        self.assertEqual(len(self.call('/api/notes?exam_id=' + ds['id'])['notes']), 1)

        # 8. Delete snapshot works inside prefix and rejects outside prefix
        deleted = self.call('/api/s3/delete', {'key': up['key']})
        self.assertTrue(deleted['ok'])
        self.assertNotIn(up['key'], self.s3_state.objects)
        with self.assertRaises(ValueError):
            s3_store.delete_snapshot({**s3_cfg, 'prefix': 'school-a/'}, 'other-folder/secret.json')


if __name__ == '__main__':
    unittest.main()
