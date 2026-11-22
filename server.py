"""Local-only score analysis service. No cloud accounts or external requests."""
from __future__ import annotations

import argparse
import base64
import binascii
from collections import OrderedDict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import sqlite3
import sys
import threading
from urllib.parse import parse_qs, quote, unquote, urlparse
import uuid

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
DATA = Path(os.environ.get('ZHIXU_DATA_DIR', str(ROOT / 'data'))).resolve()
VERSION = '1.1.0'
MAX_REQUEST = 32 * 1024 * 1024
sys.path.insert(0, str(ROOT / '.runtime'))

from class_brief import build_class_brief
from engine import (
    PORTABLE_RULE_KEYS,
    analyze,
    validate_dataset as _validate_dataset_core,
    validate_portable_rules,
)
from exporter import export_workbook
from history import calculate_history as _calculate_history_core
from workbook import normalize_class, parse_teachers_workbook, parse_workbook

_CACHE_LOCK = threading.Lock()
_ANALYSIS_CACHE: OrderedDict[tuple, dict] = OrderedDict()
_CACHE_LIMIT = 64

_EXAM_META_COLUMNS = (
    ('name', "TEXT NOT NULL DEFAULT ''"),
    ('grade', "TEXT NOT NULL DEFAULT ''"),
    ('exam_date', "TEXT NOT NULL DEFAULT ''"),
    ('filename', "TEXT NOT NULL DEFAULT ''"),
    ('imported_at', "TEXT NOT NULL DEFAULT ''"),
    ('row_count', 'INTEGER NOT NULL DEFAULT 0'),
    ('subject_count', 'INTEGER NOT NULL DEFAULT 0'),
)
_SUMMARY_SQL = (
    'SELECT id, name, grade, exam_date, filename, imported_at, row_count, subject_count, '
    'rules, archived, created_at, updated_at FROM exams'
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def encode(value) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def invalidate_cache(exam_id: str | None = None) -> None:
    with _CACHE_LOCK:
        if exam_id is None:
            _ANALYSIS_CACHE.clear()
            return
        for key in [k for k in _ANALYSIS_CACHE if k[1] == exam_id]:
            _ANALYSIS_CACHE.pop(key, None)


def db() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(DATA / 'zhixu.sqlite3'), timeout=20)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    return connection


def init_db() -> None:
    with db() as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript('''
          CREATE TABLE IF NOT EXISTS exams (
            id TEXT PRIMARY KEY, dataset TEXT NOT NULL, rules TEXT NOT NULL,
            archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '', grade TEXT NOT NULL DEFAULT '',
            exam_date TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '',
            imported_at TEXT NOT NULL DEFAULT '', row_count INTEGER NOT NULL DEFAULT 0,
            subject_count INTEGER NOT NULL DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id),
            class_name TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS teachers (
            exam_id TEXT NOT NULL REFERENCES exams(id),
            class_name TEXT NOT NULL,
            homeroom TEXT NOT NULL DEFAULT '',
            subjects TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (exam_id, class_name)
          );
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        ''')
        existing_cols = {row['name'] for row in conn.execute('PRAGMA table_info(exams)').fetchall()}
        for col_name, col_def in _EXAM_META_COLUMNS:
            if col_name not in existing_cols:
                conn.execute(f'ALTER TABLE exams ADD COLUMN {col_name} {col_def}')
        # Backfill metadata columns for any legacy rows migrated from earlier versions.
        to_backfill = conn.execute(
            "SELECT id, dataset, created_at FROM exams WHERE name='' AND row_count=0"
        ).fetchall()
        for row in to_backfill:
            d = json.loads(row['dataset'])
            conn.execute(
                'UPDATE exams SET name=?, grade=?, exam_date=?, filename=?, imported_at=?, row_count=?, subject_count=? WHERE id=?',
                (
                    d.get('name', '未命名考试'),
                    d.get('grade', '未分年级'),
                    d.get('date', ''),
                    d.get('filename', ''),
                    d.get('imported_at', row['created_at']),
                    len(d.get('rows', [])),
                    len(d.get('subjects', [])),
                    row['id'],
                ),
            )
        conn.execute(
            'CREATE INDEX IF NOT EXISTS idx_exams_archived_grade ON exams(archived, grade, exam_date, created_at)'
        )
    invalidate_cache()


def validate_dataset(dataset):
    if not isinstance(dataset, dict):
        raise ValueError('请先导入原始成绩表。')
    _validate_dataset_core(dataset, require_rows=True)
    if not dataset.get('id'):
        dataset['id'] = uuid.uuid4().hex
    return dataset


def get_default_rules() -> dict:
    with db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='default_rules'").fetchone()
    if row is None:
        return {}
    try:
        parsed = json.loads(row['value'])
        return parsed if isinstance(parsed, dict) else {}
    except ValueError:
        return {}


def save_default_rules(raw: dict) -> dict:
    cleaned = validate_portable_rules(raw)
    with db() as conn:
        conn.execute(
            '''INSERT INTO settings(key, value, updated_at) VALUES('default_rules', ?, ?)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at''',
            (encode(cleaned), now()),
        )
    return cleaned


def _portable_subset(rules: dict) -> dict:
    return {k: rules[k] for k in PORTABLE_RULE_KEYS if k in rules}


def _dataset_meta(dataset: dict, fallback_created_at: str) -> tuple:
    return (
        dataset.get('name', '未命名考试'),
        dataset.get('grade', '未分年级'),
        dataset.get('date', ''),
        dataset.get('filename', ''),
        dataset.get('imported_at', fallback_created_at),
        len(dataset.get('rows', [])),
        len(dataset.get('subjects', [])),
    )


def exam_summary(row) -> dict:
    keys = row.keys()
    if 'row_count' in keys and (row['name'] or row['row_count']):
        return dict(
            id=row['id'],
            name=row['name'] or '未命名考试',
            grade=row['grade'] or '未分年级',
            date=row['exam_date'] or '',
            filename=row['filename'] or '',
            imported_at=row['imported_at'] or row['created_at'],
            row_count=row['row_count'],
            subject_count=row['subject_count'],
            rules=json.loads(row['rules']),
            archived=bool(row['archived']),
            created_at=row['created_at'],
        )
    d = json.loads(row['dataset'])
    return dict(
        id=row['id'],
        name=d.get('name', '未命名考试'),
        grade=d.get('grade', '未分年级'),
        date=d.get('date', ''),
        filename=d.get('filename', ''),
        imported_at=d.get('imported_at', row['created_at']),
        row_count=len(d['rows']),
        subject_count=len(d['subjects']),
        rules=json.loads(row['rules']),
        archived=bool(row['archived']),
        created_at=row['created_at'],
    )


def get_exam(exam_id: str):
    with db() as conn:
        row = conn.execute('SELECT * FROM exams WHERE id=?', (exam_id,)).fetchone()
    if row is None:
        raise ValueError('找不到这场考试，请刷新考试列表。')
    return row


def example_dataset() -> dict:
    """Return the local sample when present, otherwise a small synthetic demo."""
    source = ROOT / '样例' / '原始数据.xlsx'
    if source.is_file():
        return parse_workbook(
            source.read_bytes(), source.name, dict(name='初三定时练习（二）', grade='初三', date='2026-10-19')
        )
    demo = (
        '班级,学号,姓名,语文,数学,英语\n'
        '01,DEMO-001,演示甲,86,92,88\n'
        '01,DEMO-002,演示乙,78,84,81\n'
        '02,DEMO-003,演示丙,93,89,95\n'
        '02,DEMO-004,演示丁,71,76,80\n'
    ).encode('utf-8')
    return parse_workbook(demo, '演示成绩.csv', dict(name='演示成绩', grade='初三', date='2026-10-19'))


def exam_analysis(row, rules=None, *, include_tables: bool = True) -> dict:
    effective_rules = json.loads(row['rules']) if rules is None else rules
    rules_key = row['rules'] if rules is None else encode(rules)
    cache_key = (str(DATA), row['id'], row['updated_at'], rules_key, include_tables)
    with _CACHE_LOCK:
        cached = _ANALYSIS_CACHE.get(cache_key)
        if cached is not None:
            _ANALYSIS_CACHE.move_to_end(cache_key)
            return cached
    result = analyze(json.loads(row['dataset']), effective_rules, include_tables=include_tables)
    with _CACHE_LOCK:
        _ANALYSIS_CACHE[cache_key] = result
        _ANALYSIS_CACHE.move_to_end(cache_key)
        while len(_ANALYSIS_CACHE) > _CACHE_LIMIT:
            _ANALYSIS_CACHE.popitem(last=False)
    return result


def get_teachers_map(conn, exam_id: str) -> dict:
    rows = conn.execute(
        'SELECT class_name, homeroom, subjects FROM teachers WHERE exam_id=?', (exam_id,)
    ).fetchall()
    result = {}
    for row in rows:
        try:
            subs = json.loads(row['subjects']) if row['subjects'] else {}
        except ValueError:
            subs = {}
        result[row['class_name']] = {'homeroom': row['homeroom'] or '', 'subjects': subs if isinstance(subs, dict) else {}}
    return result


def save_teachers_rows(conn, exam_id: str, rows: list[dict]) -> int:
    timestamp = now()
    count = 0
    for item in rows:
        if not isinstance(item, dict):
            continue
        cls = normalize_class(item.get('class', ''))
        if not cls:
            continue
        homeroom = str(item.get('homeroom', '')).strip()[:60]
        raw_subs = item.get('subjects', {})
        subs = {}
        if isinstance(raw_subs, dict):
            for k, v in raw_subs.items():
                key = str(k).strip()[:40]
                val = str(v).strip()[:60]
                if key and val:
                    subs[key] = val
        conn.execute(
            '''INSERT INTO teachers(exam_id, class_name, homeroom, subjects, updated_at)
               VALUES(?,?,?,?,?)
               ON CONFLICT(exam_id, class_name) DO UPDATE SET
                 homeroom=excluded.homeroom, subjects=excluded.subjects, updated_at=excluded.updated_at''',
            (exam_id, cls, homeroom, encode(subs), timestamp),
        )
        count += 1
    return count


def calculate_history(payload: dict) -> dict:
    grade = str(payload.get('grade', ''))
    with db() as conn:
        saved = conn.execute(
            'SELECT * FROM exams WHERE archived=0 AND grade=? ORDER BY exam_date, created_at, id',
            (grade,),
        ).fetchall()
    return _calculate_history_core(saved, payload, exam_analysis, exam_summary)


class Handler(BaseHTTPRequestHandler):
    server_version = 'RongqiaoXueji/1.1'

    def log_message(self, fmt, *args):
        # Request paths only; never log uploaded records or passwords.
        print(f'[{now()}] {fmt % args}', flush=True)

    def send(self, value, status=200, mime='application/json; charset=utf-8', filename=None):
        content = value if isinstance(value, bytes) else encode(value).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'same-origin')
        if filename:
            self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(filename))
        self.end_headers()
        self.wfile.write(content)

    def error(self, text, status=400):
        self.send({'error': str(text)}, status)

    def do_GET(self):
        try:
            self.get_route()
        except (ValueError, KeyError, TypeError) as exc:
            self.error(str(exc))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            print(f'GET failed: {type(exc).__name__}', file=sys.stderr)
            self.error('读取未完成，请查看启动窗口或重试。', 500)

    def get_route(self):
        parsed = urlparse(self.path)
        path, query = unquote(parsed.path), parse_qs(parsed.query)
        if path == '/api/health':
            return self.send(dict(ok=True, version=VERSION, storage='本机 SQLite'))
        if path == '/api/example':
            return self.send(example_dataset())
        if path == '/api/exams':
            archived = 1 if query.get('archived') == ['1'] else 0
            with db() as conn:
                rows = conn.execute(
                    f'{_SUMMARY_SQL} WHERE archived=? ORDER BY created_at DESC', (archived,)
                ).fetchall()
            return self.send(dict(exams=[exam_summary(r) for r in rows]))
        match = re.fullmatch(r'/api/exams/([^/]+)', path)
        if match:
            row = get_exam(match.group(1))
            return self.send(dict(dataset=json.loads(row['dataset']), rules=json.loads(row['rules'])))
        if path == '/api/trends':
            grade = query.get('grade', [''])[0]
            with db() as conn:
                rows = conn.execute(
                    'SELECT * FROM exams WHERE archived=0 AND grade=? ORDER BY exam_date, created_at, id',
                    (grade,),
                ).fetchall()
            data = []
            for row in rows:
                info = exam_summary(row)
                result = exam_analysis(row, include_tables=False)
                data.append(
                    {k: info[k] for k in ('id', 'name', 'date', 'grade')}
                    | {k: result[k] for k in ('summary', 'subject_stats', 'class_stats')}
                    | {'rules': result['rules']}
                )
            return self.send(dict(exams=data))
        if path == '/api/school':
            with db() as conn:
                summary_rows = conn.execute(
                    f'{_SUMMARY_SQL} WHERE archived=0 ORDER BY exam_date, created_at, id'
                ).fetchall()
                latest_ids = {}
                for row in summary_rows:
                    latest_ids[row['grade'] or '未分年级'] = row['id']
                grades = []
                for grade_name, exam_id in sorted(latest_ids.items()):
                    full_row = conn.execute('SELECT * FROM exams WHERE id=?', (exam_id,)).fetchone()
                    if full_row is not None:
                        grades.append(
                            dict(
                                grade=grade_name,
                                exam=exam_summary(full_row),
                                analysis=exam_analysis(full_row, include_tables=False),
                            )
                        )
            totals = dict(
                grades=len(grades),
                classes=sum(len(g['analysis']['classes']) for g in grades),
                registered=sum(g['analysis']['summary']['registered'] for g in grades),
                participants=sum(g['analysis']['summary']['participants'] for g in grades),
            )
            return self.send(dict(grades=grades, totals=totals, exam_count=len(summary_rows)))
        if path == '/api/teachers':
            exam_id = query.get('exam_id', [''])[0]
            get_exam(exam_id)
            with db() as conn:
                tmap = get_teachers_map(conn, exam_id)
            return self.send(
                dict(
                    exam_id=exam_id,
                    teachers=[
                        dict(exam_id=exam_id, **{'class': cls}, homeroom=val['homeroom'], subjects=val['subjects'])
                        for cls, val in sorted(tmap.items())
                    ],
                )
            )
        if path == '/api/notes':
            exam_id = query.get('exam_id', [''])[0]
            with db() as conn:
                rows = conn.execute(
                    'SELECT * FROM notes WHERE exam_id=? ORDER BY created_at DESC, rowid DESC', (exam_id,)
                ).fetchall()
            return self.send(
                dict(
                    notes=[
                        dict(
                            id=r['id'],
                            exam_id=r['exam_id'],
                            **{'class': r['class_name']},
                            text=r['text'],
                            created_at=r['created_at'],
                        )
                        for r in rows
                    ]
                )
            )
        if path == '/api/default-rules':
            saved = get_default_rules()
            return self.send(dict(rules=validate_portable_rules(saved), has_custom=bool(saved)))
        if path == '/api/backup':
            with db() as conn:
                exams = [
                    dict(
                        id=r['id'],
                        dataset=json.loads(r['dataset']),
                        rules=json.loads(r['rules']),
                        archived=bool(r['archived']),
                        created_at=r['created_at'],
                    )
                    for r in conn.execute('SELECT * FROM exams')
                ]
                notes = [dict(r) for r in conn.execute('SELECT * FROM notes')]
                teachers = [dict(r) for r in conn.execute('SELECT * FROM teachers')]
            backup = dict(
                format='zhixu-backup',
                version=1,
                exported_at=now(),
                exams=exams,
                notes=notes,
                teachers=teachers,
                default_rules=get_default_rules(),
            )
            return self.send(
                encode(backup).encode(), mime='application/json; charset=utf-8', filename='融侨学迹备份.json'
            )
        if path.startswith('/api/'):
            return self.error('没有这个接口。', 404)
        target = (WEB / (path.lstrip('/') or 'index.html')).resolve()
        if WEB.resolve() not in target.parents or not target.is_file():
            return self.error('页面不存在。', 404)
        mime = (mimetypes.guess_type(target.name)[0] or 'application/octet-stream') + (
            '; charset=utf-8' if target.suffix in ('.html', '.js', '.css') else ''
        )
        return self.send(target.read_bytes(), mime=mime)

    def do_POST(self):
        try:
            origin = self.headers.get('Origin')
            if origin and urlparse(origin).netloc != self.headers.get('Host'):
                return self.error('此操作仅允许从本机软件页面发起。', 403)
            if 'application/json' not in self.headers.get('Content-Type', ''):
                return self.error('请使用软件页面提交。', 415)
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > MAX_REQUEST:
                return self.error('请求过大或为空，文件请控制在20MB以内。', 413)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('请求格式不正确。')
            self.post_route(unquote(urlparse(self.path).path), payload)
        except (ValueError, KeyError, TypeError, binascii.Error) as exc:
            self.error(str(exc))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            print(f'POST failed: {type(exc).__name__}: {str(exc)[:180]}', file=sys.stderr)
            self.error('操作未完成，原有数据已保留。请检查文件格式或重试。', 500)

    def post_route(self, path: str, payload: dict):
        if path == '/api/shutdown':
            self.send(dict(ok=True, message='融侨学迹本机服务正在安全关闭。'))
            threading.Timer(0.2, self.server.shutdown).start()
            return
        if path == '/api/import':
            filename = Path(str(payload.get('filename', '成绩.xlsx'))).name
            content = base64.b64decode(payload.get('content', ''), validate=True)
            if len(content) > 20 * 1024 * 1024:
                raise ValueError('文件超过20MB，请拆分后导入。')
            dataset = parse_workbook(content, filename, payload.get('metadata') or {}, payload.get('password'))
            validate_dataset(dataset)
            return self.send(dataset)
        if path == '/api/analyze':
            if payload.get('exam_id'):
                return self.send(exam_analysis(get_exam(payload['exam_id']), payload.get('rules')))
            return self.send(analyze(validate_dataset(payload.get('dataset')), payload.get('rules')))
        if path == '/api/default-rules':
            if payload.get('reset'):
                with db() as conn:
                    conn.execute("DELETE FROM settings WHERE key='default_rules'")
                return self.send(dict(ok=True, rules=validate_portable_rules({}), has_custom=False))
            saved = save_default_rules(payload.get('rules', {}))
            return self.send(dict(ok=True, rules=saved, has_custom=True))
        if path == '/api/exams':
            dataset = validate_dataset(payload.get('dataset'))
            if not dataset.get('grade') or not dataset.get('name') or not dataset.get('date'):
                raise ValueError('保存考试前，请填写考试名称、年级和日期。')
            try:
                datetime.strptime(dataset['date'], '%Y-%m-%d')
            except ValueError:
                raise ValueError('考试日期应为年月日，例如2026-10-19。')
            incoming_rules = payload.get('rules')
            if not incoming_rules:
                default_rules = get_default_rules()
                incoming_rules = default_rules or None
            result = analyze(dataset, incoming_rules, include_tables=False)
            timestamp = now()
            meta = _dataset_meta(dataset, timestamp)
            with db() as conn:
                conn.execute(
                    '''INSERT INTO exams(
                         id, dataset, rules, created_at, updated_at,
                         name, grade, exam_date, filename, imported_at, row_count, subject_count
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET
                         dataset=excluded.dataset, rules=excluded.rules, updated_at=excluded.updated_at,
                         name=excluded.name, grade=excluded.grade, exam_date=excluded.exam_date,
                         filename=excluded.filename, imported_at=excluded.imported_at,
                         row_count=excluded.row_count, subject_count=excluded.subject_count''',
                    (dataset['id'], encode(dataset), encode(result['rules']), timestamp, timestamp, *meta),
                )
            invalidate_cache(dataset['id'])
            return self.send(exam_summary(get_exam(dataset['id'])))
        match = re.fullmatch(r'/api/exams/([^/]+)/(rules|meta|archive|restore|delete)', path)
        if match:
            exam_id, action = match.groups()
            row = get_exam(exam_id)
            if action == 'rules':
                result = exam_analysis(row, payload.get('rules', {}), include_tables=False)
                portable = _portable_subset(result['rules'])
                saved_default = False
                synced_exams = 1
                timestamp = now()
                with db() as conn:
                    conn.execute(
                        'UPDATE exams SET rules=?, updated_at=? WHERE id=?',
                        (encode(result['rules']), timestamp, exam_id),
                    )
                    if payload.get('apply_to_grade'):
                        grade_name = exam_summary(row)['grade']
                        siblings = conn.execute(
                            'SELECT * FROM exams WHERE archived=0 AND grade=? AND id!=?',
                            (grade_name, exam_id),
                        ).fetchall()
                        for sib in siblings:
                            sib_ds = json.loads(sib['dataset'])
                            sib_rules = json.loads(sib['rules'])
                            merged = {**sib_rules, **portable}
                            if 'full_marks' in portable:
                                merged['full_marks'] = {
                                    **(sib_rules.get('full_marks') or {}),
                                    **{s: v for s, v in portable['full_marks'].items() if s in sib_ds['subjects']},
                                }
                            validated = analyze(sib_ds, merged, include_tables=False)
                            conn.execute(
                                'UPDATE exams SET rules=?, updated_at=? WHERE id=?',
                                (encode(validated['rules']), timestamp, sib['id']),
                            )
                            invalidate_cache(sib['id'])
                            synced_exams += 1
                if payload.get('save_as_default'):
                    save_default_rules(portable)
                    saved_default = True
                invalidate_cache(exam_id)
                summary_obj = exam_summary(get_exam(exam_id))
                summary_obj['synced_exams'] = synced_exams
                summary_obj['saved_default'] = saved_default
                return self.send(summary_obj)
            if action == 'meta':
                name = str(payload.get('name', '')).strip()
                grade = str(payload.get('grade', '')).strip()
                date = str(payload.get('date', '')).strip()
                if not name or not grade or not date:
                    raise ValueError('考试名称、年级和日期均不能为空。')
                if len(name) > 300 or len(grade) > 300:
                    raise ValueError('考试名称或年级过长。')
                try:
                    datetime.strptime(date, '%Y-%m-%d')
                except ValueError:
                    raise ValueError('考试日期应为年月日，例如2026-10-19。')
                dataset = json.loads(row['dataset'])
                dataset['name'], dataset['grade'], dataset['date'] = name, grade, date
                with db() as conn:
                    conn.execute(
                        'UPDATE exams SET dataset=?, name=?, grade=?, exam_date=?, updated_at=? WHERE id=?',
                        (encode(dataset), name, grade, date, now(), exam_id),
                    )
                invalidate_cache(exam_id)
                return self.send(exam_summary(get_exam(exam_id)))
            if action == 'delete':
                if not row['archived']:
                    raise ValueError('请先归档该考试，再执行彻底删除。')
                with db() as conn:
                    conn.execute('DELETE FROM teachers WHERE exam_id=?', (exam_id,))
                    conn.execute('DELETE FROM notes WHERE exam_id=?', (exam_id,))
                    conn.execute('DELETE FROM exams WHERE id=?', (exam_id,))
                invalidate_cache(exam_id)
                return self.send(dict(ok=True))
            with db() as conn:
                conn.execute(
                    'UPDATE exams SET archived=?, updated_at=? WHERE id=?',
                    (1 if action == 'archive' else 0, now(), exam_id),
                )
            invalidate_cache(exam_id)
            return self.send(dict(ok=True))
        if path == '/api/notes':
            exam_id = str(payload.get('exam_id', ''))
            get_exam(exam_id)
            message = str(payload.get('text', '')).strip()
            if not message or len(message) > 20000:
                raise ValueError('跟进记录应为1至20,000字。')
            note = dict(
                id=uuid.uuid4().hex,
                exam_id=exam_id,
                **{'class': str(payload.get('class', ''))[:60]},
                text=message,
                created_at=now(),
            )
            with db() as conn:
                conn.execute(
                    'INSERT INTO notes VALUES(?,?,?,?,?)',
                    (note['id'], exam_id, note['class'], message, note['created_at']),
                )
            return self.send(note)
        note_match = re.fullmatch(r'/api/notes/([^/]+)/(update|delete)', path)
        if note_match:
            note_id, action = note_match.groups()
            with db() as conn:
                existing = conn.execute('SELECT * FROM notes WHERE id=?', (note_id,)).fetchone()
                if existing is None:
                    raise ValueError('找不到这条教研记录，请刷新后重试。')
                if action == 'delete':
                    conn.execute('DELETE FROM notes WHERE id=?', (note_id,))
                else:
                    message = str(payload.get('text', '')).strip()
                    if not message or len(message) > 20000:
                        raise ValueError('跟进记录应为1至20,000字。')
                    cls = str(payload.get('class', existing['class_name']))[:60]
                    conn.execute('UPDATE notes SET class_name=?, text=? WHERE id=?', (cls, message, note_id))
            if action == 'delete':
                return self.send(dict(ok=True))
            return self.send(
                dict(
                    id=existing['id'],
                    exam_id=existing['exam_id'],
                    **{'class': cls},
                    text=message,
                    created_at=existing['created_at'],
                )
            )
        if path == '/api/teachers':
            exam_id = str(payload.get('exam_id', ''))
            get_exam(exam_id)
            rows = payload.get('rows', [])
            if not isinstance(rows, list) or len(rows) > 500:
                raise ValueError('教师配置数据格式不正确。')
            with db() as conn:
                updated = save_teachers_rows(conn, exam_id, rows)
                tmap = get_teachers_map(conn, exam_id)
            return self.send(
                dict(
                    ok=True,
                    updated=updated,
                    teachers=[
                        dict(exam_id=exam_id, **{'class': cls}, homeroom=val['homeroom'], subjects=val['subjects'])
                        for cls, val in sorted(tmap.items())
                    ],
                )
            )
        if path == '/api/teachers/import':
            filename = Path(str(payload.get('filename', '教师基本信息.xlsx'))).name
            content = base64.b64decode(payload.get('content', ''), validate=True)
            if len(content) > 20 * 1024 * 1024:
                raise ValueError('文件超过20MB，请精简后导入。')
            parsed = parse_teachers_workbook(content, filename, payload.get('password'))
            fallback_exam_id = str(payload.get('exam_id', '')).strip()
            grade = str(payload.get('grade', '')).strip()
            if fallback_exam_id:
                row = get_exam(fallback_exam_id)
                if not grade:
                    grade = exam_summary(row)['grade']
            with db() as conn:
                if grade:
                    grade_rows = conn.execute(
                        f'{_SUMMARY_SQL} WHERE archived=0 AND grade=?', (grade,)
                    ).fetchall()
                else:
                    grade_rows = conn.execute(f'{_SUMMARY_SQL} WHERE archived=0').fetchall()
                by_name = {exam_summary(r)['name']: r['id'] for r in grade_rows}
                grouped: dict[str, list[dict]] = {}
                unmatched_names: list[str] = []
                for item in parsed['rows']:
                    target_id = None
                    if item['exam_name']:
                        target_id = by_name.get(item['exam_name'])
                        if target_id is None:
                            for ename, eid in by_name.items():
                                if item['exam_name'] in ename or ename in item['exam_name']:
                                    target_id = eid
                                    break
                        if target_id is None and fallback_exam_id and not parsed['has_exam_name']:
                            target_id = fallback_exam_id
                        if target_id is None:
                            if item['exam_name'] not in unmatched_names:
                                unmatched_names.append(item['exam_name'])
                            continue
                    elif fallback_exam_id:
                        target_id = fallback_exam_id
                    if target_id:
                        grouped.setdefault(target_id, []).append(item)
                updated_total = 0
                for eid, trows in grouped.items():
                    updated_total += save_teachers_rows(conn, eid, trows)
            warnings = []
            if unmatched_names:
                warnings.append('以下考试名称尚未匹配到已保存考试，已跳过：' + '、'.join(unmatched_names[:10]))
            if not updated_total:
                raise ValueError('未能将任课教师记录匹配到已保存的考试，请确认“考试名称”与档案一致，或上传单场教师表。')
            return self.send(
                dict(
                    ok=True,
                    sheet=parsed['sheet'],
                    matched_exams=len(grouped),
                    updated=updated_total,
                    subjects=parsed['subjects'],
                    warnings=warnings,
                )
            )
        if path == '/api/class-brief':
            exam_id = str(payload.get('exam_id', '')).strip()
            if not exam_id:
                raise ValueError('请先选择一场已保存的考试。')
            target_row = get_exam(exam_id)
            target_info = exam_summary(target_row)
            grade = str(payload.get('grade') or target_info['grade'])
            high_ratio = float(payload['high_ratio']) if payload.get('high_ratio') is not None else None
            main_ratio = float(payload['main_ratio']) if payload.get('main_ratio') is not None else None
            with db() as conn:
                saved = conn.execute(
                    'SELECT * FROM exams WHERE archived=0 AND grade=? ORDER BY exam_date, created_at, id',
                    (grade,),
                ).fetchall()
                grade_exams = [
                    (exam_summary(r), exam_analysis(r, include_tables=False), get_teachers_map(conn, r['id']))
                    for r in saved
                ]
            if not any(info['id'] == exam_id for info, _, _ in grade_exams):
                raise ValueError('当前考试已归档或不属于所选年级。')
            if payload.get('all_classes'):
                target_analysis = next(a for info, a, _ in grade_exams if info['id'] == exam_id)
                briefs = [
                    build_class_brief(grade_exams, exam_id, cls, high_ratio=high_ratio, main_ratio=main_ratio)
                    for cls in target_analysis['classes']
                ]
                return self.send(dict(briefs=briefs))
            cls = str(payload.get('class', '')).strip()
            if not cls:
                target_analysis = next(a for info, a, _ in grade_exams if info['id'] == exam_id)
                cls = target_analysis['classes'][0]
            return self.send(
                build_class_brief(grade_exams, exam_id, cls, high_ratio=high_ratio, main_ratio=main_ratio)
            )
        if path == '/api/history':
            return self.send(calculate_history(payload))
        if path == '/api/export/xlsx':
            return self.send(
                export_workbook(payload.get('analysis')),
                mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                filename='成绩分析结果.xlsx',
            )
        if path == '/api/restore':
            backup = payload.get('backup', {})
            if not isinstance(backup, dict) or backup.get('format') != 'zhixu-backup' or backup.get('version') != 1:
                raise ValueError('这不是本软件支持的备份文件。')
            exams = backup.get('exams', [])
            notes = backup.get('notes', [])
            if not isinstance(exams, list) or len(exams) > 2000 or not isinstance(notes, list) or len(notes) > 50000:
                raise ValueError('备份记录格式或数量不正确。')
            # Validate everything before transaction: partial restores are not reported as success.
            for item in exams:
                validate_dataset(item['dataset'])
                if item.get('id') != item['dataset']['id']:
                    raise ValueError('备份的考试标识不一致。')
                analyze(item['dataset'], item.get('rules'), include_tables=False)
            for item in notes:
                if not all(isinstance(item.get(k), str) for k in ('id', 'exam_id', 'text', 'created_at')) or len(item['text']) > 20000:
                    raise ValueError('备份中的跟进记录格式不正确。')
            count = 0
            timestamp = now()
            with db() as conn:
                for item in exams:
                    created = item.get('created_at', timestamp)
                    meta = _dataset_meta(item['dataset'], created)
                    cursor = conn.execute(
                        '''INSERT OR IGNORE INTO exams(
                             id, dataset, rules, archived, created_at, updated_at,
                             name, grade, exam_date, filename, imported_at, row_count, subject_count
                           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                        (
                            item['id'],
                            encode(item['dataset']),
                            encode(item.get('rules', {})),
                            int(bool(item.get('archived'))),
                            created,
                            timestamp,
                            *meta,
                        ),
                    )
                    count += cursor.rowcount
                for item in notes:
                    if conn.execute('SELECT 1 FROM exams WHERE id=?', (item['exam_id'],)).fetchone():
                        conn.execute(
                            'INSERT OR IGNORE INTO notes VALUES(?,?,?,?,?)',
                            (
                                item['id'],
                                item['exam_id'],
                                item.get('class_name', item.get('class', '')),
                                item['text'],
                                item['created_at'],
                            ),
                        )
                for item in backup.get('teachers', []):
                    if isinstance(item, dict) and item.get('exam_id') and conn.execute(
                        'SELECT 1 FROM exams WHERE id=?', (item['exam_id'],)
                    ).fetchone():
                        subs_val = item.get('subjects', '{}')
                        if isinstance(subs_val, dict):
                            subs_val = encode(subs_val)
                        conn.execute(
                            'INSERT OR IGNORE INTO teachers VALUES(?,?,?,?,?)',
                            (
                                item['exam_id'],
                                normalize_class(item.get('class_name', item.get('class', ''))),
                                str(item.get('homeroom', ''))[:60],
                                str(subs_val),
                                str(item.get('updated_at', timestamp)),
                            ),
                        )
                if isinstance(backup.get('default_rules'), dict) and backup['default_rules']:
                    cleaned_def = validate_portable_rules(backup['default_rules'])
                    conn.execute(
                        '''INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES('default_rules', ?, ?)''',
                        (encode(cleaned_def), timestamp),
                    )
            invalidate_cache()
            return self.send(dict(count=count))
        return self.error('没有这个操作。', 404)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8877)
    parser.add_argument('--no-open', action='store_true')
    parser.add_argument('--page', choices=['', 'quick.html', 'leader.html'], default='')
    args = parser.parse_args()
    init_db()
    base_url = f'http://127.0.0.1:{args.port}/'
    url = base_url + args.page
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as exc:
        from urllib.request import urlopen
        try:
            with urlopen(base_url + 'api/health', timeout=2) as response:
                running = json.load(response)
            if running.get('ok') is not True or running.get('storage') != '本机 SQLite':
                raise ValueError('other service')
        except Exception:
            raise SystemExit(f'启动地址已被其他程序使用，或暂时无法启动。请关闭占用端口的程序后重试：{url}') from exc
        print(f'融侨学迹已经在运行：{url}', flush=True)
        if not args.no_open:
            import webbrowser
            webbrowser.open(url)
        return
    print(f'融侨学迹已启动：{url}\n保持此窗口打开。按 Ctrl+C 或在网页中点击“关闭本机服务”可停止。\n数据目录：{DATA}', flush=True)
    if not args.no_open:
        import webbrowser
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
