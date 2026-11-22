"""Styled multi-sheet Excel workbook export for 融侨学迹."""
from __future__ import annotations

import io
import json
import re


def _encode(value) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def export_workbook(analysis: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
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
        value = _encode(v) if isinstance(v, (dict, list)) else str(v)
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
        for r in (1, 2, 3):
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
            lengths = [len(str(col)) * 1.65] + [
                len(str(row[index - 1] or '')) * 1.5 for row in rows[:120] if len(row) >= index
            ]
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
