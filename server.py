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

from class_brief import build_class_brief, build_grade_brief
from distribution import (
    build_class_abc_workbook,
    build_class_abc_zip,
    build_class_packages_zip,
    build_student_cards,
)
from engine import (
    PORTABLE_RULE_KEYS,
    analyze,
    validate_dataset as _validate_dataset_core,
    validate_portable_rules,
)
from exporter import (
    export_workbook,
    generate_score_template_xlsx,
    generate_teacher_template_xlsx,
)
from history import calc_pr, calc_t_score, calculate_history as _calculate_history_core, enrich_trends_scales
import s3_store
from workbook import (
    apply_name_fixes,
    check_roster_hygiene,
    inspect_multi_workbook,
    normalize_class,
    parse_teachers_workbook,
    parse_workbook,
)

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
        note_cols = {row['name'] for row in conn.execute('PRAGMA table_info(notes)').fetchall()}
        if 'updated_at' not in note_cols:
            conn.execute("ALTER TABLE notes ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE notes SET updated_at=created_at WHERE updated_at=''")
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


def _get_setting_json(key: str) -> dict:
    with db() as conn:
        row = conn.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    if row is None:
        return {}
    try:
        parsed = json.loads(row['value'])
        return parsed if isinstance(parsed, dict) else {}
    except ValueError:
        return {}


def _set_setting_json(key: str, value: dict) -> None:
    with db() as conn:
        conn.execute(
            '''INSERT INTO settings(key, value, updated_at) VALUES(?,?,?)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at''',
            (key, encode(value), now()),
        )


def get_s3_config() -> dict:
    return _get_setting_json('s3_config')


def get_s3_status() -> dict:
    return _get_setting_json('s3_status')


def save_s3_status(status: dict) -> None:
    _set_setting_json('s3_status', status)


def save_s3_config(raw: dict) -> dict:
    existing = get_s3_config()
    merged = dict(raw or {})
    if not str(merged.get('secret_key') or '').strip() and existing.get('secret_key'):
        merged['secret_key'] = existing['secret_key']
    cleaned = s3_store.validate_config(merged, require_credentials=True)
    _set_setting_json('s3_config', cleaned)
    return cleaned


def _build_backup_dict() -> dict:
    with db() as conn:
        exams = [
            dict(
                id=r['id'],
                dataset=json.loads(r['dataset']),
                rules=json.loads(r['rules']),
                archived=bool(r['archived']),
                created_at=r['created_at'],
                updated_at=r['updated_at'],
            )
            for r in conn.execute('SELECT * FROM exams')
        ]
        notes = [dict(r) for r in conn.execute('SELECT * FROM notes')]
        teachers = [dict(r) for r in conn.execute('SELECT * FROM teachers')]
        def_row = conn.execute("SELECT updated_at FROM settings WHERE key='default_rules'").fetchone()
    return dict(
        format='zhixu-backup',
        version=1,
        exported_at=now(),
        exams=exams,
        notes=notes,
        teachers=teachers,
        default_rules=get_default_rules(),
        default_rules_updated_at=def_row['updated_at'] if def_row else '',
    )


def _validate_backup_payload(backup: dict) -> tuple[list, list]:
    if not isinstance(backup, dict) or backup.get('format') != 'zhixu-backup' or backup.get('version') != 1:
        raise ValueError('这不是本软件支持的备份文件。')
    exams = backup.get('exams', [])
    notes = backup.get('notes', [])
    if not isinstance(exams, list) or len(exams) > 2000 or not isinstance(notes, list) or len(notes) > 50000:
        raise ValueError('备份记录格式或数量不正确。')
    return exams, notes


def _diff_backup_dict(backup: dict) -> dict:
    """Compare a cloud/local backup snapshot against current local SQLite DB without writing."""
    exams, notes = _validate_backup_payload(backup)
    with db() as conn:
        local_exams = {r['id']: r for r in conn.execute('SELECT * FROM exams').fetchall()}
        local_notes = {r['id']: r for r in conn.execute('SELECT * FROM notes').fetchall()}
        local_teachers = {
            (r['exam_id'], r['class_name']): r for r in conn.execute('SELECT * FROM teachers').fetchall()
        }
        local_def_row = conn.execute("SELECT value, updated_at FROM settings WHERE key='default_rules'").fetchone()

    only_cloud_exams = []
    updated_exams = []
    same_exams = 0
    cloud_exam_ids = set()

    for item in exams:
        eid = item.get('id')
        ds = item.get('dataset') or {}
        if not eid:
            continue
        cloud_exam_ids.add(eid)
        cloud_upd = str(item.get('updated_at') or item.get('created_at') or '')
        if eid not in local_exams:
            only_cloud_exams.append({
                'id': eid,
                'name': ds.get('name', '未命名考试'),
                'grade': ds.get('grade', ''),
                'date': ds.get('date', ''),
                'row_count': len(ds.get('rows') or []),
            })
        else:
            loc = local_exams[eid]
            loc_upd = str(loc['updated_at'] or loc['created_at'] or '')
            changes = []
            if encode(item.get('rules') or {}) != loc['rules']:
                changes.append('口径')
            if (
                ds.get('name', '') != loc['name']
                or ds.get('grade', '') != loc['grade']
                or ds.get('date', '') != loc['exam_date']
                or bool(item.get('archived')) != bool(loc['archived'])
            ):
                changes.append('信息/状态')
            if len(ds.get('rows') or []) != loc['row_count']:
                changes.append('成绩记录')
            if changes and (not loc_upd or cloud_upd > loc_upd):
                updated_exams.append({
                    'id': eid,
                    'name': ds.get('name', loc['name']),
                    'grade': ds.get('grade', loc['grade']),
                    'date': ds.get('date', loc['exam_date']),
                    'changes': changes,
                    'cloud_updated_at': cloud_upd,
                    'local_updated_at': loc_upd,
                })
            else:
                same_exams += 1

    only_local_exams = [
        {
            'id': r['id'],
            'name': r['name'] or '未命名考试',
            'grade': r['grade'] or '',
            'date': r['exam_date'] or '',
        }
        for eid, r in local_exams.items()
        if eid not in cloud_exam_ids
    ]

    notes_only_cloud = 0
    notes_updated = 0
    cloud_note_ids = set()
    for item in notes:
        nid = item.get('id')
        if not nid:
            continue
        cloud_note_ids.add(nid)
        if nid not in local_notes:
            notes_only_cloud += 1
        else:
            loc_n = local_notes[nid]
            c_upd = str(item.get('updated_at') or item.get('created_at') or '')
            l_upd = str(loc_n['updated_at'] or loc_n['created_at'] or '')
            c_cls = item.get('class_name', item.get('class', ''))
            if (item.get('text') != loc_n['text'] or c_cls != loc_n['class_name']) and c_upd > l_upd:
                notes_updated += 1
    notes_only_local = sum(1 for nid in local_notes if nid not in cloud_note_ids)

    teachers_only_cloud = 0
    teachers_updated = 0
    for item in backup.get('teachers', []):
        if not isinstance(item, dict) or not item.get('exam_id'):
            continue
        cls = normalize_class(item.get('class_name', item.get('class', '')))
        key = (item['exam_id'], cls)
        if key not in local_teachers:
            teachers_only_cloud += 1
        else:
            loc_t = local_teachers[key]
            c_upd = str(item.get('updated_at') or '')
            l_upd = str(loc_t['updated_at'] or '')
            c_subs = item.get('subjects', '{}')
            c_subs_str = encode(c_subs) if isinstance(c_subs, dict) else str(c_subs)
            if (str(item.get('homeroom', '')) != loc_t['homeroom'] or c_subs_str != loc_t['subjects']) and c_upd > l_upd:
                teachers_updated += 1

    cloud_def = backup.get('default_rules')
    cloud_def_upd = str(backup.get('default_rules_updated_at') or backup.get('exported_at') or '')
    def_changed = False
    def_cloud_newer = False
    if isinstance(cloud_def, dict) and cloud_def:
        cleaned = encode(validate_portable_rules(cloud_def))
        if local_def_row is None:
            def_changed = True
            def_cloud_newer = True
        elif cleaned != local_def_row['value']:
            def_changed = True
            def_cloud_newer = cloud_def_upd > str(local_def_row['updated_at'] or '')

    return dict(
        exported_at=backup.get('exported_at', ''),
        cloud_exam_count=len(exams),
        local_exam_count=len(local_exams),
        exams=dict(
            only_cloud=only_cloud_exams,
            only_local=only_local_exams,
            updated_in_cloud=updated_exams,
            same_count=same_exams,
        ),
        notes=dict(
            only_cloud=notes_only_cloud,
            only_local=notes_only_local,
            updated_in_cloud=notes_updated,
        ),
        teachers=dict(
            only_cloud=teachers_only_cloud,
            updated_in_cloud=teachers_updated,
        ),
        default_rules_diff=dict(changed=def_changed, cloud_newer=def_cloud_newer),
    )


def _restore_backup_dict(backup: dict, *, mode: str = 'append_only') -> dict:
    exams, notes = _validate_backup_payload(backup)
    smart = mode == 'smart_merge'
    for item in exams:
        validate_dataset(item['dataset'])
        if item.get('id') != item['dataset']['id']:
            raise ValueError('备份的考试标识不一致。')
        analyze(item['dataset'], item.get('rules'), include_tables=False)
    for item in notes:
        if not all(isinstance(item.get(k), str) for k in ('id', 'exam_id', 'text', 'created_at')) or len(item['text']) > 20000:
            raise ValueError('备份中的跟进记录格式不正确。')

    exams_added = 0
    exams_updated = 0
    notes_added = 0
    notes_updated = 0
    teachers_added = 0
    teachers_updated = 0
    default_rules_updated = False
    timestamp = now()

    with db() as conn:
        for item in exams:
            created = item.get('created_at', timestamp)
            cloud_upd = str(item.get('updated_at') or created)
            meta = _dataset_meta(item['dataset'], created)
            existing = conn.execute('SELECT updated_at, created_at FROM exams WHERE id=?', (item['id'],)).fetchone()
            if existing is None:
                conn.execute(
                    '''INSERT INTO exams(
                         id, dataset, rules, archived, created_at, updated_at,
                         name, grade, exam_date, filename, imported_at, row_count, subject_count
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (
                        item['id'],
                        encode(item['dataset']),
                        encode(item.get('rules', {})),
                        int(bool(item.get('archived'))),
                        created,
                        cloud_upd,
                        *meta,
                    ),
                )
                exams_added += 1
            elif smart:
                loc_upd = str(existing['updated_at'] or existing['created_at'] or '')
                if not loc_upd or cloud_upd > loc_upd:
                    conn.execute(
                        '''UPDATE exams SET
                             dataset=?, rules=?, archived=?, updated_at=?,
                             name=?, grade=?, exam_date=?, filename=?, imported_at=?, row_count=?, subject_count=?
                           WHERE id=?''',
                        (
                            encode(item['dataset']),
                            encode(item.get('rules', {})),
                            int(bool(item.get('archived'))),
                            cloud_upd,
                            *meta,
                            item['id'],
                        ),
                    )
                    exams_updated += 1

        for item in notes:
            if not conn.execute('SELECT 1 FROM exams WHERE id=?', (item['exam_id'],)).fetchone():
                continue
            cls_name = item.get('class_name', item.get('class', ''))
            cloud_upd = str(item.get('updated_at') or item['created_at'])
            existing_n = conn.execute('SELECT updated_at, created_at FROM notes WHERE id=?', (item['id'],)).fetchone()
            if existing_n is None:
                conn.execute(
                    'INSERT INTO notes(id, exam_id, class_name, text, created_at, updated_at) VALUES(?,?,?,?,?,?)',
                    (item['id'], item['exam_id'], cls_name, item['text'], item['created_at'], cloud_upd),
                )
                notes_added += 1
            elif smart:
                loc_upd = str(existing_n['updated_at'] or existing_n['created_at'] or '')
                if cloud_upd > loc_upd:
                    conn.execute(
                        'UPDATE notes SET class_name=?, text=?, updated_at=? WHERE id=?',
                        (cls_name, item['text'], cloud_upd, item['id']),
                    )
                    notes_updated += 1

        for item in backup.get('teachers', []):
            if not isinstance(item, dict) or not item.get('exam_id'):
                continue
            if not conn.execute('SELECT 1 FROM exams WHERE id=?', (item['exam_id'],)).fetchone():
                continue
            cls = normalize_class(item.get('class_name', item.get('class', '')))
            homeroom = str(item.get('homeroom', ''))[:60]
            subs_val = item.get('subjects', '{}')
            if isinstance(subs_val, dict):
                subs_val = encode(subs_val)
            cloud_upd = str(item.get('updated_at') or timestamp)
            existing_t = conn.execute(
                'SELECT updated_at FROM teachers WHERE exam_id=? AND class_name=?', (item['exam_id'], cls)
            ).fetchone()
            if existing_t is None:
                conn.execute(
                    'INSERT INTO teachers VALUES(?,?,?,?,?)',
                    (item['exam_id'], cls, homeroom, str(subs_val), cloud_upd),
                )
                teachers_added += 1
            elif smart and cloud_upd > str(existing_t['updated_at'] or ''):
                conn.execute(
                    'UPDATE teachers SET homeroom=?, subjects=?, updated_at=? WHERE exam_id=? AND class_name=?',
                    (homeroom, str(subs_val), cloud_upd, item['exam_id'], cls),
                )
                teachers_updated += 1

        if isinstance(backup.get('default_rules'), dict) and backup['default_rules']:
            cleaned_def = validate_portable_rules(backup['default_rules'])
            cloud_def_upd = str(backup.get('default_rules_updated_at') or backup.get('exported_at') or timestamp)
            existing_def = conn.execute("SELECT updated_at FROM settings WHERE key='default_rules'").fetchone()
            if existing_def is None:
                conn.execute(
                    "INSERT INTO settings(key, value, updated_at) VALUES('default_rules', ?, ?)",
                    (encode(cleaned_def), cloud_def_upd),
                )
                default_rules_updated = True
            elif smart and cloud_def_upd > str(existing_def['updated_at'] or ''):
                conn.execute(
                    "UPDATE settings SET value=?, updated_at=? WHERE key='default_rules'",
                    (encode(cleaned_def), cloud_def_upd),
                )
                default_rules_updated = True

    invalidate_cache()
    return dict(
        count=exams_added + exams_updated,
        exams_added=exams_added,
        exams_updated=exams_updated,
        notes_added=notes_added,
        notes_updated=notes_updated,
        teachers_added=teachers_added,
        teachers_updated=teachers_updated,
        default_rules_updated=default_rules_updated,
    )


def _trigger_auto_sync(label: str = 'auto') -> None:
    cfg = get_s3_config()
    if not cfg.get('auto_sync') or not s3_store.mask_config(cfg).get('configured'):
        return

    def worker():
        try:
            res = s3_store.put_snapshot(cfg, _build_backup_dict(), label=label)
            save_s3_status(dict(last_sync_at=res['synced_at'], last_sync_key=res['key'], last_sync_size=res['size'], last_error=''))
        except Exception as exc:
            prev = get_s3_status()
            save_s3_status(dict(
                last_sync_at=prev.get('last_sync_at', ''),
                last_sync_key=prev.get('last_sync_key', ''),
                last_sync_size=prev.get('last_sync_size', 0),
                last_error=str(exc)[:240],
            ))

    threading.Thread(target=worker, daemon=True).start()


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
                    f'{_SUMMARY_SQL} WHERE archived=? ORDER BY exam_date DESC, created_at DESC, rowid DESC', (archived,)
                ).fetchall()
            return self.send(dict(exams=[exam_summary(r) for r in rows]))
        match = re.fullmatch(r'/api/exams/([^/]+)/class-packages\.zip', path)
        if match:
            exam_id = match.group(1)
            target_row = get_exam(exam_id)
            target_info = exam_summary(target_row)
            grade = target_info['grade']
            high_ratio = float(query['high_ratio'][0]) if query.get('high_ratio') else None
            main_ratio = float(query['main_ratio'][0]) if query.get('main_ratio') else None
            with db() as conn:
                saved = conn.execute(
                    'SELECT * FROM exams WHERE archived=0 AND grade=? ORDER BY exam_date, created_at, id',
                    (grade,),
                ).fetchall()
                grade_exams = [
                    (exam_summary(r), exam_analysis(r, include_tables=False), get_teachers_map(conn, r['id']))
                    for r in saved
                ]
            filename, zip_bytes = build_class_packages_zip(
                grade_exams, exam_id, high_ratio=high_ratio, main_ratio=main_ratio
            )
            return self.send(zip_bytes, mime='application/zip', filename=filename)
        match = re.fullmatch(r'/api/exams/([^/]+)/class-abc\.(xlsx|zip)', path)
        if match:
            exam_id, ext = match.groups()
            target_row = get_exam(exam_id)
            analysis = exam_analysis(target_row, include_tables=False)
            mode = (query.get('mode') or ['six'])[0]
            class_name = (query.get('class') or [''])[0].strip()
            with db() as conn:
                tmap = get_teachers_map(conn, exam_id)
            if ext == 'zip':
                filename, content_bytes = build_class_abc_zip(analysis, mode=mode, teachers_map=tmap)
                return self.send(content_bytes, mime='application/zip', filename=filename)
            filename, content_bytes = build_class_abc_workbook(
                analysis, mode=mode, class_name=class_name, teachers_map=tmap
            )
            return self.send(
                content_bytes,
                mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                filename=filename,
            )
        match = re.fullmatch(r'/api/exams/([^/]+)', path)
        if match:
            row = get_exam(match.group(1))
            return self.send(dict(dataset=json.loads(row['dataset']), rules=json.loads(row['rules'])))
        if path == '/api/templates/scores.xlsx':
            return self.send(
                generate_score_template_xlsx(),
                mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                filename='融侨学迹_成绩导入模板.xlsx',
            )
        if path == '/api/templates/teachers.xlsx':
            return self.send(
                generate_teacher_template_xlsx(),
                mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                filename='融侨学迹_任课教师模板.xlsx',
            )
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
                    | {'summary': result['summary'], 'subject_stats': result['subject_stats']}
                    | {'class_stats': enrich_trends_scales(result), 'rules': result['rules']}
                )
            return self.send(dict(exams=data))
        if path == '/api/school':
            with db() as conn:
                summary_rows = conn.execute(
                    f'{_SUMMARY_SQL} WHERE archived=0 ORDER BY exam_date, created_at, id'
                ).fetchall()
                by_grade_ids: dict[str, list[str]] = {}
                for row in summary_rows:
                    by_grade_ids.setdefault(row['grade'] or '未分年级', []).append(row['id'])
                grades = []
                for grade_name, exam_ids in sorted(by_grade_ids.items()):
                    recent_ids = exam_ids[-2:]
                    recent_pairs = []
                    for eid in recent_ids:
                        frow = conn.execute('SELECT * FROM exams WHERE id=?', (eid,)).fetchone()
                        if frow is not None:
                            recent_pairs.append((exam_summary(frow), exam_analysis(frow, include_tables=False)))
                    if recent_pairs:
                        latest_info, latest_ana = recent_pairs[-1]
                        grades.append(
                            dict(
                                grade=grade_name,
                                exam=latest_info,
                                analysis=latest_ana,
                                grade_brief=build_grade_brief(recent_pairs),
                            )
                        )
            totals = dict(
                grades=len(grades),
                classes=sum(len(g['analysis']['classes']) for g in grades),
                registered=sum(g['analysis']['summary']['registered'] for g in grades),
                participants=sum(g['analysis']['summary']['participants'] for g in grades),
            )
            return self.send(dict(grades=grades, totals=totals, exam_count=len(summary_rows)))
        if path == '/api/students/search':
            q = (query.get('q') or [''])[0].strip().lower()
            grade_filter = (query.get('grade') or [''])[0].strip()
            if not q:
                return self.send(dict(results=[]))
            with db() as conn:
                if grade_filter:
                    ex_rows = conn.execute(
                        'SELECT * FROM exams WHERE archived=0 AND grade=? ORDER BY exam_date DESC, created_at DESC, id DESC',
                        (grade_filter,),
                    ).fetchall()
                else:
                    ex_rows = conn.execute(
                        'SELECT * FROM exams WHERE archived=0 ORDER BY exam_date DESC, created_at DESC, id DESC'
                    ).fetchall()
            grouped: dict[tuple, dict] = {}
            for erow in ex_rows:
                info = exam_summary(erow)
                ana = exam_analysis(erow, include_tables=False)
                g_name = info['grade']
                for s in ana['students']:
                    haystack = f"{s.get('name', '')} {s.get('class', '')} {s.get('id', '')}".lower()
                    if q not in haystack:
                        continue
                    reliable = bool(s.get('identity_reliable'))
                    key = (g_name, s['id']) if reliable else (g_name, s.get('class', ''), s.get('name', ''))
                    if key not in grouped:
                        grouped[key] = {
                            'grade': g_name,
                            'student_id': s['id'],
                            'identity_reliable': reliable,
                            'name': s.get('name', ''),
                            'class': s.get('class', ''),
                            'exam_id': info['id'],
                            'exam_name': info['name'],
                            'exam_date': info['date'],
                            'exam_count': 1,
                            'total': s.get('total'),
                            'rank': s.get('rank'),
                            'class_rank': s.get('class_rank'),
                            'total_level': (s.get('levels') or {}).get('总分') or '',
                            'weak': [w['subject'] for w in (s.get('weak') or [])[:3] if isinstance(w, dict) and w.get('subject')],
                        }
                    else:
                        grouped[key]['exam_count'] += 1
            results = sorted(
                grouped.values(),
                key=lambda x: (
                    0 if str(x['name']).lower() == q else (1 if str(x['name']).lower().startswith(q) else 2),
                    x['exam_date'] or '',
                ),
            )[:20]
            return self.send(dict(results=results))
        if path == '/api/students/profile':
            grade_name = (query.get('grade') or [''])[0].strip()
            student_id = (query.get('student_id') or [''])[0].strip()
            name_q = (query.get('name') or [''])[0].strip()
            class_q = (query.get('class') or [''])[0].strip()
            if not (student_id or name_q):
                raise ValueError('请提供学生标识或姓名。')
            with db() as conn:
                if grade_name:
                    ex_rows = conn.execute(
                        'SELECT * FROM exams WHERE archived=0 AND grade=? ORDER BY exam_date, created_at, id',
                        (grade_name,),
                    ).fetchall()
                else:
                    ex_rows = conn.execute(
                        'SELECT * FROM exams WHERE archived=0 ORDER BY exam_date, created_at, id'
                    ).fetchall()
                note_rows = conn.execute(
                    'SELECT * FROM notes ORDER BY created_at DESC, rowid DESC'
                ).fetchall()
            history_items = []
            weak_counter: dict[str, int] = {}
            matched_student = None
            matched_exam_ids = set()
            matched_classes = set()
            for erow in ex_rows:
                info = exam_summary(erow)
                ana = exam_analysis(erow, include_tables=False)
                rec = None
                if student_id:
                    rec = next((s for s in ana['students'] if s['id'] == student_id), None)
                if rec is None and name_q:
                    rec = next(
                        (s for s in ana['students'] if s.get('name') == name_q and (not class_q or s.get('class') == class_q)),
                        None,
                    )
                if rec is None:
                    continue
                matched_student = rec
                matched_exam_ids.add(info['id'])
                matched_classes.add(rec.get('class', ''))
                parts = int(ana['summary'].get('participants') or 0)
                totals = [float(x['total']) for x in ana['students'] if x.get('rank') is not None and x.get('total') is not None]
                g_mean = (sum(totals) / len(totals)) if totals else None
                g_std = ((sum((v - g_mean) ** 2 for v in totals) / len(totals)) ** 0.5) if (totals and g_mean is not None) else None
                weak_list = [w['subject'] for w in (rec.get('weak') or []) if isinstance(w, dict) and w.get('subject')]
                for sub_w in weak_list[:2]:
                    weak_counter[sub_w] = weak_counter.get(sub_w, 0) + 1
                history_items.append({
                    'exam_id': info['id'],
                    'exam_name': info['name'],
                    'date': info['date'],
                    'grade': info['grade'],
                    'class': rec.get('class', ''),
                    'total': rec.get('total'),
                    'rank': rec.get('rank'),
                    'class_rank': rec.get('class_rank'),
                    'participants': parts,
                    'pr': calc_pr(rec.get('rank'), parts),
                    't_score': calc_t_score(rec.get('total'), g_mean, g_std),
                    'total_grade': (rec.get('grades') or {}).get('总分') or '—',
                    'total_level': (rec.get('levels') or {}).get('总分') or '—',
                    'subjects': ana['subjects'],
                    'scores': rec.get('scores') or {},
                    'ranks': rec.get('ranks') or {},
                    'levels': rec.get('levels') or {},
                    'weak': weak_list,
                })
            if not history_items or matched_student is None:
                raise ValueError('未找到该学生的考试档案记录。')
            stu_name = matched_student.get('name', name_q)
            related_notes = []
            for nr in note_rows:
                txt = nr['text'] or ''
                if (nr['exam_id'] in matched_exam_ids and (nr['class_name'] in matched_classes or not nr['class_name'])) or (stu_name and stu_name in txt):
                    related_notes.append({
                        'id': nr['id'],
                        'exam_id': nr['exam_id'],
                        'class': nr['class_name'],
                        'text': txt,
                        'created_at': nr['created_at'],
                        'mentions_student': bool(stu_name and stu_name in txt),
                    })
            first_pr = history_items[0].get('pr')
            last_pr = history_items[-1].get('pr')
            pr_delta = round(last_pr - first_pr, 1) if (len(history_items) >= 2 and first_pr is not None and last_pr is not None) else None
            persistent_weak = [
                {'subject': sub, 'hits': cnt, 'total_exams': len(history_items)}
                for sub, cnt in sorted(weak_counter.items(), key=lambda kv: (-kv[1], kv[0]))
                if cnt >= 2 or len(history_items) == 1
            ][:4]
            latest = history_items[-1]
            return self.send(dict(
                student=dict(
                    id=matched_student['id'],
                    name=stu_name,
                    grade=latest['grade'],
                    class_name=latest['class'],
                    identity_reliable=bool(matched_student.get('identity_reliable')),
                    latest_exam_id=latest['exam_id'],
                    latest_exam_name=latest['exam_name'],
                    latest_total=latest['total'],
                    latest_rank=latest['rank'],
                    latest_class_rank=latest['class_rank'],
                    latest_pr=latest['pr'],
                    latest_t=latest['t_score'],
                    latest_level=latest['total_level'],
                    pr_delta=pr_delta,
                    exam_count=len(history_items),
                ),
                history=history_items,
                persistent_weak=persistent_weak,
                notes=related_notes[:12],
            ))
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
        if path == '/api/s3/config':
            return self.send(dict(config=s3_store.mask_config(get_s3_config()), status=get_s3_status()))
        if path == '/api/s3/backups':
            cfg = get_s3_config()
            if not s3_store.mask_config(cfg).get('configured'):
                raise ValueError('尚未配置 S3 对象存储，请先填写连接信息。')
            return self.send(dict(snapshots=s3_store.list_snapshots(cfg), status=get_s3_status()))
        if path == '/api/backup':
            backup = _build_backup_dict()
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
        if path == '/api/workbook/inspect':
            filename = Path(str(payload.get('filename', '总表.xlsx'))).name
            content = base64.b64decode(payload.get('content', ''), validate=True)
            if len(content) > 20 * 1024 * 1024:
                raise ValueError('文件超过20MB，请精简后导入。')
            grade = str(payload.get('grade', '')).strip()
            default_date = str(payload.get('default_date', '')).strip()
            with db() as conn:
                if grade:
                    ex_rows = conn.execute(
                        'SELECT id, name, exam_date, dataset FROM exams WHERE archived=0 AND grade=? ORDER BY exam_date, created_at, id',
                        (grade,),
                    ).fetchall()
                else:
                    ex_rows = conn.execute(
                        'SELECT id, name, exam_date, dataset FROM exams WHERE archived=0 ORDER BY exam_date, created_at, id'
                    ).fetchall()
            existing_exams = [{'id': r['id'], 'name': r['name'], 'date': r['exam_date']} for r in ex_rows]
            existing_datasets = [json.loads(r['dataset']) for r in ex_rows]
            inspected = inspect_multi_workbook(
                content,
                filename,
                grade=grade,
                default_date=default_date,
                existing_exams=existing_exams,
                password=payload.get('password'),
            )
            # Attach roster hygiene report to each score sheet (comparing against existing grade history or previous sheet)
            running_baselines = list(existing_datasets)
            for item in inspected['score_sheets']:
                item['hygiene'] = check_roster_hygiene(item['dataset']['rows'], running_baselines)
                running_baselines.append(item['dataset'])
            return self.send(inspected)
        if path == '/api/roster-check':
            grade = str(payload.get('grade', '')).strip()
            rows = payload.get('rows', [])
            if not isinstance(rows, list):
                raise ValueError('学生名单格式不正确。')
            with db() as conn:
                if grade:
                    ex_rows = conn.execute(
                        'SELECT dataset FROM exams WHERE archived=0 AND grade=? ORDER BY exam_date, created_at, id',
                        (grade,),
                    ).fetchall()
                else:
                    ex_rows = []
            existing_datasets = [json.loads(r['dataset']) for r in ex_rows]
            return self.send(check_roster_hygiene(rows, existing_datasets))
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
            dataset = payload.get('dataset')
            if isinstance(dataset, dict) and payload.get('name_fixes'):
                apply_name_fixes(dataset, payload.get('name_fixes'))
            dataset = validate_dataset(dataset)
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
            _trigger_auto_sync('exam')
            return self.send(exam_summary(get_exam(dataset['id'])))
        if path == '/api/exams/batch-import':
            grade = str(payload.get('grade', '')).strip()
            items = payload.get('exams', [])
            teacher_sheets = payload.get('teacher_sheets', [])
            if not grade:
                raise ValueError('请填写这批考试所属的年级 / 届别。')
            if not isinstance(items, list) or (not items and not teacher_sheets):
                raise ValueError('请至少勾选一场考试或一张任课教师表进行导入。')
            if len(items) > 100:
                raise ValueError('单次批量导入最多支持 100 场考试。')
            default_rules = get_default_rules() or None
            timestamp = now()
            imported = 0
            overwritten = 0
            exam_ids = []
            fixes_applied = 0
            prepared = []
            for entry in items:
                if not isinstance(entry, dict) or not isinstance(entry.get('dataset'), dict):
                    raise ValueError('批量导入的考试数据格式不正确。')
                ds = dict(entry['dataset'])
                ds['name'] = str(entry.get('name') or ds.get('name') or '').strip()
                ds['grade'] = grade
                ds['date'] = str(entry.get('date') or ds.get('date') or '').strip()
                if not ds['name'] or not ds['date']:
                    raise ValueError(f"考试「{ds.get('name') or '未命名'}」缺少名称或日期。")
                try:
                    datetime.strptime(ds['date'], '%Y-%m-%d')
                except ValueError:
                    raise ValueError(f"考试「{ds['name']}」的日期格式不正确，应为 YYYY-MM-DD。")
                if entry.get('name_fixes'):
                    fixes_applied += apply_name_fixes(ds, entry.get('name_fixes'))
                mode = str(entry.get('mode') or 'create')
                existing_id = str(entry.get('existing_id') or '').strip()
                if mode == 'overwrite' and existing_id:
                    ds['id'] = existing_id
                ds = validate_dataset(ds)
                result = analyze(ds, default_rules, include_tables=False)
                prepared.append((ds, result, mode == 'overwrite' and bool(existing_id)))

            with db() as conn:
                for ds, result, is_overwrite in prepared:
                    meta = _dataset_meta(ds, timestamp)
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
                        (ds['id'], encode(ds), encode(result['rules']), timestamp, timestamp, *meta),
                    )
                    if is_overwrite:
                        overwritten += 1
                    else:
                        imported += 1
                    exam_ids.append(ds['id'])

                teachers_updated = 0
                if isinstance(teacher_sheets, list) and teacher_sheets:
                    grade_rows = conn.execute(
                        f'{_SUMMARY_SQL} WHERE archived=0 AND grade=?', (grade,)
                    ).fetchall()
                    by_name = {exam_summary(r)['name']: r['id'] for r in grade_rows}
                    for ts in teacher_sheets:
                        parsed_t = ts.get('parsed') if isinstance(ts, dict) else None
                        if not isinstance(parsed_t, dict):
                            continue
                        grouped: dict[str, list[dict]] = {}
                        for row_t in parsed_t.get('rows') or []:
                            en = str(row_t.get('exam_name') or '').strip()
                            if en:
                                tid = by_name.get(en)
                                if tid is None:
                                    for ename, eid in by_name.items():
                                        if en in ename or ename in en:
                                            tid = eid
                                            break
                                if tid:
                                    grouped.setdefault(tid, []).append(row_t)
                            else:
                                # No exam_name column: apply to all newly imported/overwritten exams in this batch
                                for eid in exam_ids:
                                    grouped.setdefault(eid, []).append(row_t)
                        for eid, trows in grouped.items():
                            teachers_updated += save_teachers_rows(conn, eid, trows)

            invalidate_cache()
            _trigger_auto_sync('batch-import')
            return self.send(dict(
                ok=True,
                imported=imported,
                overwritten=overwritten,
                fixes_applied=fixes_applied,
                teachers_updated=teachers_updated,
                exam_ids=exam_ids,
            ))
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
                _trigger_auto_sync('rules')
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
            ts = now()
            note = dict(
                id=uuid.uuid4().hex,
                exam_id=exam_id,
                **{'class': str(payload.get('class', ''))[:60]},
                text=message,
                created_at=ts,
                updated_at=ts,
            )
            with db() as conn:
                conn.execute(
                    'INSERT INTO notes(id, exam_id, class_name, text, created_at, updated_at) VALUES(?,?,?,?,?,?)',
                    (note['id'], exam_id, note['class'], message, ts, ts),
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
                    ts = now()
                    conn.execute(
                        'UPDATE notes SET class_name=?, text=?, updated_at=? WHERE id=?', (cls, message, ts, note_id)
                    )
            if action == 'delete':
                return self.send(dict(ok=True))
            return self.send(
                dict(
                    id=existing['id'],
                    exam_id=existing['exam_id'],
                    **{'class': cls},
                    text=message,
                    created_at=existing['created_at'],
                    updated_at=ts,
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
            compare_exam_id = str(payload.get('compare_exam_id') or '').strip() or None
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
                    build_class_brief(
                        grade_exams, exam_id, cls,
                        high_ratio=high_ratio, main_ratio=main_ratio, compare_exam_id=compare_exam_id,
                    )
                    for cls in target_analysis['classes']
                ]
                return self.send(dict(briefs=briefs))
            cls = str(payload.get('class', '')).strip()
            if not cls:
                target_analysis = next(a for info, a, _ in grade_exams if info['id'] == exam_id)
                cls = target_analysis['classes'][0]
            return self.send(
                build_class_brief(
                    grade_exams, exam_id, cls,
                    high_ratio=high_ratio, main_ratio=main_ratio, compare_exam_id=compare_exam_id,
                )
            )
        if path == '/api/student-cards':
            exam_id = str(payload.get('exam_id', '')).strip()
            if not exam_id:
                raise ValueError('请先选择一场已保存的考试。')
            target_row = get_exam(exam_id)
            target_info = exam_summary(target_row)
            grade = str(payload.get('grade') or target_info['grade'])
            class_name = str(payload.get('class', '')).strip()
            student_id = str(payload.get('student_id', '')).strip()
            with db() as conn:
                saved = conn.execute(
                    'SELECT * FROM exams WHERE archived=0 AND grade=? ORDER BY exam_date, created_at, id',
                    (grade,),
                ).fetchall()
                grade_exams = [
                    (exam_summary(r), exam_analysis(r, include_tables=False), get_teachers_map(conn, r['id']))
                    for r in saved
                ]
            return self.send(build_student_cards(grade_exams, exam_id, class_name=class_name, student_id=student_id))
        if path == '/api/history':
            return self.send(calculate_history(payload))
        if path == '/api/export/xlsx':
            return self.send(
                export_workbook(payload.get('analysis')),
                mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                filename='成绩分析结果.xlsx',
            )
        if path == '/api/restore':
            mode = str(payload.get('mode') or 'smart_merge')
            stats = _restore_backup_dict(payload.get('backup', {}), mode=mode)
            return self.send(stats)
        if path == '/api/s3/config':
            if payload.get('clear'):
                with db() as conn:
                    conn.execute("DELETE FROM settings WHERE key IN ('s3_config', 's3_status')")
                return self.send(dict(ok=True, config=s3_store.mask_config({}), status={}))
            saved = save_s3_config(payload.get('config', payload))
            return self.send(dict(ok=True, config=s3_store.mask_config(saved), status=get_s3_status()))
        if path == '/api/s3/test':
            raw_cfg = payload.get('config') if isinstance(payload.get('config'), dict) else get_s3_config()
            existing = get_s3_config()
            merged = dict(raw_cfg or {})
            if not str(merged.get('secret_key') or '').strip() and existing.get('secret_key'):
                merged['secret_key'] = existing['secret_key']
            return self.send(s3_store.test_connection(merged))
        if path == '/api/s3/backup':
            cfg = get_s3_config()
            if not s3_store.mask_config(cfg).get('configured'):
                raise ValueError('尚未配置 S3 对象存储，请先保存连接配置。')
            label = str(payload.get('label', '')).strip()
            res = s3_store.put_snapshot(cfg, _build_backup_dict(), label=label)
            save_s3_status(dict(last_sync_at=res['synced_at'], last_sync_key=res['key'], last_sync_size=res['size'], last_error=''))
            return self.send(res)
        if path == '/api/s3/diff':
            cfg = get_s3_config()
            if not s3_store.mask_config(cfg).get('configured'):
                raise ValueError('尚未配置 S3 对象存储，请先保存连接配置。')
            target_key, backup = s3_store.get_snapshot(cfg, payload.get('key'))
            diff = _diff_backup_dict(backup)
            diff['key'] = target_key
            return self.send(diff)
        if path == '/api/s3/restore':
            cfg = get_s3_config()
            if not s3_store.mask_config(cfg).get('configured'):
                raise ValueError('尚未配置 S3 对象存储，请先保存连接配置。')
            mode = str(payload.get('mode') or 'smart_merge')
            target_key, backup = s3_store.get_snapshot(cfg, payload.get('key'))
            stats = _restore_backup_dict(backup, mode=mode)
            return self.send(dict(ok=True, key=target_key, mode=mode, **stats))
        if path == '/api/s3/delete':
            cfg = get_s3_config()
            if not s3_store.mask_config(cfg).get('configured'):
                raise ValueError('尚未配置 S3 对象存储，请先保存连接配置。')
            return self.send(s3_store.delete_snapshot(cfg, payload.get('key', '')))
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
