"""Role-based safe distribution: per-class ZIP bundles and zero-exposure student diagnostic cards."""
from __future__ import annotations

import html
import io
import math
import re
import zipfile

from class_brief import build_class_brief
from history import calc_pr, calc_t_score

# Polyphonic Chinese surname overrides mapped to GB2312 Level-1 homophones for accurate Pinyin sorting
_SURNAME_PINYIN_MAP = {
    '仇': '秋', '单': '山', '解': '谢', '查': '扎', '区': '欧',
    '朴': '飘', '乐': '月', '盖': '哥', '柏': '白', '翟': '宅',
    '折': '蛇', '员': '云', '冼': '显', '尉': '玉', '覃': '秦',
    '繁': '婆', '缪': '妙', '种': '虫', '秘': '闭', '都': '督',
    '那': '纳', '乜': '聂', '曾': '增', '任': '人', '沈': '审',
    '燕': '烟', '俞': '鱼', '臧': '脏', '竺': '竹', '贾': '假',
    '褚': '楚', '逄': '旁', '阚': '看', '谌': '陈', '宿': '素',
    '盛': '胜', '纪': '记', '解': '谢', '隗': '伟', '万': '万',
}


def surname_sort_key(name: str) -> tuple:
    """Deterministic Chinese surname Pinyin sort key using stdlib GBK ordering + polyphonic map."""
    text = str(name or '').strip()
    if not text:
        return (1, b'', '')
    first = _SURNAME_PINYIN_MAP.get(text[0], text[0])
    normalized = first + text[1:]
    try:
        key_bytes = normalized.encode('gbk')
    except UnicodeEncodeError:
        parts = []
        for ch in normalized:
            try:
                parts.append(ch.encode('gbk'))
            except UnicodeEncodeError:
                parts.append(b'\xff' + ch.encode('utf-8'))
        key_bytes = b''.join(parts)
    return (0, key_bytes, text)


def _mean_std(values: list[float]) -> tuple[float | None, float | None]:
    if not values:
        return None, None
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    return mean, math.sqrt(var)


def _safe_excel_cell(value):
    if value is None or isinstance(value, (int, float, bool)):
        return value
    text = str(value)
    return "'" + text if re.match(r'^\s*[=+@-]', text) else text


def _student_advice(student: dict, sub_items: list[dict], history: list[dict]) -> dict:
    """Generate warm, deterministic, evidence-based personal diagnosis without hallucination."""
    valid_subs = [x for x in sub_items if x['pr'] is not None]
    strengths = sorted(valid_subs, key=lambda x: (-x['pr'], -(x['mean_diff'] or 0)))[:2]
    strength_names = {x['subject'] for x in strengths}
    weak_names = [w['subject'] for w in (student.get('weak') or []) if isinstance(w, dict) and w.get('subject')]
    focus_items = [x for x in valid_subs if x['subject'] in weak_names and x['subject'] not in strength_names][:2]
    if not focus_items and valid_subs:
        focus_items = [
            x for x in sorted(valid_subs, key=lambda x: (x['pr'], x['mean_diff'] or 0))
            if x['subject'] not in strength_names
        ][:2]

    if strengths:
        s_labels = '、'.join(f"{x['subject']}（领先年级 {x['pr']:.0f}% 同学）" for x in strengths)
        strength_text = f"优势学科表现稳定：{s_labels}，请继续保持良好的学习节奏与错题复盘习惯。"
    else:
        strength_text = "本次学科数据尚不完整，请核实缺考或补录科目后再作综合判断。"

    if focus_items:
        f_parts = []
        for x in focus_items:
            if x['mean_diff'] is not None and x['mean_diff'] < 0:
                f_parts.append(f"{x['subject']}（较年级均分差 {abs(x['mean_diff']):.1f} 分）")
            else:
                f_parts.append(f"{x['subject']}（学科百分位 {x['pr']:.0f}%）")
        focus_text = f"优先提分抓手：建议下一阶段重点夯实 {'、'.join(f_parts)} 的基础题与高频易错点，抓牢单科短板可带来最直接的总分提升。"
    else:
        focus_text = "各科表现较为均衡，下一阶段可针对压轴题与答题规范性做专项突破。"

    trend_text = ''
    if len(history) >= 2:
        prev, curr = history[-2], history[-1]
        if prev.get('pr') is not None and curr.get('pr') is not None:
            pr_diff = round(curr['pr'] - prev['pr'], 1)
            if pr_diff >= 3:
                trend_text = f"较上一场「{prev['exam_name']}」，年级百分位提升 +{pr_diff:.1f}，进步态势清晰。"
            elif pr_diff <= -3:
                trend_text = f"较上一场「{prev['exam_name']}」，年级百分位回落 {abs(pr_diff):.1f}，建议结合试卷错题查找波动原因。"
            else:
                trend_text = f"较上一场「{prev['exam_name']}」，整体水平保持稳定（百分位变化 {pr_diff:+.1f}）。"

    return {
        'strength_text': strength_text,
        'focus_text': focus_text,
        'trend_text': trend_text,
        'strength_subjects': [x['subject'] for x in strengths],
        'focus_subjects': [x['subject'] for x in focus_items],
    }


def build_student_cards(
    grade_exams: list[tuple[dict, dict, dict]],
    exam_id: str,
    *,
    class_name: str = '',
    student_id: str = '',
) -> dict:
    """Build privacy-safe personal diagnostic cards (zero other-student exposure)."""
    target_idx = next((i for i, (info, _, _) in enumerate(grade_exams) if info['id'] == exam_id), None)
    if target_idx is None:
        raise ValueError('当前考试已归档或不属于所选年级。')

    target_info, target_analysis, _ = grade_exams[target_idx]
    timeline_exams = grade_exams[:target_idx + 1]

    # Pre-index per-exam total mean/std and student lookup for longitudinal growth
    exam_stats_cache = []
    for info, ana, _ in timeline_exams:
        participants = int(ana['summary']['participants'] or 0)
        totals = [float(s['total']) for s in ana['students'] if s.get('rank') is not None and s.get('total') is not None]
        g_mean, g_std = _mean_std(totals)
        by_id = {}
        for s in ana['students']:
            if s.get('identity_reliable'):
                by_id[s['id']] = s
        exam_stats_cache.append((info, ana, participants, g_mean, g_std, by_id))

    sub_stats_map = {st['subject']: st for st in target_analysis.get('subject_stats') or []}
    class_stats_map = {cs['class']: cs for cs in target_analysis.get('class_stats') or []}
    full_marks = (target_analysis.get('rules') or {}).get('full_marks') or {}
    total_subjects = (target_analysis.get('rules') or {}).get('total_subjects') or target_analysis.get('subjects') or []
    full_total = (
        sum(float(full_marks[s]) for s in total_subjects)
        if total_subjects and all(full_marks.get(s) is not None for s in total_subjects)
        else None
    )

    _, _, target_participants, target_mean, target_std, _ = exam_stats_cache[-1]

    selected_students = []
    for s in target_analysis['students']:
        if student_id:
            if s['id'] != student_id:
                continue
        elif class_name:
            if s['class'] != class_name:
                continue
        selected_students.append(s)

    if not selected_students:
        raise ValueError('当前筛选条件下没有可生成诊断卡的学生。')

    cards = []
    for s in selected_students:
        pr = calc_pr(s.get('rank'), target_participants)
        t_score = calc_t_score(s.get('total'), target_mean, target_std)
        cls_stat = class_stats_map.get(s['class']) or {}
        cls_sub_stats = cls_stat.get('subjects') or {}

        sub_items = []
        for sub in target_analysis['subjects']:
            score = (s.get('scores') or {}).get(sub)
            s_rank = (s.get('ranks') or {}).get(sub)
            st = sub_stats_map.get(sub) or {}
            sub_cnt = int(st.get('count') or 0)
            sub_mean = st.get('mean')
            cls_sub_mean = (cls_sub_stats.get(sub) or {}).get('mean')
            sub_pr = calc_pr(s_rank, sub_cnt) if s_rank is not None and sub_cnt > 0 else None
            mean_diff = round(float(score) - float(sub_mean), 1) if (score is not None and sub_mean is not None) else None
            class_mean_diff = round(float(score) - float(cls_sub_mean), 1) if (score is not None and cls_sub_mean is not None) else None
            sub_items.append({
                'subject': sub,
                'score': score,
                'full_mark': full_marks.get(sub),
                'grade': (s.get('grades') or {}).get(sub) or '—',
                'level': (s.get('levels') or {}).get(sub) or '—',
                'pr': sub_pr,
                'grade_mean': sub_mean,
                'mean_diff': mean_diff,
                'class_mean': cls_sub_mean,
                'class_mean_diff': class_mean_diff,
            })

        history = []
        if s.get('identity_reliable'):
            for info, _, parts, gm, gsd, by_id in exam_stats_cache:
                rec = by_id.get(s['id'])
                if rec and rec.get('rank') is not None:
                    history.append({
                        'exam_id': info['id'],
                        'exam_name': info['name'],
                        'date': info['date'],
                        'total': rec.get('total'),
                        'rank': rec.get('rank'),
                        'participants': parts,
                        'pr': calc_pr(rec.get('rank'), parts),
                        't_score': calc_t_score(rec.get('total'), gm, gsd),
                    })

        advice = _student_advice(s, sub_items, history)
        cards.append({
            'id': s['id'],
            'name': s['name'],
            'class': s['class'],
            'total': s.get('total'),
            'full_total': full_total,
            'rank': s.get('rank'),
            'class_rank': s.get('class_rank'),
            'participants': target_participants,
            'pr': pr,
            't_score': t_score,
            'total_grade': (s.get('grades') or {}).get('总分') or '—',
            'total_level': (s.get('levels') or {}).get('总分') or '—',
            'subjects': sub_items,
            'history': history,
            'advice': advice,
        })

    data_version = int((target_analysis.get('metadata') or {}).get('data_version') or target_info.get('data_version') or 1)
    edit_count = int((target_analysis.get('metadata') or {}).get('edit_count') or target_info.get('edit_count') or 0)

    return {
        'meta': {
            'exam_id': target_info['id'],
            'exam_name': target_info['name'],
            'grade': target_info['grade'],
            'date': target_info['date'],
            'class': class_name,
            'card_count': len(cards),
            'subjects': target_analysis['subjects'],
            'data_version': data_version,
            'edit_count': edit_count,
        },
        'cards': cards,
    }


def _class_excel_bytes(analysis: dict, brief: dict, cls: str) -> bytes:
    """Create a single-class headteacher workbook containing ZERO other-class student rows."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    meta = brief['meta']
    subjects = analysis['subjects']
    cls_students = [s for s in analysis['students'] if s['class'] == cls]

    # Sheet 1: 本班成绩明细
    ws1 = wb.active
    ws1.title = f'{cls}班成绩明细'
    ws1.sheet_view.showGridLines = False
    ver = int(meta.get('data_version') or (analysis.get('metadata') or {}).get('data_version') or 1)
    ec = int(meta.get('edit_count') or (analysis.get('metadata') or {}).get('edit_count') or 0)
    version_tag = f'数据版本 v{ver} · 含 {ec} 处更正' if ec > 0 else f'数据版本 v{ver} · 原始导入'
    ws1.append([f"{meta['grade']} · {meta['exam_name']} · {cls}班学生成绩与薄弱学科"])
    ws1.append([f"考试日期：{meta['exam_date']} · {version_tag} · 仅包含{cls}班学生"])
    ws1.append([])
    cols1 = ['姓名', '总分', '班内名次', '年级名次', '总分ABC', '总分六级', *subjects, '优先关注薄弱科']
    ws1.append(cols1)
    for s in cls_students:
        ws1.append([
            _safe_excel_cell(s['name']),
            s.get('total'),
            s.get('class_rank'),
            s.get('rank'),
            (s.get('grades') or {}).get('总分') or '',
            (s.get('levels') or {}).get('总分') or '',
            *[(s.get('scores') or {}).get(sub) for sub in subjects],
            '、'.join(w['subject'] for w in (s.get('weak') or []) if isinstance(w, dict) and w.get('subject')),
        ])

    # Sheet 2: 本班学科与双线诊断
    ws2 = wb.create_sheet(f'{cls}班学科诊断')
    ws2.sheet_view.showGridLines = False
    hl = brief['headline']
    ws2.append([f"{meta['grade']} · {meta['exam_name']} · {cls}班双线与学科诊断"])
    ws2.append([
        f"班主任：{meta.get('homeroom') or '未配置'} · "
        f"{hl['high']['label']}达标 {hl['high']['count']}人（{hl['high']['rate'] or 0}%） · "
        f"{hl['main']['label']}达标 {hl['main']['count']}人（{hl['main']['rate'] or 0}%）"
    ])
    ws2.append([])
    cols2 = [
        '学科', '任课教师', '本班均分', '年级均分',
        f"{hl['high']['label']}单科达标", f"{hl['high']['label']}集中人数",
        f"{hl['main']['label']}单科达标", f"{hl['main']['label']}集中人数", '诊断标签',
    ]
    ws2.append(cols2)
    for row in brief.get('subject_diagnosis') or []:
        ws2.append([
            row['subject'],
            _safe_excel_cell(row.get('teacher') or '—'),
            row.get('mean'),
            row.get('grade_mean'),
            (row.get('high') or {}).get('achievers'),
            (row.get('high') or {}).get('concentrated'),
            (row.get('main') or {}).get('achievers'),
            (row.get('main') or {}).get('concentrated'),
            row.get('mismatch_label') or '均衡',
        ])

    # Sheet 3: 本班重点抓手名单
    ws3 = wb.create_sheet(f'{cls}班重点名单')
    ws3.sheet_view.showGridLines = False
    ws3.append([f"{meta['grade']} · {meta['exam_name']} · {cls}班临界与导师制抓手名单"])
    ws3.append(['仅本班学生，供班主任与任课教师精准包干使用'])
    ws3.append([])
    cols3 = ['名单类别', '姓名', '总分', '年级名次', '具体诊断 / 缺口学科']
    ws3.append(cols3)
    lists = brief.get('action_lists') or {}
    for item in lists.get('borderline_high') or []:
        miss = '、'.join(f"{m['subject']}(-{m['gap']})" if m.get('gap') is not None else m['subject'] for m in (item.get('missing_subjects') or []))
        ws3.append([f"冲{hl['high']['label']}临界", _safe_excel_cell(item['name']), item.get('total'), item.get('rank'), f"距线-{item.get('score_gap')}分；{miss}"])
    for item in lists.get('borderline_main') or []:
        miss = '、'.join(f"{m['subject']}(-{m['gap']})" if m.get('gap') is not None else m['subject'] for m in (item.get('missing_subjects') or []))
        ws3.append([f"冲{hl['main']['label']}临界", _safe_excel_cell(item['name']), item.get('total'), item.get('rank'), f"距线-{item.get('score_gap')}分；{miss}"])
    for item in lists.get('drop_alerts') or []:
        ws3.append(['中优层流失预警', _safe_excel_cell(item['name']), None, item.get('curr_rank'), f"{item.get('prev_tier')}→{item.get('curr_tier')}，名次退步+{item.get('rank_drop')}"])
    for item in lists.get('mentor_list') or []:
        ws3.append(['导师制名单', _safe_excel_cell(item['name']), item.get('total'), item.get('rank'), '薄弱科：' + ('、'.join(item.get('weak') or []) or '—')])

    # Styling all 3 sheets uniformly
    for ws, cols in ((ws1, cols1), (ws2, cols2), (ws3, cols3)):
        last = get_column_letter(len(cols))
        ws.merge_cells(f'A1:{last}1')
        ws.merge_cells(f'A2:{last}2')
        ws['A1'].font = Font(name='Microsoft YaHei', size=15, bold=True, color='684792')
        ws['A2'].font = Font(name='Microsoft YaHei', size=10, color='73647F')
        ws.row_dimensions[1].height = 28
        ws.row_dimensions[4].height = 26
        for cell in ws[4]:
            cell.fill = PatternFill('solid', fgColor='EEE7F8')
            cell.font = Font(name='Microsoft YaHei', size=10, bold=True, color='493559')
            cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        for row in ws.iter_rows(min_row=5):
            for cell in row:
                cell.font = Font(name='Microsoft YaHei', size=10, color='302A40')
                cell.alignment = Alignment(vertical='center')
                if isinstance(cell.value, float):
                    cell.number_format = '0.##'
            if row[0].row % 2 == 0:
                for cell in row:
                    cell.fill = PatternFill('solid', fgColor='FAF8FD')
        for idx, col in enumerate(cols, 1):
            ws.column_dimensions[get_column_letter(idx)].width = min(38, max(10, len(str(col)) * 1.9 + 3))
        ws.freeze_panes = 'B5'
        ws.page_setup.orientation = 'landscape'
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _class_print_html(analysis: dict, brief: dict) -> str:
    """Create a standalone printable A4 HTML class-brief sheet for headteachers."""
    esc = html.escape
    meta = brief['meta']
    hl = brief['headline']
    points = hl.get('talking_points') or []
    subs = brief.get('subject_diagnosis') or []
    lists = brief.get('action_lists') or {}
    grade_mean = (analysis.get('summary') or {}).get('mean')

    def _fmt(v, d=1):
        if v is None:
            return '—'
        if isinstance(v, float):
            return f'{v:.{d}f}'.rstrip('0').rstrip('.') if d > 0 else f'{v:.0f}'
        return str(v)

    points_html = ''.join(f'<li>{esc(p)}</li>' for p in points) or '<li>暂无异常波动提示。</li>'
    sub_rows = ''.join(
        f"<tr><td><b>{esc(r['subject'])}</b></td><td>{esc(r.get('teacher') or '—')}</td>"
        f"<td class='num'>{_fmt(r.get('mean'))}</td><td class='num'>{_fmt(r.get('grade_mean'))}</td>"
        f"<td class='num'>{_fmt((r.get('high') or {}).get('achievers'), 0)} / {_fmt((r.get('high') or {}).get('concentrated'), 0)}</td>"
        f"<td class='num'>{_fmt((r.get('main') or {}).get('achievers'), 0)} / {_fmt((r.get('main') or {}).get('concentrated'), 0)}</td>"
        f"<td>{esc(r.get('mismatch_label') or '均衡')}</td></tr>"
        for r in subs
    )
    bh_rows = ''.join(
        f"<tr><td>{esc(s['name'])}</td><td class='num'>{_fmt(s.get('total'))}</td><td class='num'>{_fmt(s.get('rank'), 0)}</td>"
        f"<td class='num'>-{_fmt(s.get('score_gap'))}</td>"
        f"<td>{esc('、'.join(m['subject'] for m in (s.get('missing_subjects') or [])) or '各科达线')}</td></tr>"
        for s in (lists.get('borderline_high') or [])[:12]
    ) or '<tr><td colspan="5" class="muted">暂无</td></tr>'
    bm_rows = ''.join(
        f"<tr><td>{esc(s['name'])}</td><td class='num'>{_fmt(s.get('total'))}</td><td class='num'>{_fmt(s.get('rank'), 0)}</td>"
        f"<td class='num'>-{_fmt(s.get('score_gap'))}</td>"
        f"<td>{esc('、'.join(m['subject'] for m in (s.get('missing_subjects') or [])) or '各科达线')}</td></tr>"
        for s in (lists.get('borderline_main') or [])[:12]
    ) or '<tr><td colspan="5" class="muted">暂无</td></tr>'

    return f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{esc(meta['grade'])} {esc(meta['class'])}班 · 班情分析单（{esc(meta['exam_name'])}）</title>
<style>
  @page {{ size: A4 portrait; margin: 12mm; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font-family: "PingFang SC","Microsoft YaHei",sans-serif; color: #221d2d; background: #fff; font-size: 12px; line-height: 1.5; }}
  .wrap {{ max-width: 780px; margin: 0 auto; padding: 14px; }}
  .bar {{ display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #6f4eb8; padding-bottom: 8px; margin-bottom: 12px; }}
  h1 {{ margin: 0; font-size: 18px; color: #221d2d; }}
  .meta {{ color: #665d75; font-size: 11.5px; }}
  .kpis {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }}
  .kpi {{ border: 1px solid #d9d0e8; border-radius: 6px; padding: 8px 10px; background: #faf8fd; }}
  .kpi small {{ display: block; color: #665d75; font-size: 11px; }}
  .kpi strong {{ font-size: 18px; color: #4f358c; }}
  h2 {{ font-size: 13.5px; margin: 12px 0 6px; color: #4f358c; border-left: 3px solid #6f4eb8; padding-left: 7px; }}
  ul {{ margin: 4px 0 10px; padding-left: 18px; }}
  table {{ width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11.5px; }}
  th, td {{ border: 1px solid #d9d0e8; padding: 5px 7px; text-align: left; }}
  th {{ background: #f2ecf9; color: #3d2c63; font-weight: 600; }}
  .num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .two {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }}
  .muted {{ color: #7a708c; text-align: center; }}
  .print-btn {{ position: fixed; top: 12px; right: 16px; background: #6f4eb8; color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12.5px; cursor: pointer; }}
  @media print {{ .print-btn {{ display: none; }} .wrap {{ padding: 0; max-width: none; }} }}
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">打印本页</button>
<div class="wrap">
  <div class="bar">
    <h1>{esc(meta['grade'])} · {esc(meta['class'])}班 班情分析单</h1>
    <div class="meta">{esc(meta['exam_name'])}（{esc(meta['exam_date'])}） · 班主任：{esc(meta.get('homeroom') or '—')}</div>
  </div>
  <div class="kpis">
    <div class="kpi"><small>有效参评人数</small><strong>{_fmt(hl.get('participants'), 0)} 人</strong></div>
    <div class="kpi"><small>{esc(hl['high']['label'])}达标</small><strong>{_fmt(hl['high']['count'], 0)} 人（{_fmt(hl['high']['rate'])}%）</strong></div>
    <div class="kpi"><small>{esc(hl['main']['label'])}达标</small><strong>{_fmt(hl['main']['count'], 0)} 人（{_fmt(hl['main']['rate'])}%）</strong></div>
    <div class="kpi"><small>总分均分（年级 {_fmt(grade_mean)}）</small><strong>{_fmt(hl.get('mean'))} 分</strong></div>
  </div>
  <h2>一、核心诊断要点</h2>
  <ul>{points_html}</ul>
  <h2>二、本班学科达标与集中情况</h2>
  <table>
    <thead><tr><th>学科</th><th>任课教师</th><th class="num">本班均分</th><th class="num">年级均分</th><th class="num">{esc(hl['high']['label'])}达标/集中</th><th class="num">{esc(hl['main']['label'])}达标/集中</th><th>诊断</th></tr></thead>
    <tbody>{sub_rows}</tbody>
  </table>
  <div class="two">
    <div>
      <h2>三、冲{esc(hl['high']['label'])}临界名单</h2>
      <table><thead><tr><th>姓名</th><th class="num">总分</th><th class="num">名次</th><th class="num">分差</th><th>待补学科</th></tr></thead><tbody>{bh_rows}</tbody></table>
    </div>
    <div>
      <h2>四、冲{esc(hl['main']['label'])}临界名单</h2>
      <table><thead><tr><th>姓名</th><th class="num">总分</th><th class="num">名次</th><th class="num">分差</th><th>待补学科</th></tr></thead><tbody>{bm_rows}</tbody></table>
    </div>
  </div>
  <p class="meta" style="margin-top:8px">融侨学迹 · 班主任专属分发版（仅含本班数据） · 数据版本 v{int(meta.get('data_version') or 1)} · {('含 ' + str(int(meta.get('edit_count') or 0)) + ' 处更正') if int(meta.get('edit_count') or 0) > 0 else '原始导入'}</p>
</div>
</body>
</html>'''


def build_class_packages_zip(
    grade_exams: list[tuple[dict, dict, dict]],
    exam_id: str,
    *,
    high_ratio: float | None = None,
    main_ratio: float | None = None,
    class_names: list[str] | None = None,
) -> tuple[str, bytes]:
    """Build a ZIP archive with 1 isolated folder per class for safe distribution to headteachers."""
    target = next(((info, ana) for info, ana, _ in grade_exams if info['id'] == exam_id), None)
    if target is None:
        raise ValueError('当前考试已归档或不属于所选年级。')
    target_info, target_analysis = target
    classes = list(target_analysis['classes'])
    if class_names:
        wanted = set(class_names)
        classes = [c for c in classes if c in wanted]
    if not classes:
        raise ValueError('没有选择可导出的班级。')

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        readme = (
            f"融侨学迹 · 各班班主任分级安全分发包\n"
            f"考试：{target_info['grade']} · {target_info['name']}（{target_info['date']}）\n"
            f"包含班级：共 {len(classes)} 个班（{', '.join(c + '班' for c in classes)}）\n\n"
            f"使用说明：\n"
            f"1. 每个文件夹仅包含对应班级的学生成绩、ABC 等级表与班情诊断，不包含任何其他班级的学生名单，可直接点对点发给对应班主任。\n"
            f"2. 「ABC等级表(按姓氏).xlsx」不含原始分数与名次，按学生姓氏拼音排序，可直接发给科任老师或用于教学留档。\n"
            f"3. HTML 文件用任意浏览器双击打开即可直接 A4 打印。\n"
        )
        zf.writestr('分发说明.txt', readme.encode('utf-8'))
        for cls in classes:
            brief = build_class_brief(grade_exams, exam_id, cls, high_ratio=high_ratio, main_ratio=main_ratio)
            folder = f'{cls}班'
            xlsx_bytes = _class_excel_bytes(target_analysis, brief, cls)
            _, abc_bytes = build_class_abc_workbook(
                target_analysis,
                mode='six',
                class_name=cls,
                teachers_map={cls: {'homeroom': brief['meta'].get('homeroom') or ''}},
            )
            html_text = _class_print_html(target_analysis, brief)
            zf.writestr(f'{folder}/{cls}班_成绩与学科诊断.xlsx', xlsx_bytes)
            zf.writestr(f'{folder}/{cls}班_ABC等级表(按姓氏).xlsx', abc_bytes)
            zf.writestr(f'{folder}/{cls}班_班情分析打印版.html', html_text.encode('utf-8'))

    safe_exam = re.sub(r'[\\/:*?"<>|]', '_', f"{target_info['grade']}_{target_info['name']}")
    return f'{safe_exam}_各班分发包.zip', buf.getvalue()


def _extract_tier_labels(analysis: dict, mode: str) -> list[str]:
    rules = analysis.get('rules') or {}
    key = 'abc_bounds' if mode == 'abc' else 'level_bounds'
    default = ['A', 'B', 'C'] if mode == 'abc' else ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
    raw = rules.get(key) or []
    labels = []
    for item in raw:
        if isinstance(item, dict) and item.get('label'):
            labels.append(str(item['label']))
        elif isinstance(item, (list, tuple)) and item:
            labels.append(str(item[0]))
    return labels or default


def _grade_cell_style(label: str):
    """Return (fill_hex, font_hex, bold) for an A/B/C or A1-C2 grade cell."""
    up = str(label or '').strip().upper()
    if up.startswith('A'):
        return ('EAF5EE', '225B43', True)
    if up.startswith('B'):
        return ('F2EEFA', '493559', False)
    if up.startswith('C'):
        return ('FDF2E9', '9A4D16', False)
    return ('F8F7FA', '8C849E', False)


def _populate_class_abc_sheet(ws, analysis: dict, cls: str, *, mode: str = 'six', homeroom: str = '') -> None:
    """Populate a single worksheet with a class's desensitized ABC/6-level table sorted by Chinese surname."""
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    meta = analysis.get('metadata') or {}
    subjects = list(analysis.get('subjects') or [])
    grade_key = 'grades' if mode == 'abc' else 'levels'
    mode_label = '三级（A / B / C）' if mode == 'abc' else '六级（A1 / A2 / B1 / B2 / C1 / C2）'
    tier_labels = _extract_tier_labels(analysis, mode)

    cls_students = sorted(
        [s for s in analysis.get('students') or [] if s.get('class') == cls],
        key=lambda s: surname_sort_key(s.get('name', '')),
    )

    ws.sheet_view.showGridLines = False
    ws.append([f"{meta.get('grade', '')} · {meta.get('name', '')} · {cls}班 学生等级表（按姓氏排序）"])
    ver = int(meta.get('data_version') or 1)
    ec = int(meta.get('edit_count') or 0)
    version_tag = f'数据版本 v{ver} · 含 {ec} 处更正' if ec > 0 else f'数据版本 v{ver} · 原始导入'
    sub_parts = [
        f"考试日期：{meta.get('date', '')}",
        f"班主任：{homeroom}" if homeroom else '',
        f"人数：{len(cls_students)}人",
        f"等级口径：{mode_label}",
        '按姓氏拼音排序',
        version_tag,
    ]
    ws.append([' · '.join(p for p in sub_parts if p)])
    ws.append([])

    headers = ['序号', '姓名', '总评', *subjects]
    ws.append(headers)

    col_counts: list[dict[str, int]] = [{} for _ in range(1 + len(subjects))]
    col_valid: list[int] = [0 for _ in range(1 + len(subjects))]

    for idx, s in enumerate(cls_students, 1):
        gmap = s.get(grade_key) or {}
        total_g = str(gmap.get('总分') or '').strip()
        sub_gs = [str(gmap.get(sub) or '').strip() for sub in subjects]
        ws.append([idx, _safe_excel_cell(s.get('name', '')), total_g or '—', *[g or '—' for g in sub_gs]])
        for ci, val in enumerate([total_g, *sub_gs]):
            if val:
                col_counts[ci][val] = col_counts[ci].get(val, 0) + 1
                col_valid[ci] += 1

    data_end_row = 4 + len(cls_students)

    # Bottom summary rows: each tier count + A档率
    ws.append([])
    summary_start = ws.max_row + 1
    for tier in tier_labels:
        ws.append(['', f'{tier} 人数', *[col_counts[ci].get(tier, 0) for ci in range(1 + len(subjects))]])
    a_rates = []
    for ci in range(1 + len(subjects)):
        denom = col_valid[ci]
        a_cnt = sum(cnt for k, cnt in col_counts[ci].items() if str(k).upper().startswith('A'))
        a_rates.append(f'{(100.0 * a_cnt / denom):.1f}%' if denom else '—')
    ws.append(['', 'A档占比', *a_rates])
    summary_end = ws.max_row

    # Styling
    thin = Side(style='thin', color='DCD6E8')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    last_col = get_column_letter(len(headers))
    ws.merge_cells(f'A1:{last_col}1')
    ws.merge_cells(f'A2:{last_col}2')
    ws['A1'].font = Font(name='Microsoft YaHei', size=14, bold=True, color='4F358C')
    ws['A1'].alignment = Alignment(horizontal='left', vertical='center')
    ws['A2'].font = Font(name='Microsoft YaHei', size=9.5, color='6D6380')
    ws['A2'].alignment = Alignment(horizontal='left', vertical='center')
    ws.row_dimensions[1].height = 24
    ws.row_dimensions[2].height = 18
    ws.row_dimensions[3].height = 6
    ws.row_dimensions[4].height = 23

    for cell in ws[4]:
        cell.fill = PatternFill('solid', fgColor='EDE7F8')
        cell.font = Font(name='Microsoft YaHei', size=10, bold=True, color='3F2B6B')
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = border

    row_height = 17.5 if len(cls_students) > 48 else 19.5
    for r_idx in range(5, data_end_row + 1):
        ws.row_dimensions[r_idx].height = row_height
        zebra = r_idx % 2 == 0
        for c_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=r_idx, column=c_idx)
            cell.border = border
            if c_idx == 1:
                cell.font = Font(name='Microsoft YaHei', size=9.5, color='6D6380')
                cell.alignment = Alignment(horizontal='center', vertical='center')
                if zebra:
                    cell.fill = PatternFill('solid', fgColor='FAF8FD')
            elif c_idx == 2:
                cell.font = Font(name='Microsoft YaHei', size=10, bold=True, color='231E33')
                cell.alignment = Alignment(horizontal='center', vertical='center')
                if zebra:
                    cell.fill = PatternFill('solid', fgColor='FAF8FD')
            else:
                bg, fg, is_bold = _grade_cell_style(cell.value)
                cell.fill = PatternFill('solid', fgColor=bg)
                cell.font = Font(name='Microsoft YaHei', size=9.5, bold=(is_bold or c_idx == 3), color=fg)
                cell.alignment = Alignment(horizontal='center', vertical='center')

    for r_idx in range(summary_start, summary_end + 1):
        ws.row_dimensions[r_idx].height = 18.5
        is_rate_row = r_idx == summary_end
        for c_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=r_idx, column=c_idx)
            cell.border = border
            cell.fill = PatternFill('solid', fgColor='EDE7F8' if is_rate_row else 'F8F6FC')
            cell.font = Font(
                name='Microsoft YaHei',
                size=9.5,
                bold=(is_rate_row or c_idx == 2),
                color='3F2B6B' if is_rate_row else '493559',
            )
            cell.alignment = Alignment(horizontal='center', vertical='center')

    ws.column_dimensions['A'].width = 6.5
    ws.column_dimensions['B'].width = 11.5
    ws.column_dimensions['C'].width = 9.0
    for idx in range(4, len(headers) + 1):
        sub_name = str(headers[idx - 1])
        ws.column_dimensions[get_column_letter(idx)].width = max(8.2, min(12, len(sub_name) * 2.2 + 3.6))

    ws.freeze_panes = 'C5'
    ws.print_title_rows = '1:4'
    ws.print_options.horizontalCentered = True
    ws.page_setup.orientation = 'portrait'
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = 0.35
    ws.page_margins.right = 0.35
    ws.page_margins.top = 0.4
    ws.page_margins.bottom = 0.4
    ws.oddFooter.left.text = version_tag


def build_class_abc_workbook(
    analysis: dict,
    *,
    mode: str = 'six',
    class_name: str = '',
    teachers_map: dict | None = None,
) -> tuple[str, bytes]:
    """Export per-class ABC (or A1-C2) grade tables sorted by Chinese surname Pinyin (zero scores/ranks)."""
    from openpyxl import Workbook

    norm_mode = 'abc' if str(mode or '').lower() == 'abc' else 'six'
    classes = list(analysis.get('classes') or [])
    if class_name:
        if class_name not in classes:
            raise ValueError(f'当前考试中未找到 {class_name} 班。')
        classes = [class_name]
    if not classes:
        raise ValueError('当前考试没有可导出的班级。')

    wb = Workbook()
    wb.remove(wb.active)
    used_names: set[str] = set()
    tmap = teachers_map or {}

    for cls in classes:
        base_title = re.sub(r'[\\/*?:\[\]]', '-', f'{cls}班')[:28] or '班级'
        sheet_title = base_title
        n = 1
        while sheet_title in used_names:
            n += 1
            sheet_title = f'{base_title[:25]}_{n}'
        used_names.add(sheet_title)
        ws = wb.create_sheet(sheet_title)
        hr = str((tmap.get(cls) or {}).get('homeroom') or '')
        _populate_class_abc_sheet(ws, analysis, cls, mode=norm_mode, homeroom=hr)

    buf = io.BytesIO()
    wb.save(buf)
    meta = analysis.get('metadata') or {}
    mode_tag = 'ABC等级表' if norm_mode == 'abc' else 'A1-C2等级表'
    scope_tag = f'{class_name}班' if class_name else '各班'
    safe_prefix = re.sub(r'[\\/:*?"<>|]', '_', f"{meta.get('grade', '')}_{meta.get('name', '')}").strip('_') or '成绩'
    filename = f'{safe_prefix}_{scope_tag}{mode_tag}(按姓氏).xlsx'
    return filename, buf.getvalue()


def build_class_abc_zip(
    analysis: dict,
    *,
    mode: str = 'six',
    teachers_map: dict | None = None,
) -> tuple[str, bytes]:
    """Export 1 isolated ABC (or A1-C2) Excel file per class in a ZIP bundle (sorted by surname, zero scores/ranks)."""
    norm_mode = 'abc' if str(mode or '').lower() == 'abc' else 'six'
    classes = list(analysis.get('classes') or [])
    if not classes:
        raise ValueError('当前考试没有可导出的班级。')
    meta = analysis.get('metadata') or {}
    mode_tag = 'ABC等级表' if norm_mode == 'abc' else 'A1-C2等级表'
    tmap = teachers_map or {}

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        readme = (
            f"融侨学迹 · 各班学生{mode_tag}（按姓氏排序）\n"
            f"考试：{meta.get('grade', '')} · {meta.get('name', '')}（{meta.get('date', '')}）\n"
            f"包含班级：共 {len(classes)} 个班（{', '.join(c + '班' for c in classes)}）\n\n"
            f"说明：\n"
            f"1. 每个 Excel 文件仅包含对应班级的学生，按学生姓氏拼音（A–Z）排序。\n"
            f"2. 已自动排版为 A4 竖版一页纸，可直接打印或发给对应班主任与科任教师。\n"
        )
        zf.writestr('使用说明.txt', readme.encode('utf-8'))
        for cls in classes:
            _, xlsx_bytes = build_class_abc_workbook(analysis, mode=norm_mode, class_name=cls, teachers_map=tmap)
            zf.writestr(f'{cls}班_{mode_tag}(按姓氏).xlsx', xlsx_bytes)

    safe_prefix = re.sub(r'[\\/:*?"<>|]', '_', f"{meta.get('grade', '')}_{meta.get('name', '')}").strip('_') or '成绩'
    return f'{safe_prefix}_各班{mode_tag}(按姓氏分班包).zip', buf.getvalue()


def _svg_radar_standalone(subjects: list[dict]) -> str:
    valid = [s for s in (subjects or []) if s.get('pr') is not None]
    if len(valid) < 3:
        return '<div class="sc-chart-empty">有效学科不足 3 科，暂不绘制雷达图</div>'
    size, cx, cy, r_max = 196, 98.0, 98.0, 66.0
    count = len(valid)

    def polar(idx: int, ratio: float) -> tuple[float, float]:
        ang = -math.pi / 2 + (idx * 2 * math.pi) / count
        return cx + math.cos(ang) * r_max * ratio, cy + math.sin(ang) * r_max * ratio

    rings = []
    for ratio in (0.25, 0.5, 0.75, 1.0):
        pts = ' '.join(f'{x:.1f},{y:.1f}' for x, y in (polar(i, ratio) for i in range(count)))
        sw = '1.1' if ratio == 1.0 else '0.75'
        dash = '3 2' if ratio == 0.5 else 'none'
        rings.append(f'<polygon points="{pts}" fill="none" stroke="#d8d1e6" stroke-width="{sw}" stroke-dasharray="{dash}"/>')

    spokes = []
    for i, s in enumerate(valid):
        x2, y2 = polar(i, 1.0)
        lx, ly = polar(i, 1.24)
        anchor = 'middle' if abs(lx - cx) < 8 else ('start' if lx > cx else 'end')
        spokes.append(
            f'<line x1="{cx:.1f}" y1="{cy:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#e3ddef" stroke-width="0.8"/>'
            f'<text x="{lx:.1f}" y="{ly + 3.5:.1f}" text-anchor="{anchor}" font-size="9.5" fill="#3b3250" font-weight="600">{html.escape(str(s["subject"]))}</text>'
        )

    data_pts = [polar(i, max(0.08, min(1.0, float(s['pr']) / 100.0))) for i, s in enumerate(valid)]
    poly_pts = ' '.join(f'{x:.1f},{y:.1f}' for x, y in data_pts)
    poly = f'<polygon points="{poly_pts}" fill="rgba(111,78,184,0.20)" stroke="#6f4eb8" stroke-width="1.8"/>'
    dots = ''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.6" fill="#6f4eb8"/>' for x, y in data_pts)
    return f'<svg class="sc-radar" viewBox="0 0 {size} {size}" role="img" aria-label="学科均衡雷达图">{"".join(rings)}{"".join(spokes)}{poly}{dots}</svg>'


def _svg_history_standalone(history: list[dict]) -> str:
    valid = [h for h in (history or []) if h.get('pr') is not None]
    if len(valid) < 2:
        return '<div class="sc-chart-empty">导入同年级多场考试后，此处自动绘制个人成长曲线</div>'
    w, h, pl, pr, top, bot = 228.0, 112.0, 28.0, 16.0, 20.0, 84.0
    vals = [float(x['pr']) for x in valid]
    lo = max(0, int(math.floor((min(vals) - 10) / 10.0) * 10))
    hi = min(100, int(math.ceil((max(vals) + 10) / 10.0) * 10))
    span = max(hi - lo, 20)

    def x_for(i: int) -> float:
        return pl + (i * (w - pl - pr)) / (len(valid) - 1)

    def y_for(v: float) -> float:
        return bot - ((v - lo) / span) * (bot - top)

    pts = [(x_for(i), y_for(v)) for i, v in enumerate(vals)]
    ticks = []
    for v in (lo, round((lo + hi) / 2), hi):
        y = y_for(v)
        ticks.append(
            f'<line x1="{pl:.1f}" y1="{y:.1f}" x2="{w - pr:.1f}" y2="{y:.1f}" stroke="#e6e1f0" stroke-width="0.8"/>'
            f'<text x="{pl - 4:.1f}" y="{y + 3:.1f}" text-anchor="end" font-size="8.5" fill="#776d8c">{v}</text>'
        )
    labels = []
    for i, (x, y) in enumerate(pts):
        lbl = str(valid[i].get('date') or valid[i].get('exam_name') or '')[-5:]
        labels.append(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="#fff" stroke="#6f4eb8" stroke-width="1.8"/>'
            f'<text x="{x:.1f}" y="{y - 6:.1f}" text-anchor="middle" font-size="8.5" fill="#4f358c" font-weight="650">{vals[i]:.0f}</text>'
            f'<text x="{x:.1f}" y="{h - 8:.1f}" text-anchor="middle" font-size="8" fill="#6f6680">{html.escape(lbl)}</text>'
        )
    poly_pts = ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
    return (
        f'<svg class="sc-spark" viewBox="0 0 {int(w)} {int(h)}" role="img" aria-label="个人年级百分位成长走势">'
        f'{"".join(ticks)}<polyline fill="none" stroke="#6f4eb8" stroke-width="2" points="{poly_pts}"/>{"".join(labels)}</svg>'
    )


def _render_standalone_student_card_html(
    card: dict,
    meta: dict,
    *,
    hide_rank: bool = True,
    hide_score: bool = False,
) -> str:
    """Render a self-contained single-student A4 HTML report with ZERO other-student data."""
    esc = html.escape
    ver = int(meta.get('data_version') or 1)
    ec = int(meta.get('edit_count') or 0)
    ver_tag = f'数据版本 v{ver} · 含 {ec} 处更正' if ec > 0 else f'数据版本 v{ver} · 原始导入'
    mode_tag = '仅等级与相对强弱（零分零名次）' if hide_score else ('仅含本人成绩（已隐藏名次）' if hide_rank else '仅含本人成绩（隐私保护版）')

    sub_rows = []
    for s in card.get('subjects') or []:
        pr_val = max(0.0, min(100.0, float(s['pr']))) if s.get('pr') is not None else None
        lvl = s['level'] if s.get('level') and s['level'] != '—' else (s.get('grade') or '—')
        pr_cell = (
            '—'
            if pr_val is None
            else f'<span class="pr-bar"><i style="width:{pr_val:.1f}%"></i></span><span class="pr-num">{pr_val:.0f}%</span>'
        )
        if hide_score:
            pos_label = '—'
            pos_cls = ''
            if pr_val is not None:
                if pr_val >= 80:
                    pos_label, pos_cls = '明显优势', 'pos'
                elif pr_val >= 55:
                    pos_label, pos_cls = '稳健良好', 'pos'
                elif pr_val >= 35:
                    pos_label, pos_cls = '中段可提', ''
                else:
                    pos_label, pos_cls = '优先夯基', 'neg'
            sub_rows.append(
                f'<tr><td class="sub-name">{esc(str(s["subject"]))}</td>'
                f'<td class="center"><span class="lvl-pill">{esc(str(lvl))}</span></td>'
                f'<td class="pr-cell">{pr_cell}</td>'
                f'<td class="center {pos_cls}">{pos_label}</td></tr>'
            )
        else:
            sc_html = '缺' if s.get('score') is None else f'<b>{float(s["score"]):.1f}</b>'
            if s.get('score') is not None and s.get('full_mark'):
                sc_html += f'<small>/{float(s["full_mark"]):.0f}</small>'
            diff = s.get('mean_diff')
            diff_txt = '—' if diff is None else f'{diff:+.1f}'
            diff_cls = '' if diff is None else ('pos' if diff >= 0 else 'neg')
            sub_rows.append(
                f'<tr><td class="sub-name">{esc(str(s["subject"]))}</td>'
                f'<td class="num">{sc_html}</td>'
                f'<td class="center"><span class="lvl-pill">{esc(str(lvl))}</span></td>'
                f'<td class="pr-cell">{pr_cell}</td>'
                f'<td class="num {diff_cls}">{diff_txt}</td></tr>'
            )

    adv = card.get('advice') or {}
    total_lvl = card['total_level'] if card.get('total_level') and card['total_level'] != '—' else (card.get('total_grade') or '—')
    pr_text = '—' if card.get('pr') is None else f'超越 {float(card["pr"]):.1f}%'
    if hide_score:
        kpi_first = f'<div class="sc-kpi"><small>学业等级</small><strong>{esc(str(total_lvl))}</strong></div>'
        kpi_second = f'<div class="sc-kpi"><small>参评学科</small><strong>{len(card.get("subjects") or [])}<em>科</em></strong></div>'
    else:
        tot_val = '—' if card.get('total') is None else f'{float(card["total"]):.1f}'
        tot_sfx = f'<em>/{float(card["full_total"]):.0f}</em>' if card.get('full_total') else '<em>分</em>'
        kpi_first = f'<div class="sc-kpi"><small>总分</small><strong>{tot_val}{tot_sfx}</strong></div>'
        kpi_second = f'<div class="sc-kpi"><small>学业等级</small><strong>{esc(str(total_lvl))}</strong></div>'

    if hide_rank or hide_score:
        t_txt = '—' if card.get('t_score') is None else f'{float(card["t_score"]):.1f}'
        kpi_fourth = f'<div class="sc-kpi"><small>标准分（T分）</small><strong>{t_txt}</strong></div>'
    else:
        rk = '—' if card.get('rank') is None else f'{int(card["rank"])} / {int(card.get("participants") or 0)}'
        kpi_fourth = f'<div class="sc-kpi"><small>年级参考位次</small><strong>{rk}</strong></div>'

    thead = (
        '<tr><th>学科</th><th class="center">等级</th><th>学科年级百分位</th><th class="center">强弱定位</th></tr>'
        if hide_score
        else '<tr><th>学科</th><th class="num">得分</th><th class="center">等级</th><th>学科年级百分位</th><th class="num">较年级均分</th></tr>'
    )

    title_text = f'{meta.get("grade", "")} {card.get("class", "")}班 · {card.get("name", "")} · 个人学业诊断卡'
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title_text)}</title>
<style>
  @page {{ size: A4 portrait; margin: 10mm 11mm; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font-family: "PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif; color: #221c2e; background: #edeaf4; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  .bar {{ position: sticky; top: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: #2f3068; color: #fff; font-size: 13px; }}
  .bar button {{ background: #6f4eb8; color: #fff; border: 0; border-radius: 6px; padding: 6px 14px; font-weight: 600; cursor: pointer; }}
  .wrap {{ padding: 18px 12px 32px; display: flex; justify-content: center; }}
  .card {{ width: 190mm; max-width: 100%; min-height: 268mm; background: #fff; border: 1px solid #d5cee6; border-radius: 8px; padding: 16px 18px; box-shadow: 0 8px 28px rgba(34,24,60,.14); display: flex; flex-direction: column; gap: 12px; }}
  .sc-header {{ display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 2px solid #6f4eb8; padding-bottom: 8px; flex-wrap: wrap; }}
  .sc-school {{ font-size: 10px; color: #6f4eb8; font-weight: 650; letter-spacing: .04em; }}
  .sc-header h1 {{ margin: 2px 0 0; font-size: 20px; color: #1e182a; }}
  .sc-cls {{ font-size: 12px; font-weight: 500; color: #5b5170; margin-left: 8px; }}
  .sc-exam-meta {{ text-align: right; }}
  .sc-exam-meta strong {{ display: block; font-size: 13px; color: #2b233a; }}
  .sc-exam-meta span {{ font-size: 10px; color: #716784; }}
  .sc-kpis {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }}
  .sc-kpi {{ border: 1px solid #dfd8ed; border-radius: 6px; padding: 7px 10px; background: #faf8fd; }}
  .sc-kpi.accent {{ background: #f2ecfa; border-color: #c5b4e3; }}
  .sc-kpi small {{ display: block; font-size: 10px; color: #6a607c; }}
  .sc-kpi strong {{ display: block; font-size: 16px; color: #2a213d; font-variant-numeric: tabular-nums; margin-top: 2px; }}
  .sc-kpi strong em {{ font-style: normal; font-size: 10.5px; font-weight: 500; color: #6f6482; margin-left: 2px; }}
  .sc-body {{ display: grid; grid-template-columns: 1.3fr 0.95fr; gap: 12px; align-items: start; flex: 1; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 11.5px; }}
  th, td {{ border: 1px solid #dfd9eb; padding: 6px 8px; text-align: left; }}
  th {{ background: #f3eefb; color: #3c2b63; font-weight: 650; }}
  .num {{ text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }}
  .center {{ text-align: center; }}
  .sub-name {{ font-weight: 600; color: #2a223b; }}
  td small {{ color: #7c7290; font-size: 10px; }}
  .lvl-pill {{ display: inline-block; padding: 1px 6px; border-radius: 3px; background: #f0eaf9; color: #4f358c; font-weight: 650; font-size: 10.5px; }}
  .pr-cell {{ white-space: nowrap; }}
  .pr-bar {{ display: inline-block; width: 48px; height: 6px; background: #ebe6f4; border-radius: 3px; vertical-align: middle; overflow: hidden; margin-right: 5px; }}
  .pr-bar i {{ display: block; height: 100%; background: #6f4eb8; }}
  .pr-num {{ font-size: 10px; color: #544969; font-variant-numeric: tabular-nums; }}
  .pos {{ color: #24684c; font-weight: 600; }}
  .neg {{ color: #a83c3c; font-weight: 600; }}
  .sc-visual-col {{ display: flex; flex-direction: column; gap: 8px; }}
  .sc-chart-box {{ border: 1px solid #e4def0; border-radius: 6px; padding: 8px 10px; background: #fcfbfe; text-align: center; }}
  .sc-chart-title {{ display: flex; justify-content: space-between; align-items: baseline; font-size: 10.5px; font-weight: 650; color: #3f2f63; margin-bottom: 4px; text-align: left; }}
  .sc-chart-title span {{ font-size: 9px; font-weight: 400; color: #7e7491; }}
  .sc-radar {{ width: 100%; max-width: 205px; height: auto; display: block; margin: 0 auto; }}
  .sc-spark {{ width: 100%; max-width: 230px; height: auto; display: block; margin: 0 auto; }}
  .sc-chart-empty {{ padding: 16px 8px; color: #847a96; font-size: 10px; }}
  .sc-advice {{ border-left: 3px solid #6f4eb8; background: #faf8fd; border-radius: 0 6px 6px 0; padding: 10px 12px; font-size: 11.5px; }}
  .sc-advice p {{ margin: 3px 0; }}
  .sc-sign {{ display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px dashed #d1c8e2; padding-top: 10px; min-height: 54px; font-size: 11px; color: #5c526e; }}
  .sc-foot {{ display: flex; justify-content: space-between; font-size: 9.5px; color: #7c7290; border-top: 1px solid #ece7f4; padding-top: 6px; }}
  @media (max-width: 720px) {{
    .sc-kpis {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
    .sc-body {{ grid-template-columns: 1fr; }}
  }}
  @media print {{
    body {{ background: #fff; }}
    .bar {{ display: none; }}
    .wrap {{ padding: 0; }}
    .card {{ width: auto; min-height: 0; border: 0; box-shadow: none; padding: 0; }}
  }}
</style></head><body>
  <div class="bar">
    <span>{esc(title_text)}</span>
    <button type="button" onclick="window.print()">打印 / 存为 PDF</button>
  </div>
  <div class="wrap">
    <article class="card">
      <header class="sc-header">
        <div>
          <div class="sc-school">融侨学迹 · 学生个人学业诊断成长卡</div>
          <h1>{esc(str(card.get("name", "")))} <span class="sc-cls">{esc(str(meta.get("grade", "")))} {esc(str(card.get("class", "")))}班</span></h1>
        </div>
        <div class="sc-exam-meta">
          <strong>{esc(str(meta.get("exam_name", "")))}</strong>
          <span>{esc(str(meta.get("date", "")))} · {mode_tag}</span>
        </div>
      </header>
      <div class="sc-kpis">
        {kpi_first}
        {kpi_second}
        <div class="sc-kpi accent"><small>年级百分位（PR）</small><strong>{pr_text}</strong></div>
        {kpi_fourth}
      </div>
      <div class="sc-body">
        <div><table><thead>{thead}</thead><tbody>{"".join(sub_rows)}</tbody></table></div>
        <div class="sc-visual-col">
          <div class="sc-chart-box"><div class="sc-chart-title">学科均衡雷达图<span>按学科年级百分位绘制</span></div>{_svg_radar_standalone(card.get("subjects") or [])}</div>
          <div class="sc-chart-box"><div class="sc-chart-title">历次成长曲线<span>年级百分位（消除试卷难易波动）</span></div>{_svg_history_standalone(card.get("history") or [])}</div>
        </div>
      </div>
      <div class="sc-advice">
        <p><b>优势肯定：</b>{esc(str(adv.get("strength_text") or ""))}</p>
        <p><b>提分抓手：</b>{esc(str(adv.get("focus_text") or ""))}{(" " + esc(str(adv.get("trend_text")))) if adv.get("trend_text") else ""}</p>
      </div>
      <footer class="sc-sign">
        <span>学生反思 / 近期目标：</span>
        <span>家长签字：<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u> &nbsp;日期：<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span>
      </footer>
      <div class="sc-foot"><span>本文件仅含该生个人学业诊断，不含任何其他同学信息，离线可随时打开</span><span>{esc(ver_tag)} · 融侨学迹</span></div>
    </article>
  </div>
</body></html>'''


def build_student_cards_zip(
    grade_exams: list[tuple[dict, dict, dict]],
    exam_id: str,
    *,
    class_name: str = '',
    hide_rank: bool = True,
    hide_score: bool = False,
) -> tuple[str, bytes]:
    """Export one isolated offline HTML diagnostic card per student inside a ZIP bundle."""
    payload = build_student_cards(grade_exams, exam_id, class_name=class_name)
    meta = payload['meta']
    cards = sorted(payload['cards'], key=lambda c: (str(c.get('class') or ''), surname_sort_key(c.get('name') or '')))

    buf = io.BytesIO()
    used_paths: set[str] = set()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        mode_desc = '纯等级与相对强弱（隐藏分数与名次）' if hide_score else ('隐藏具体名次（含得分、等级与百分位）' if hide_rank else '含年级参考位次')
        readme = (
            f"融侨学迹 · 学生个人学业诊断卡（一人一档独立 HTML 包）\n"
            f"考试：{meta.get('grade', '')} · {meta.get('exam_name', '')}（{meta.get('date', '')}）\n"
            f"范围：{class_name + '班' if class_name else '全年级'} · 共 {len(cards)} 名学生\n"
            f"脱敏模式：{mode_desc}\n"
            f"数据版本：v{meta.get('data_version', 1)}"
            + (f"（含 {meta.get('edit_count', 0)} 处更正）\n\n" if meta.get('edit_count') else "（原始导入）\n\n")
            + "使用说明：\n"
            + "1. 每位学生对应一份独立 HTML 文件，不含其他任何同学的数据，可直接点对点微信发给家长或在电脑/手机浏览器打开。\n"
            + "2. 所有图表均已内嵌为矢量 SVG，完全离线可看、支持直接打印或存为 A4 PDF。\n"
        )
        zf.writestr('使用说明.txt', readme.encode('utf-8'))
        for card in cards:
            cls = str(card.get('class') or '未分班')
            safe_name = re.sub(r'[\\/:*?"<>|]', '_', str(card.get('name') or '学生')).strip('_') or '学生'
            base_path = f'{cls}班/{cls}班_{safe_name}_个人学业诊断卡.html'
            arc_path = base_path
            idx = 2
            while arc_path in used_paths:
                arc_path = f'{cls}班/{cls}班_{safe_name}_{idx}_个人学业诊断卡.html'
                idx += 1
            used_paths.add(arc_path)
            doc_html = _render_standalone_student_card_html(card, meta, hide_rank=hide_rank, hide_score=hide_score)
            zf.writestr(arc_path, doc_html.encode('utf-8'))

    safe_prefix = re.sub(r'[\\/:*?"<>|]', '_', f"{meta.get('grade', '')}_{meta.get('name', '')}").strip('_') or '成绩'
    scope_tag = f'{class_name}班' if class_name else '全年级'
    return f'{safe_prefix}_{scope_tag}_家长版个人诊断卡(一人一档).zip', buf.getvalue()
