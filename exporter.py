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
    ver = int(meta.get('data_version') or 1)
    ec = int(meta.get('edit_count') or 0)
    version_tag = f'数据版本 v{ver} · 含 {ec} 处更正' if ec > 0 else f'数据版本 v{ver} · 原始导入'
    subtitle = f"{meta.get('grade', '')} · {meta.get('name', '')} · {meta.get('date', '')} · {version_tag}"
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
        ws.oddFooter.left.text = version_tag
        ws.oddFooter.center.text = '第 &P 页 / 共 &N 页'
    if not wb.sheetnames:
        raise ValueError('没有可导出的工作表。')
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def generate_score_template_xlsx() -> bytes:
    """Generate a clean downloadable standard score import Excel template."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = '原始成绩（示例）'
    headers = ['班级', '学号', '姓名', '语文', '数学', '英语', '物理', '化学', '政治', '历史']
    ws.append(headers)
    ws.append(['01', '20280101', '示例同学甲', 118, 132, 126, 86, 78, 62, 64])
    ws.append(['01', '20280102', '示例同学乙', 105, 98, 114, 72, 65, 58, 60])
    ws.append(['02', '20280201', '示例同学丙', 124, 141, 134, 92, 85, 66, 67])

    for cell in ws[1]:
        cell.fill = PatternFill('solid', fgColor='EEE7F8')
        cell.font = Font(name='Microsoft YaHei', size=10, bold=True, color='493559')
        cell.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 28
    for row in ws.iter_rows(min_row=2, max_row=4):
        for cell in row:
            cell.font = Font(name='Microsoft YaHei', size=10, color='302A40')
            cell.alignment = Alignment(horizontal='center', vertical='center')
    for idx, col in enumerate(headers, 1):
        ws.column_dimensions[get_column_letter(idx)].width = 14 if idx in (2, 3) else 10
    ws.freeze_panes = 'A2'

    guide = wb.create_sheet('填写说明')
    guide_rows = [
        ['融侨学迹 · 标准成绩导入模板填写说明'],
        ['1. 必填列：「班级」与至少一门学科列（如语文、数学、英语等）。'],
        ['2. 建议保留「学号」列：提供稳定学号后，即使学生转班、改名或全年级重名，也能精准串联历次成长轨迹。'],
        ['3. 缺考与空白：缺考科目请留空或填“缺考”，系统不会自动把空白当成 0 分。'],
        ['4. 学科列增减：可按实际考试科目自由增删列（支持语文、数学、英语、物理、化学、政治/道法、历史、地理、生物、体育等）。'],
        ['5. 一表多考总表：可将同一届历次考试分别放在同一个 Excel 的不同工作表（Sheet）中，并使用软件内「多考总表批量导入」一次增量建档。'],
        ['6. 正式导入前，请删除第 2～4 行示例数据并粘贴真实成绩。'],
    ]
    for r in guide_rows:
        guide.append(r)
    guide['A1'].font = Font(name='Microsoft YaHei', size=13, bold=True, color='684792')
    for r_idx in range(2, len(guide_rows) + 1):
        guide[f'A{r_idx}'].font = Font(name='Microsoft YaHei', size=10, color='302A40')
    guide.column_dimensions['A'].width = 96

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def generate_teacher_template_xlsx() -> bytes:
    """Generate a clean downloadable standard teacher-assignment Excel template."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = '教师基本信息'
    headers = ['考试名称', '班级', '班主任', '语文', '数学', '英语', '物理', '化学', '政治', '历史']
    ws.append(headers)
    ws.append(['初三定时练习（二）', '01', '张老师', '张老师', '李老师', '王老师', '赵老师', '陈老师', '周老师', '吴老师'])
    ws.append(['初三定时练习（二）', '02', '刘老师', '张老师', '孙老师', '王老师', '赵老师', '陈老师', '周老师', '郑老师'])

    for cell in ws[1]:
        cell.fill = PatternFill('solid', fgColor='EEE7F8')
        cell.font = Font(name='Microsoft YaHei', size=10, bold=True, color='493559')
        cell.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 28
    for row in ws.iter_rows(min_row=2, max_row=3):
        for cell in row:
            cell.font = Font(name='Microsoft YaHei', size=10, color='302A40')
            cell.alignment = Alignment(horizontal='center', vertical='center')
    ws.column_dimensions['A'].width = 22
    ws.column_dimensions['B'].width = 10
    for idx in range(3, len(headers) + 1):
        ws.column_dimensions[get_column_letter(idx)].width = 11
    ws.freeze_panes = 'A2'

    guide = wb.create_sheet('填写说明')
    guide_rows = [
        ['融侨学迹 · 任课教师表填写说明'],
        ['1. 「考试名称」列可选：如果一张表记录多场考试的任课安排，请确保「考试名称」与已保存考试名称一致；如只导入单场考试，可删除该列。'],
        ['2. 同簿导入：也可直接把本工作表放进「多考总表」Excel 中，批量导入成绩时系统会自动识别「教师基本信息」页并按考试名自动关联。'],
        ['3. 同师多班对比：两位班级填相同教师姓名后，班情分析会自动生成该教师跨班双线达标对比。'],
    ]
    for r in guide_rows:
        guide.append(r)
    guide['A1'].font = Font(name='Microsoft YaHei', size=13, bold=True, color='684792')
    for r_idx in range(2, len(guide_rows) + 1):
        guide[f'A{r_idx}'].font = Font(name='Microsoft YaHei', size=10, color='302A40')
    guide.column_dimensions['A'].width = 96

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def generate_score_edits_template_xlsx() -> bytes:
    """Generate a clean downloadable score correction template Excel file."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = '成绩更正表'
    headers = ['学号或姓名', '班级', '科目', '新分数']
    ws.append(headers)
    ws.append(['20280101', '01', '数学', 132])
    ws.append(['张三', '01', '英语', '缺考'])

    for cell in ws[1]:
        cell.fill = PatternFill('solid', fgColor='EEE7F8')
        cell.font = Font(name='Microsoft YaHei', size=10, bold=True, color='493559')
        cell.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 28
    for row in ws.iter_rows(min_row=2, max_row=3):
        for cell in row:
            cell.font = Font(name='Microsoft YaHei', size=10, color='302A40')
            cell.alignment = Alignment(horizontal='center', vertical='center')
    widths = [18, 10, 12, 12]
    for idx, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(idx)].width = w
    ws.freeze_panes = 'A2'

    guide = wb.create_sheet('填写说明')
    guide_rows = [
        ['融侨学迹 · 成绩更正表填写说明'],
        ['1. 必填列：「学号或姓名」、「科目」、「新分数」；建议同时填写「班级」以防同名歧义。'],
        ['2. 匹配规则：优先按学号精确匹配；未填学号时按「班级 + 姓名」匹配。'],
        ['3. 缺考与 0 分：「新分数」填“缺考”或留空表示改为缺考（不计该科分）；填 0 表示真实 0 分。'],
        ['4. 导入后先展示影响预览，确认无误并填写原因后才正式写入修改记录。'],
    ]
    for r in guide_rows:
        guide.append(r)
    guide['A1'].font = Font(name='Microsoft YaHei', size=13, bold=True, color='684792')
    for r_idx in range(2, len(guide_rows) + 1):
        guide[f'A{r_idx}'].font = Font(name='Microsoft YaHei', size=10, color='302A40')
    guide.column_dimensions['A'].width = 92

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
