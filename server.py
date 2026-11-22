"""Local-only score analysis service. No cloud accounts or external requests."""
from __future__ import annotations
import argparse
import base64
import binascii
import hashlib
import io
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import sqlite3
import sys
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
DATA = Path(os.environ.get('ZHIXU_DATA_DIR', str(ROOT / 'data'))).resolve()
VERSION = '1.0.0'
MAX_REQUEST = 32 * 1024 * 1024
sys.path.insert(0, str(ROOT / '.runtime'))
from workbook import parse_workbook
from engine import analyze


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def db():
    DATA.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(DATA / 'zhixu.sqlite3'), timeout=20)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    return connection


def init_db():
    with db() as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript('''
          CREATE TABLE IF NOT EXISTS exams (
            id TEXT PRIMARY KEY, dataset TEXT NOT NULL, rules TEXT NOT NULL,
            archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id),
            class_name TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, created_at TEXT NOT NULL
          );
        ''')


def validate_dataset(dataset):
    if not isinstance(dataset, dict):
        raise ValueError('请先导入原始成绩表。')
    if not isinstance(dataset.get('rows'), list) or not 1 <= len(dataset['rows']) <= 50000:
        raise ValueError('成绩记录应为1至50,000行。')
    if not isinstance(dataset.get('subjects'), list) or not dataset['subjects']:
        raise ValueError('没有可计算的学科列。')
    if len(dataset['subjects']) > 60 or any(not isinstance(s, str) or len(s) > 60 for s in dataset['subjects']):
        raise ValueError('学科字段格式不正确。')
    seen = set()
    for row in dataset['rows']:
        if not isinstance(row, dict) or not isinstance(row.get('scores'), dict) or not row.get('class'):
            raise ValueError('学生记录缺少班级或成绩字段。')
        if not isinstance(row.get('id'), str) or row['id'] in seen:
            raise ValueError('学生标识缺失或重复，请检查导入表。')
        seen.add(row['id'])
        for score in row['scores'].values():
            if score is not None and (isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or score < 0):
                raise ValueError('成绩包含无效数值。请在原表中核对。')
    if not dataset.get('id'):
        dataset['id'] = uuid.uuid4().hex
    for field in ('id', 'name', 'grade', 'date', 'filename'):
        if not isinstance(dataset.get(field, ''), str) or len(dataset.get(field, '')) > 300:
            raise ValueError('考试信息格式不正确。')
    return dataset


def exam_summary(row):
    d = json.loads(row['dataset'])
    return dict(id=row['id'], name=d.get('name', '未命名考试'), grade=d.get('grade', '未分年级'),
                date=d.get('date', ''), filename=d.get('filename', ''), imported_at=d.get('imported_at', row['created_at']),
                row_count=len(d['rows']), subject_count=len(d['subjects']), rules=json.loads(row['rules']),
                archived=bool(row['archived']), created_at=row['created_at'])


def get_exam(exam_id):
    with db() as conn:
        row = conn.execute('SELECT * FROM exams WHERE id=?', (exam_id,)).fetchone()
    if row is None:
        raise ValueError('找不到这场考试，请刷新考试列表。')
    return row


def example_dataset():
    """Return the local sample when present, otherwise a small synthetic demo."""
    source = ROOT / '样例' / '原始数据.xlsx'
    if source.is_file():
        return parse_workbook(source.read_bytes(), source.name, dict(name='初三定时练习（二）', grade='初三', date='2026-10-19'))
    demo = (
        '班级,学号,姓名,语文,数学,英语\n'
        '01,DEMO-001,演示甲,86,92,88\n'
        '01,DEMO-002,演示乙,78,84,81\n'
        '02,DEMO-003,演示丙,93,89,95\n'
        '02,DEMO-004,演示丁,71,76,80\n'
    ).encode('utf-8')
    return parse_workbook(demo, '演示成绩.csv', dict(name='演示成绩', grade='初三', date='2026-10-19'))


def exam_analysis(row, rules=None):
    return analyze(json.loads(row['dataset']), json.loads(row['rules']) if rules is None else rules)


def export_workbook(analysis):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.worksheet.pagebreak import Break
    from openpyxl.utils import get_column_letter
    if not isinstance(analysis, dict) or not isinstance(analysis.get('tables'), list):
        raise ValueError('请先生成分析结果。')
    if len(analysis['tables']) > 30:
        raise ValueError('报表数量超过导出范围。')
    wb = Workbook()
    wb.remove(wb.active)
    names = set()
    total_cells = 0
    def safe(v):
        if v is None or isinstance(v, (int, float, bool)):
            return v
        value = encode(v) if isinstance(v, (dict, list)) else str(v)
        return "'" + value if re.match(r'^\s*[=+@-]', value) else value
    meta = analysis.get('metadata', {})
    subtitle = f"{meta.get('grade', '')} · {meta.get('name', '')} · {meta.get('date', '')}"
    for item in analysis['tables']:
        cols, rows = item.get('columns', []), item.get('rows', [])
        if not cols or len(cols) > 200 or len(rows) > 50000:
            raise ValueError('报表结构超出支持范围。')
        total_cells += len(cols) * len(rows)
        if total_cells > 2000000:
            raise ValueError('导出内容过大，请缩小统计范围。')
        title = re.sub(r'[\\/*?:\[\]]', '-', str(item.get('title', '报表')))[:29] or '报表'
        base = title
        n = 1
        while title in names:
            n += 1
            title = base[:27] + str(n)
        names.add(title)
        ws = wb.create_sheet(title)
        ws.sheet_view.showGridLines = False
        ws.append([safe(item.get('title', '报表'))])
        ws.append([safe(subtitle)])
        ws.append([safe(item.get('note', ''))])
        ws.append([])
        ws.append([safe(x) for x in cols])
        for line in rows:
            ws.append([safe(v) for v in line])
        last = get_column_letter(len(cols))
        for r in [1, 2, 3]:
            if len(cols) > 1:
                ws.merge_cells(f'A{r}:{last}{r}')
        ws['A1'].font = Font(name='Microsoft YaHei', size=17, bold=True, color='684792')
        ws['A2'].font = Font(name='Microsoft YaHei', size=10, color='73647F')
        ws['A3'].font = Font(name='Microsoft YaHei', size=10, color='73647F')
        ws['A3'].alignment = Alignment(wrap_text=True, vertical='top')
        ws.row_dimensions[1].height = 30
        ws.row_dimensions[3].height = 32 if item.get('note') else 15
        for cell in ws[5]:
            cell.fill = PatternFill('solid', fgColor='EEE7F8')
            cell.font = Font(name='Microsoft YaHei', size=10, bold=True, color='493559')
            cell.alignment = Alignment(wrap_text=True, vertical='center')
        ws.row_dimensions[5].height = 30
        for row in ws.iter_rows(min_row=6):
            for cell in row:
                cell.font = Font(name='Microsoft YaHei', size=10, color='302A40')
                cell.alignment = Alignment(vertical='center')
                if isinstance(cell.value, float):
                    cell.number_format = '0.##'
            if row[0].row % 2 == 0:
                for cell in row:
                    cell.fill = PatternFill('solid', fgColor='FAF8FD')
        for index, col in enumerate(cols, 1):
            lengths = [len(str(col)) * 1.65] + [len(str(row[index-1] or '')) * 1.5 for row in rows[:120] if len(row) >= index]
            ws.column_dimensions[get_column_letter(index)].width = min(42, max(11, max(lengths) + 2))
        ws.freeze_panes = 'C6' if len(cols) > 2 else 'A6'
        ws.auto_filter.ref = f'A5:{last}{ws.max_row}'
        ws.print_title_rows = '1:5'
        ws.print_options.horizontalCentered = True
        ws.page_setup.orientation = 'landscape'
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.print_area = f'A1:{last}{ws.max_row}'
        ws.oddFooter.center.text = '第 &P 页 / 共 &N 页'
    if not wb.sheetnames:
        raise ValueError('没有可导出的工作表。')
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def calculate_history(payload):
    grade = str(payload.get('grade', ''))
    requested_ids = payload.get('exam_ids')
    if requested_ids is not None:
        if not isinstance(requested_ids, list) or not requested_ids or not all(isinstance(item, str) and item for item in requested_ids):
            raise ValueError('考试选择必须是非空的考试编号列表。')
        requested_ids = list(dict.fromkeys(requested_ids))
    with db() as conn:
        saved = conn.execute('SELECT * FROM exams WHERE archived=0 ORDER BY created_at').fetchall()
    saved = [r for r in saved if json.loads(r['dataset']).get('grade') == grade]
    if requested_ids is not None:
        saved_by_id = {r['id']: r for r in saved}
        missing = [exam_id for exam_id in requested_ids if exam_id not in saved_by_id]
        if missing:
            raise ValueError('选择的考试不属于当前年级或已被归档。')
        saved = [saved_by_id[exam_id] for exam_id in requested_ids]
    saved.sort(key=lambda r: (json.loads(r['dataset']).get('date', ''), r['created_at'], r['id']))
    requested = payload.get('weights', {})
    if not isinstance(requested, dict):
        raise ValueError('考试权重格式不正确。')
    exams, students, subject_trends = [], {}, []
    anonymous = 0
    from decimal import Decimal, ROUND_HALF_UP
    def rounded(x):
        return float(Decimal(str(x)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
    for index, row in enumerate(saved):
        weight = float(requested.get(row['id'], index + 1))
        if not math.isfinite(weight) or weight <= 0 or weight > 1000:
            raise ValueError('考试权重必须大于0且不超过1000。')
        result = exam_analysis(row)
        info = exam_summary(row)
        exams.append({k: info[k] for k in ('id', 'name', 'date')} | {'weight': weight})
        subject_trends.append({
            'exam_id': row['id'], 'name': info['name'], 'date': info['date'],
            'subjects': [
                {'subject': item['subject'], 'count': item['count'], 'mean': item['mean'],
                 'score_rate': item['score_rate'], 'cutoff': item['cutoff'],
                 'achievers': item['achievers'], 'concentrated': item['concentrated']}
                for item in result['subject_stats']
            ],
        })
        for s in result['students']:
            if not s.get('identity_reliable'):
                anonymous += 1
                continue
            if s.get('rank') is None:
                continue
            record = students.setdefault(s['id'], dict(id=s['id'], name=s['name'], **{'class':s['class']}, history=[]))
            record['class'] = s['class']
            record['name'] = s['name']
            record['history'].append(dict(
                exam_id=row['id'], name=info['name'], date=info['date'], class_name=s['class'],
                **{'class': s['class']}, rank=s['rank'], participants=result['summary']['participants'],
                weight=weight, total=s['total'], scores=s['scores'], weak=s['weak'],
                grades=s['grades'], levels=s['levels'],
            ))
    result_rows = []
    for record in students.values():
        values = [h['rank'] for h in record['history']]
        weights = [h['weight'] for h in record['history']]
        a = rounded(sum(values)/len(values))
        t = rounded((sum(values)-max(values)-min(values))/(len(values)-2)) if len(values) >= 3 else None
        w = rounded(sum(x*y for x,y in zip(values,weights))/sum(weights))
        components = [x for x in (a,t,w) if x is not None]
        record.update(attempts=len(values), mean=a, trimmed=t, weighted=w, composite=sum(components)/len(components))
        result_rows.append(record)
    ordered = sorted([r['composite'] for r in result_rows])
    rank_map = {}
    for i, value in enumerate(ordered, 1):
        rank_map.setdefault(value, i)
    for record in result_rows:
        record['rank'] = rank_map[record['composite']]
    result_rows.sort(key=lambda r: (r['rank'], r['class'], r['name']))
    warnings = ['默认权重按考试先后取1、2、3…，可自行修改；这不是学校已确认的十次权重方案。', '班级与姓名匹配只能串联同班同名记录；跨班历史请提供稳定学号。不同试卷难度和参评人数会影响名次比较。']
    if anonymous:
        warnings.insert(0, f'{anonymous} 条记录没有姓名或学号，未纳入个人历史匹配；班级趋势仍可查看。')
    return dict(exams=exams, students=result_rows, warnings=warnings,
                selected_exam_ids=[item['id'] for item in exams], subject_trends=subject_trends)


class Handler(BaseHTTPRequestHandler):
    server_version = 'Zhixu/1.0'

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
                rows = conn.execute('SELECT * FROM exams WHERE archived=? ORDER BY created_at DESC', (archived,)).fetchall()
            return self.send(dict(exams=[exam_summary(r) for r in rows]))
        match = re.fullmatch(r'/api/exams/([^/]+)', path)
        if match:
            row = get_exam(match.group(1))
            return self.send(dict(dataset=json.loads(row['dataset']), rules=json.loads(row['rules'])))
        if path in ('/api/school', '/api/trends'):
            with db() as conn:
                rows = conn.execute('SELECT * FROM exams WHERE archived=0 ORDER BY created_at').fetchall()
            rows.sort(key=lambda r: (json.loads(r['dataset']).get('date', ''), r['created_at'], r['id']))
            if path == '/api/trends':
                grade = query.get('grade', [''])[0]
                data = []
                for row in rows:
                    info = exam_summary(row)
                    if info['grade'] == grade:
                        result = exam_analysis(row)
                        data.append({k: info[k] for k in ('id','name','date','grade')} | {k: result[k] for k in ('summary','subject_stats','class_stats')} | {'rules':result['rules']})
                return self.send(dict(exams=data))
            latest = {}
            for row in rows:
                latest[exam_summary(row)['grade']] = row
            grades = [dict(grade=g, exam=exam_summary(row), analysis=exam_analysis(row)) for g,row in sorted(latest.items())]
            totals = dict(grades=len(grades), classes=sum(len(g['analysis']['classes']) for g in grades),
                          registered=sum(g['analysis']['summary']['registered'] for g in grades),
                          participants=sum(g['analysis']['summary']['participants'] for g in grades))
            return self.send(dict(grades=grades, totals=totals, exam_count=len(rows)))
        if path == '/api/notes':
            exam_id = query.get('exam_id', [''])[0]
            with db() as conn:
                rows = conn.execute('SELECT * FROM notes WHERE exam_id=? ORDER BY created_at DESC', (exam_id,)).fetchall()
            return self.send(dict(notes=[dict(id=r['id'], exam_id=r['exam_id'], **{'class':r['class_name']},text=r['text'],created_at=r['created_at']) for r in rows]))
        if path == '/api/backup':
            with db() as conn:
                exams = [dict(id=r['id'],dataset=json.loads(r['dataset']),rules=json.loads(r['rules']),archived=bool(r['archived']),created_at=r['created_at']) for r in conn.execute('SELECT * FROM exams')]
                notes = [dict(r) for r in conn.execute('SELECT * FROM notes')]
            backup = dict(format='zhixu-backup',version=1,exported_at=now(),exams=exams,notes=notes)
            return self.send(encode(backup).encode(), mime='application/json; charset=utf-8', filename='融侨学迹备份.json')
        if path.startswith('/api/'):
            return self.error('没有这个接口。', 404)
        target = (WEB / (path.lstrip('/') or 'index.html')).resolve()
        if WEB.resolve() not in target.parents or not target.is_file():
            return self.error('页面不存在。', 404)
        return self.send(target.read_bytes(), mime=(mimetypes.guess_type(target.name)[0] or 'application/octet-stream') + ('; charset=utf-8' if target.suffix in ('.html','.js','.css') else ''))

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

    def post_route(self, path, payload):
        if path == '/api/import':
            filename = Path(str(payload.get('filename','成绩.xlsx'))).name
            content = base64.b64decode(payload.get('content',''), validate=True)
            if len(content) > 20*1024*1024:
                raise ValueError('文件超过20MB，请拆分后导入。')
            dataset = parse_workbook(content, filename, payload.get('metadata') or {}, payload.get('password'))
            validate_dataset(dataset)
            return self.send(dataset)
        if path == '/api/analyze':
            if payload.get('exam_id'):
                return self.send(exam_analysis(get_exam(payload['exam_id']), payload.get('rules')))
            return self.send(analyze(validate_dataset(payload.get('dataset')), payload.get('rules')))
        if path == '/api/exams':
            dataset = validate_dataset(payload.get('dataset'))
            if not dataset.get('grade') or not dataset.get('name') or not dataset.get('date'):
                raise ValueError('保存考试前，请填写考试名称、年级和日期。')
            try:
                datetime.strptime(dataset['date'], '%Y-%m-%d')
            except ValueError:
                raise ValueError('考试日期应为年月日，例如2026-10-19。')
            result = analyze(dataset, payload.get('rules'))
            timestamp = now()
            with db() as conn:
                conn.execute('INSERT INTO exams(id,dataset,rules,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET dataset=excluded.dataset,rules=excluded.rules,updated_at=excluded.updated_at',
                             (dataset['id'], encode(dataset), encode(result['rules']), timestamp, timestamp))
            return self.send(exam_summary(get_exam(dataset['id'])))
        match = re.fullmatch(r'/api/exams/([^/]+)/(rules|archive|restore)', path)
        if match:
            exam_id, action = match.groups()
            row = get_exam(exam_id)
            if action == 'rules':
                result = exam_analysis(row, payload.get('rules', {}))
                with db() as conn:
                    conn.execute('UPDATE exams SET rules=?,updated_at=? WHERE id=?', (encode(result['rules']), now(), exam_id))
                return self.send(exam_summary(get_exam(exam_id)))
            with db() as conn:
                conn.execute('UPDATE exams SET archived=?,updated_at=? WHERE id=?', (1 if action=='archive' else 0, now(), exam_id))
            return self.send(dict(ok=True))
        if path == '/api/notes':
            exam_id = str(payload.get('exam_id',''))
            get_exam(exam_id)
            message = str(payload.get('text','')).strip()
            if not message or len(message)>20000:
                raise ValueError('跟进记录应为1至20,000字。')
            note = dict(id=uuid.uuid4().hex, exam_id=exam_id, **{'class':str(payload.get('class',''))[:60]}, text=message, created_at=now())
            with db() as conn:
                conn.execute('INSERT INTO notes VALUES(?,?,?,?,?)', (note['id'],exam_id,note['class'],message,note['created_at']))
            return self.send(note)
        if path == '/api/history':
            return self.send(calculate_history(payload))
        if path == '/api/export/xlsx':
            return self.send(export_workbook(payload.get('analysis')), mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename='成绩分析结果.xlsx')
        if path == '/api/restore':
            backup = payload.get('backup', {})
            if not isinstance(backup, dict) or backup.get('format') != 'zhixu-backup' or backup.get('version') != 1:
                raise ValueError('这不是本软件支持的备份文件。')
            exams = backup.get('exams', [])
            notes = backup.get('notes', [])
            if not isinstance(exams, list) or len(exams) > 2000 or not isinstance(notes, list) or len(notes)>50000:
                raise ValueError('备份记录格式或数量不正确。')
            # Validate everything before transaction: partial restores are not reported as success.
            for item in exams:
                validate_dataset(item['dataset'])
                if item.get('id') != item['dataset']['id']:
                    raise ValueError('备份的考试标识不一致。')
                analyze(item['dataset'], item.get('rules'))
            for item in notes:
                if not all(isinstance(item.get(k), str) for k in ('id','exam_id','text','created_at')) or len(item['text']) > 20000:
                    raise ValueError('备份中的跟进记录格式不正确。')
            count = 0
            with db() as conn:
                for item in exams:
                    cursor = conn.execute('INSERT OR IGNORE INTO exams VALUES(?,?,?,?,?,?)', (item['id'],encode(item['dataset']),encode(item.get('rules',{})),int(bool(item.get('archived'))),item.get('created_at',now()),now()))
                    count += cursor.rowcount
                for item in notes:
                    if conn.execute('SELECT 1 FROM exams WHERE id=?',(item['exam_id'],)).fetchone():
                        conn.execute('INSERT OR IGNORE INTO notes VALUES(?,?,?,?,?)', (item['id'],item['exam_id'],item.get('class_name',item.get('class','')),item['text'],item['created_at']))
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
    print(f'融侨学迹已启动：{url}\n保持此窗口打开。按 Ctrl+C 可停止。\n数据目录：{DATA}', flush=True)
    if not args.no_open:
        import webbrowser
        threading.Timer(0.5, lambda:webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
