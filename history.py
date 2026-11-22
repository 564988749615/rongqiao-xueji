"""Multi-exam history, composite ranking and student growth trajectories."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
import math


def _rounded(value: float, quant: str = '0.01') -> float:
    return float(Decimal(str(value)).quantize(Decimal(quant), rounding=ROUND_HALF_UP))


def calculate_history(saved_rows: list, payload: dict, analyze_fn, summary_fn) -> dict:
    requested_ids = payload.get('exam_ids')
    if requested_ids is not None:
        if not isinstance(requested_ids, list) or not requested_ids or not all(isinstance(item, str) and item for item in requested_ids):
            raise ValueError('考试选择必须是非空的考试编号列表。')
        requested_ids = list(dict.fromkeys(requested_ids))

    saved = list(saved_rows)
    if requested_ids is not None:
        saved_by_id = {r['id']: r for r in saved}
        missing = [exam_id for exam_id in requested_ids if exam_id not in saved_by_id]
        if missing:
            raise ValueError('选择的考试不属于当前年级或已被归档。')
        saved = [saved_by_id[exam_id] for exam_id in requested_ids]

    saved.sort(key=lambda r: (summary_fn(r).get('date', ''), r['created_at'], r['id']))

    requested = payload.get('weights', {})
    if not isinstance(requested, dict):
        raise ValueError('考试权重格式不正确。')

    exams, students, subject_trends = [], {}, []
    anonymous = 0

    for index, row in enumerate(saved):
        weight = float(requested.get(row['id'], index + 1))
        if not math.isfinite(weight) or weight <= 0 or weight > 1000:
            raise ValueError('考试权重必须大于0且不超过1000。')
        result = analyze_fn(row, include_tables=False)
        info = summary_fn(row)
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
            record = students.setdefault(s['id'], dict(id=s['id'], name=s['name'], **{'class': s['class']}, history=[]))
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
        a = _rounded(sum(values) / len(values))
        t = _rounded((sum(values) - max(values) - min(values)) / (len(values) - 2)) if len(values) >= 3 else None
        w = _rounded(sum(x * y for x, y in zip(values, weights)) / sum(weights))
        components = [Decimal(str(x)) for x in (a, t, w) if x is not None]
        composite = float((sum(components) / Decimal(len(components))).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP))
        record.update(attempts=len(values), mean=a, trimmed=t, weighted=w, composite=composite)
        result_rows.append(record)

    ordered = sorted(r['composite'] for r in result_rows)
    rank_map = {}
    for i, value in enumerate(ordered, 1):
        rank_map.setdefault(value, i)
    for record in result_rows:
        record['rank'] = rank_map[record['composite']]
    result_rows.sort(key=lambda r: (r['rank'], r['class'], r['name']))

    warnings = [
        '默认权重按考试先后取1、2、3…，可自行修改；这不是学校已确认的十次权重方案。',
        '班级与姓名匹配只能串联同班同名记录；跨班历史请提供稳定学号。不同试卷难度和参评人数会影响名次比较。',
    ]
    if anonymous:
        warnings.insert(0, f'{anonymous} 条记录没有姓名或学号，未纳入个人历史匹配；班级趋势仍可查看。')

    return dict(
        exams=exams,
        students=result_rows,
        warnings=warnings,
        selected_exam_ids=[item['id'] for item in exams],
        subject_trends=subject_trends,
    )
