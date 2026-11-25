"""Optional item-level / section-level score analysis (difficulty, discrimination, lecture queue)."""
from __future__ import annotations

import csv
import io
import math
import re
from decimal import Decimal, ROUND_HALF_UP

from workbook import class_sort_key, normalize_class

_ID_HEADERS = {'学号', '考号', '学生编码', '编码', '准考证号', 'id', 'student_id'}
_NAME_HEADERS = {'姓名', '学生姓名', 'name'}
_CLASS_HEADERS = {'班级', '班别', '班号', '行政班', 'class'}
_SKIP_HEADERS = {'总分', '客观题总分', '主观题总分', '名次', '排名', '班排', '校排', '年级排名', '备注', '序号', '等级'}
_FULL_MARK_ROW_LABELS = {'满分', '分值', '本题满分', '小题满分', '标准分值'}
_FULL_MARK_RE = re.compile(r'[（(]\s*(?:满分|分值)?\s*(\d+(?:\.\d+)?)\s*分?\s*[）)]\s*$')


def _r(value: float, digits: int = 1) -> float:
    q = '1' if digits == 0 else '0.' + '0' * (digits - 1) + '1'
    return float(Decimal(str(value)).quantize(Decimal(q), rounding=ROUND_HALF_UP))


def _to_float(val) -> float | None:
    if val is None:
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val) if math.isfinite(val) and val >= 0 else None
    text = str(val).strip()
    if not text or text in ('-', '—', '缺', '缺考', 'N/A', 'nan', 'None'):
        return None
    try:
        num = float(text)
        return num if math.isfinite(num) and num >= 0 else None
    except ValueError:
        return None


def _read_rows(filename: str, content_bytes: bytes) -> list[list]:
    if not content_bytes:
        raise ValueError('小题分文件为空，请重新选择文件。')
    lower = filename.lower()
    if lower.endswith('.csv'):
        text = None
        for enc in ('utf-8-sig', 'gb18030', 'utf-8'):
            try:
                text = content_bytes.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise ValueError('CSV 编码无法识别，请另存为 UTF-8 编码或 Excel (.xlsx) 后重试。')
        return [row for row in csv.reader(io.StringIO(text))]
    if lower.endswith(('.xlsx', '.xlsm')):
        import openpyxl
        try:
            wb = openpyxl.load_workbook(io.BytesIO(content_bytes), data_only=True, read_only=True)
        except Exception as exc:
            raise ValueError('无法读取小题分工作簿，请确认文件是未加密且完整的 .xlsx 文件。') from exc
        try:
            ws = wb.active
            return [list(r) for r in ws.iter_rows(values_only=True)]
        finally:
            wb.close()
    raise ValueError('小题分导入支持 .xlsx、.xlsm 和 .csv 格式。旧版 .xls 请先另存为 .xlsx。')


def _parse_header_item(raw: str) -> tuple[str, float | None]:
    text = str(raw or '').strip()
    m = _FULL_MARK_RE.search(text)
    if m:
        fm = float(m.group(1))
        name = text[:m.start()].strip() or text
        return name, fm if fm > 0 else None
    return text, None


def parse_item_scores_file(filename: str, content_bytes: bytes, *, subject: str = '') -> dict:
    """Parse an item-level or section-level score table without guessing missing full marks."""
    raw_rows = _read_rows(filename, content_bytes)
    if not raw_rows:
        raise ValueError('小题分文件没有可读取的内容。')

    header_idx = None
    col_class = col_name = col_id = None
    item_cols: list[tuple[int, str, float | None]] = []

    for r_idx, row in enumerate(raw_rows[:15]):
        cells = [str(c).strip() if c is not None else '' for c in row]
        if sum(1 for c in cells if c) < 2:
            continue
        c_cls = c_nam = c_id = None
        items: list[tuple[int, str, float | None]] = []
        for idx, cell in enumerate(cells):
            if not cell:
                continue
            low = cell.lower()
            if cell in _CLASS_HEADERS or low in _CLASS_HEADERS:
                c_cls = idx
            elif cell in _NAME_HEADERS or low in _NAME_HEADERS:
                c_nam = idx
            elif cell in _ID_HEADERS or low in _ID_HEADERS:
                c_id = idx
            elif cell in _SKIP_HEADERS or low in _SKIP_HEADERS:
                continue
            else:
                name, fm = _parse_header_item(cell)
                if name:
                    items.append((idx, name, fm))
        if (c_cls is not None or c_nam is not None or c_id is not None) and len(items) >= 1:
            header_idx = r_idx
            col_class, col_name, col_id = c_cls, c_nam, c_id
            item_cols = items
            break

    if header_idx is None or not item_cols:
        raise ValueError(
            '未识别到有效的小题分表头。\n'
            '排查建议：1) 确保前 15 行包含「班级」或「姓名/学号」列以及至少 1 个题号/板块列；'
            '2) 建议在题名括号中注明满分，如「第1题(4分)」「选择题(30分)」；'
            '3) 可先点击「下载小题分模板」对照填写。'
        )

    # Deduplicate item names while preserving order
    seen_names: dict[str, int] = {}
    items_meta: list[dict] = []
    col_map: list[tuple[int, str]] = []
    for col_idx, name, fm in item_cols:
        cnt = seen_names.get(name, 0) + 1
        seen_names[name] = cnt
        uniq_name = name if cnt == 1 else f'{name}_{cnt}'
        items_meta.append({'name': uniq_name, 'full_mark': fm})
        col_map.append((col_idx, uniq_name))

    full_marks = {it['name']: it['full_mark'] for it in items_meta}
    students = []
    classes_set = set()

    for row_num, row in enumerate(raw_rows[header_idx + 1:], start=header_idx + 2):
        if not row or all(c is None or str(c).strip() == '' for c in row):
            continue
        raw_name = str(row[col_name]).strip() if (col_name is not None and col_name < len(row) and row[col_name] is not None) else ''
        raw_cls = str(row[col_class]).strip() if (col_class is not None and col_class < len(row) and row[col_class] is not None) else ''
        raw_id = str(row[col_id]).strip() if (col_id is not None and col_id < len(row) and row[col_id] is not None) else ''

        # Detect optional full-mark row ("满分" / "分值")
        if raw_name in _FULL_MARK_ROW_LABELS or raw_cls in _FULL_MARK_ROW_LABELS or raw_id in _FULL_MARK_ROW_LABELS:
            for col_idx, item_name in col_map:
                if col_idx < len(row):
                    fm_val = _to_float(row[col_idx])
                    if fm_val is not None and fm_val > 0:
                        full_marks[item_name] = fm_val
            continue

        # Skip summary rows like 平均分 / 得分率
        if any(tok in (raw_name, raw_cls) for tok in ('平均分', '均分', '得分率', '合计', '总计', '最高分', '最低分')):
            continue

        scores = {}
        has_any = False
        for col_idx, item_name in col_map:
            val = _to_float(row[col_idx]) if col_idx < len(row) else None
            scores[item_name] = val
            if val is not None:
                has_any = True
        if not has_any:
            continue

        cls = normalize_class(raw_cls) if raw_cls else '未分班'
        classes_set.add(cls)
        students.append({
            'id': raw_id or f'row:{row_num}',
            'name': raw_name or f'第{row_num}行',
            'class': cls,
            'scores': scores,
        })

    if not students:
        raise ValueError('已识别小题分表头，但未找到有效的学生得分行。')

    for it in items_meta:
        it['full_mark'] = full_marks.get(it['name'])

    classes = sorted(classes_set, key=class_sort_key)
    return {
        'subject': subject.strip() or '未指定学科',
        'filename': filename,
        'items': items_meta,
        'classes': classes,
        'students': students,
    }


def analyze_item_scores(dataset: dict, *, class_name: str = '') -> dict:
    """Compute item difficulty (score_rate), discrimination (top27%-bottom27%), and lecture priority."""
    all_students = dataset.get('students') or []
    items_meta = dataset.get('items') or []
    norm_cls = normalize_class(class_name) if class_name else ''
    students = [s for s in all_students if not norm_cls or s.get('class') == norm_cls]
    n_stu = len(students)

    # Compute each student's sum across available items for high/low 27% grouping
    scored_students = []
    for s in students:
        vals = [v for v in (s.get('scores') or {}).values() if v is not None]
        if vals:
            scored_students.append((sum(vals), s))
    scored_students.sort(key=lambda x: -x[0])

    group_k = max(1, int(math.floor(len(scored_students) * 0.27))) if len(scored_students) >= 6 else 0
    high_group = [s for _, s in scored_students[:group_k]] if group_k else []
    low_group = [s for _, s in scored_students[-group_k:]] if group_k else []

    item_stats = []
    for it in items_meta:
        name = it['name']
        fm = it.get('full_mark')
        vals = [float(s['scores'][name]) for s in students if (s.get('scores') or {}).get(name) is not None]
        cnt = len(vals)
        mean_v = _r(sum(vals) / cnt, 2) if cnt else None
        max_v = _r(max(vals), 1) if cnt else None
        min_v = _r(min(vals), 1) if cnt else None

        score_rate = _r(mean_v / fm * 100.0, 1) if (mean_v is not None and fm and fm > 0) else None
        total_loss = _r(sum(max(0.0, fm - v) for v in vals), 1) if (cnt and fm and fm > 0) else None

        high_mean = low_mean = discrimination = None
        if group_k and fm and fm > 0:
            h_vals = [float(s['scores'][name]) for s in high_group if (s.get('scores') or {}).get(name) is not None]
            l_vals = [float(s['scores'][name]) for s in low_group if (s.get('scores') or {}).get(name) is not None]
            if h_vals and l_vals:
                high_mean = _r(sum(h_vals) / len(h_vals), 2)
                low_mean = _r(sum(l_vals) / len(l_vals), 2)
                discrimination = _r((high_mean - low_mean) / fm, 2)

        # Deterministic lecture priority classification
        if n_stu < 3:
            p_code, p_label, p_tone = 'small_sample', '样本不足3人', 'neutral'
        elif score_rate is None:
            p_code, p_label, p_tone = 'no_full_mark', '未设满分（仅均分）', 'neutral'
        elif score_rate < 50.0:
            p_code, p_label, p_tone = 'must_teach', '必讲·共性失分', 'alert'
        elif score_rate < 70.0 and (discrimination is None or discrimination >= 0.30):
            p_code, p_label, p_tone = 'focus_disc', '重点辨析·拉分题', 'warn'
        elif score_rate < 70.0:
            p_code, p_label, p_tone = 'check_base', '中度失分·夯基础', 'warn'
        elif discrimination is not None and discrimination >= 0.35:
            p_code, p_label, p_tone = 'focus_disc', '区分度高·分层讲', 'warn'
        else:
            p_code, p_label, p_tone = 'skip_ok', '掌握良好·可略讲', 'good'

        item_stats.append({
            'item': name,
            'full_mark': fm,
            'count': cnt,
            'mean': mean_v,
            'max': max_v,
            'min': min_v,
            'score_rate': score_rate,
            'high_mean': high_mean,
            'low_mean': low_mean,
            'discrimination': discrimination,
            'total_loss': total_loss,
            'priority_code': p_code,
            'priority_label': p_label,
            'priority_tone': p_tone,
        })

    # Lecture priority queue: highest total_loss first (or lowest score_rate)
    lecture_queue = sorted(
        item_stats,
        key=lambda x: (
            0 if x['priority_code'] == 'must_teach' else (1 if x['priority_code'] in ('focus_disc', 'check_base') else 2),
            -(x['total_loss'] if x['total_loss'] is not None else -1.0),
            x['score_rate'] if x['score_rate'] is not None else 999.0,
        ),
    )

    valid_rates = [x['score_rate'] for x in item_stats if x['score_rate'] is not None]
    return {
        'subject': dataset.get('subject') or '未指定学科',
        'filename': dataset.get('filename') or '',
        'class': norm_cls,
        'classes': dataset.get('classes') or [],
        'summary': {
            'student_count': n_stu,
            'item_count': len(item_stats),
            'full_mark_known_count': sum(1 for x in item_stats if x['full_mark'] is not None),
            'avg_score_rate': _r(sum(valid_rates) / len(valid_rates), 1) if valid_rates else None,
            'must_teach_count': sum(1 for x in item_stats if x['priority_code'] == 'must_teach'),
            'focus_count': sum(1 for x in item_stats if x['priority_code'] in ('focus_disc', 'check_base')),
            'small_sample': n_stu < 3,
            'has_discrimination': group_k > 0,
        },
        'items': item_stats,
        'lecture_queue': lecture_queue,
    }


def build_item_template_xlsx() -> bytes:
    """Build a standard Excel template for item/section score analysis."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = '小题分模板'
    headers = ['学号', '姓名', '班级', '第1题(4分)', '第2题(4分)', '选择题汇总(30分)', '实验探究(12分)', '综合应用(18分)']
    ws.append(headers)
    ws.append(['20270101', '张一', '01', 4, 4, 28, 10, 15])
    ws.append(['20270102', '李二', '01', 4, 0, 22, 7, 9])
    ws.append(['20270103', '王三', '01', 0, 4, 24, 9, 12])

    for cell in ws[1]:
        cell.fill = PatternFill('solid', fgColor='EEE7F8')
        cell.font = Font(name='Microsoft YaHei', size=10, bold=True, color='3D2570')
        cell.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 24
    for col_letter, width in (('A', 12), ('B', 10), ('C', 8), ('D', 13), ('E', 13), ('F', 17), ('G', 15), ('H', 15)):
        ws.column_dimensions[col_letter].width = width

    note_ws = wb.create_sheet('填写说明')
    note_ws.append(['融侨学迹 · 小题分 / 板块分导入说明'])
    note_ws.append(['1. 题号或板块列名建议在括号中注明满分，如「第1题(4分)」「阅读理解(25分)」；也可以在表头下方新增一行「满分」填各题分值。'])
    note_ws.append(['2. 未提供满分的题目不会猜满分，仅计算均分；提供满分后自动计算得分率（难度）、高低分组区分度与累计失分讲评清单。'])
    note_ws.append(['3. 缺考或未作答留空即可，0 分请填 0。'])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
