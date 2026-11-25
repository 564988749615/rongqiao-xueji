"""Multi-exam history, composite ranking, scientific scales (PR / T-score) and student trajectories."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
import math


def _rounded(value: float, quant: str = '0.01') -> float:
    return float(Decimal(str(value)).quantize(Decimal(quant), rounding=ROUND_HALF_UP))


def calc_pr(rank: int | float | None, participants: int) -> float | None:
    """Grade percentile rank (0–100, higher is better): 100 for #1, 0 for last."""
    if rank is None or participants <= 0:
        return None
    if participants == 1:
        return 100.0
    raw = (1.0 - (float(rank) - 1.0) / (participants - 1.0)) * 100.0
    return _rounded(max(0.0, min(100.0, raw)), '0.1')


def calc_t_score(value: float | None, mean: float | None, std: float | None) -> float | None:
    """Standard T-score: 50 + 10 * (value - mean) / std. Grade mean = 50, SD = 10."""
    if value is None or mean is None:
        return None
    if std is None or std <= 1e-9:
        return 50.0
    return _rounded(50.0 + 10.0 * (float(value) - float(mean)) / float(std), '0.1')


def _mean_std(values: list[float]) -> tuple[float | None, float | None]:
    if not values:
        return None, None
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    return mean, math.sqrt(var)


def enrich_trends_scales(analysis: dict) -> list[dict]:
    """Return a copy of analysis['class_stats'] enriched with PR and T-score for total and each subject."""
    students = analysis.get('students') or []
    participants = int(analysis.get('summary', {}).get('participants') or 0)
    total_vals = [float(s['total']) for s in students if s.get('rank') is not None and s.get('total') is not None]
    grade_mean, grade_std = _mean_std(total_vals)

    # Subject grade mean, std, and participant count
    sub_meta: dict[str, tuple[float | None, float | None, int]] = {}
    for st in analysis.get('subject_stats') or []:
        sub = st['subject']
        vals = [float(s['scores'][sub]) for s in students if s.get('scores', {}).get(sub) is not None]
        m, sd = _mean_std(vals)
        sub_meta[sub] = (m, sd, int(st.get('count') or len(vals)))

    # Per-class PR accumulators
    class_total_prs: dict[str, list[float]] = {}
    class_sub_prs: dict[str, dict[str, list[float]]] = {}
    for s in students:
        cls = s['class']
        if s.get('rank') is not None and participants > 0:
            pr = calc_pr(s['rank'], participants)
            if pr is not None:
                class_total_prs.setdefault(cls, []).append(pr)
        for sub, (_, _, sub_cnt) in sub_meta.items():
            sr = (s.get('ranks') or {}).get(sub)
            if sr is not None and sub_cnt > 0:
                spr = calc_pr(sr, sub_cnt)
                if spr is not None:
                    class_sub_prs.setdefault(cls, {}).setdefault(sub, []).append(spr)

    enriched = []
    for c in analysis.get('class_stats') or []:
        cls = c['class']
        prs = class_total_prs.get(cls) or []
        cls_pr = _rounded(sum(prs) / len(prs), '0.1') if prs else None
        cls_t = calc_t_score(c.get('mean'), grade_mean, grade_std)
        new_subs = {}
        for sub, sq in (c.get('subjects') or {}).items():
            sm, ssd, _ = sub_meta.get(sub, (None, None, 0))
            sprs = (class_sub_prs.get(cls) or {}).get(sub) or []
            new_subs[sub] = {
                **sq,
                't_score': calc_t_score(sq.get('mean'), sm, ssd),
                'pr': _rounded(sum(sprs) / len(sprs), '0.1') if sprs else None,
            }
        enriched.append({
            **c,
            't_score': cls_t,
            'pr': cls_pr,
            'subjects': new_subs,
        })
    return enriched


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
        participants = int(result['summary']['participants'] or 0)
        total_vals = [float(s['total']) for s in result['students'] if s.get('rank') is not None and s.get('total') is not None]
        grade_mean, grade_std = _mean_std(total_vals)
        exams.append({k: info[k] for k in ('id', 'name', 'date')} | {'weight': weight, 'participants': participants})
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
                **{'class': s['class']}, rank=s['rank'], participants=participants,
                pr=calc_pr(s['rank'], participants),
                t_score=calc_t_score(s['total'], grade_mean, grade_std),
                weight=weight, total=s['total'], scores=s['scores'], weak=s['weak'],
                grades=s['grades'], levels=s['levels'],
            ))

    result_rows = []
    for record in students.values():
        values = [h['rank'] for h in record['history']]
        weights = [h['weight'] for h in record['history']]
        prs = [h['pr'] for h in record['history'] if h.get('pr') is not None]
        ts = [h['t_score'] for h in record['history'] if h.get('t_score') is not None]
        a = _rounded(sum(values) / len(values))
        t = _rounded((sum(values) - max(values) - min(values)) / (len(values) - 2)) if len(values) >= 3 else None
        w = _rounded(sum(x * y for x, y in zip(values, weights)) / sum(weights))
        components = [Decimal(str(x)) for x in (a, t, w) if x is not None]
        composite = float((sum(components) / Decimal(len(components))).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP))
        record.update(
            attempts=len(values), mean=a, trimmed=t, weighted=w, composite=composite,
            mean_pr=_rounded(sum(prs) / len(prs), '0.1') if prs else None,
            latest_pr=prs[-1] if prs else None,
            pr_delta=_rounded(prs[-1] - prs[0], '0.1') if len(prs) >= 2 else None,
            mean_t=_rounded(sum(ts) / len(ts), '0.1') if ts else None,
            latest_t=ts[-1] if ts else None,
            t_delta=_rounded(ts[-1] - ts[0], '0.1') if len(ts) >= 2 else None,
        )
        result_rows.append(record)

    ordered = sorted(r['composite'] for r in result_rows)
    rank_map = {}
    for i, value in enumerate(ordered, 1):
        rank_map.setdefault(value, i)
    for record in result_rows:
        record['rank'] = rank_map[record['composite']]
    result_rows.sort(key=lambda r: (r['rank'], r['class'], r['name']))

    # Automated cross-exam academic early warning alerts
    drop_thr = max(5, int(payload.get('alert_drop_threshold', 50) or 50))
    pr_drop_thr = max(1.0, float(payload.get('alert_pr_drop_threshold', 10.0) or 10.0))
    alerts = []
    for rec in result_rows:
        hist = rec.get('history') or []
        if len(hist) < 2:
            continue
        prev_h, last_h = hist[-2], hist[-1]
        first_h = hist[0]
        last_rank_drop = (last_h['rank'] - prev_h['rank']) if (last_h.get('rank') and prev_h.get('rank')) else 0
        first_rank_drop = (last_h['rank'] - first_h['rank']) if (last_h.get('rank') and first_h.get('rank')) else 0
        last_pr_drop = _rounded((prev_h['pr'] - last_h['pr']), '0.1') if (prev_h.get('pr') is not None and last_h.get('pr') is not None) else 0.0
        first_pr_drop = _rounded((first_h['pr'] - last_h['pr']), '0.1') if (first_h.get('pr') is not None and last_h.get('pr') is not None) else 0.0

        consec_drops = 0
        for i in range(len(hist) - 1, 0, -1):
            r_curr, r_prev = hist[i].get('rank'), hist[i - 1].get('rank')
            if r_curr is not None and r_prev is not None and r_curr > r_prev:
                consec_drops += 1
            else:
                break

        # Detect repeated weak subject across recent up to 3 exams
        weak_counts: dict[str, int] = {}
        for h_item in hist[-3:]:
            for w in (h_item.get('weak') or [])[:2]:
                sub_name = w.get('subject') if isinstance(w, dict) else str(w)
                if sub_name:
                    weak_counts[sub_name] = weak_counts.get(sub_name, 0) + 1
        repeated_weak = [sub for sub, cnt in sorted(weak_counts.items(), key=lambda kv: (-kv[1], kv[0])) if cnt >= 2]

        reasons = []
        level = None
        if last_rank_drop >= drop_thr or last_pr_drop >= pr_drop_thr:
            level = 'high'
            reasons.append(f'较上次退步 {last_rank_drop} 名（PR {(-last_pr_drop):+.1f}）')
        if consec_drops >= 2:
            if level != 'high' and first_rank_drop >= drop_thr:
                level = 'high'
            elif level is None:
                level = 'warn'
            reasons.append(f'连续 {consec_drops} 次下滑')
        if first_pr_drop >= 8.0 or first_rank_drop >= int(drop_thr * 1.4):
            if level is None:
                level = 'warn'
            reasons.append(f'较首考退步 {first_rank_drop} 名（PR {(-first_pr_drop):+.1f}）')
        if repeated_weak and level is not None:
            reasons.append(f'连续弱科：{"、".join(repeated_weak[:2])}')

        if level:
            alerts.append({
                'id': rec['id'],
                'name': rec['name'],
                'class': rec['class'],
                'level': level,
                'level_label': '红色预警' if level == 'high' else '黄色关注',
                'prev_rank': prev_h.get('rank'),
                'latest_rank': last_h.get('rank'),
                'last_rank_drop': last_rank_drop,
                'last_pr_drop': last_pr_drop,
                'first_pr_drop': first_pr_drop,
                'latest_pr': last_h.get('pr'),
                'consec_drops': consec_drops,
                'repeated_weak': repeated_weak[:2],
                'reasons': reasons,
                'reason_text': '；'.join(reasons),
            })

    alerts.sort(key=lambda x: (0 if x['level'] == 'high' else 1, -(x['last_rank_drop'] or 0), -(x['first_pr_drop'] or 0), x['class'], x['name']))
    alert_summary = {
        'total': len(alerts),
        'high_count': sum(1 for a in alerts if a['level'] == 'high'),
        'warn_count': sum(1 for a in alerts if a['level'] == 'warn'),
        'drop_threshold': drop_thr,
        'pr_drop_threshold': pr_drop_thr,
    }

    warnings = [
        '默认权重按考试先后取1、2、3…，可自行修改；这不是学校已确认的十次权重方案。',
        '年级百分位（PR，0–100，越高越好）与标准分（T分，年级均值为50、标准差为10）可消除试卷难易波动，更适合跨考试观察真实增值。',
    ]
    if anonymous:
        warnings.insert(0, f'{anonymous} 条记录没有姓名或学号，未纳入个人历史匹配；班级趋势仍可查看。')

    return dict(
        exams=exams,
        students=result_rows,
        warnings=warnings,
        selected_exam_ids=[item['id'] for item in exams],
        subject_trends=subject_trends,
        alerts=alerts,
        alert_summary=alert_summary,
    )
