"""20%/40% dual-line class situation analysis and printable templates for 融侨学迹."""
from __future__ import annotations

from collections import Counter
import math

from engine import cutoff as calc_cutoff, rank_position, rounded
from workbook import SUBJECT_ORDER, class_sort_key, normalize_class

TEMPLATE1_LEADER_TOP = [50, 100, 200, 300, 400, 500, 600, 700, 800]
TEMPLATE1_TEACHER_TOP = [200, 300, 400, 500, 600, 700, 800]
TEMPLATE2_SUBJECT_TOP = [100, 150, 200, 250, 300, 350, 400, 450, 500]
ALL_TRACKED_TOP = sorted(set(TEMPLATE1_LEADER_TOP) | set(TEMPLATE2_SUBJECT_TOP))
WEAK_RANK_CUTOFFS = [200, 400, 600]


def _eval_ratio(analysis: dict, ratio: float) -> dict:
    active = [s for s in analysis["students"] if s.get("eligible")]
    n = len(active)
    rounding = (analysis.get("rules") or {}).get("cutoff_rounding", "floor")
    k = rank_position(n, ratio, rounding)
    totals = [s["total"] for s in active]
    total_cut = calc_cutoff(totals, k)
    elite_ids = {s["id"] for s in active if total_cut["score"] is not None and s["total"] >= total_cut["score"]}
    subject_cutoffs = {}
    subject_achievers = {}
    for sub in analysis["subjects"]:
        values = [s["scores"][sub] for s in active if s["scores"].get(sub) is not None]
        cut = calc_cutoff(values, k)
        subject_cutoffs[sub] = cut
        subject_achievers[sub] = {
            s["id"] for s in active
            if s["scores"].get(sub) is not None and cut["score"] is not None and s["scores"][sub] >= cut["score"]
        }
    return {
        "ratio": ratio,
        "k": k,
        "total_cutoff": total_cut,
        "elite_ids": elite_ids,
        "subject_cutoffs": subject_cutoffs,
        "subject_achievers": subject_achievers,
    }


def _pct(part: int, whole: int) -> float | None:
    if not whole:
        return None
    return rounded(part / whole * 100, 1)


def _diff(curr: float | int | None, base: float | int | None, digits: int = 1):
    if curr is None or base is None:
        return None
    val = curr - base
    return int(val) if digits == 0 else rounded(val, digits)


def _subject_sort_key(sub: str) -> tuple:
    return (0, SUBJECT_ORDER.index(sub)) if sub in SUBJECT_ORDER else (1, sub)


def _diagnose_mismatch(
    high_gap: int,
    main_gap: int,
    main_conc_rate: float | None,
    *,
    main_rate_gap: float | None = None,
    warn_gap_pct: float = 5.0,
) -> tuple[str, str]:
    if high_gap >= 0 and main_gap >= 0:
        if main_conc_rate is not None and main_conc_rate < 65:
            return "单科达线·集中偏低", "warn"
        return "双线托举", "good"
    if main_gap >= 0 and high_gap <= -2:
        return "40%稳·20%缺拔高", "warn"
    if high_gap >= 0 and main_gap <= -2:
        return "20%亮·40%中层薄", "warn"
    if high_gap <= -2 and main_gap <= -2:
        return "双线预警", "alert"
    if main_rate_gap is not None and warn_gap_pct > 0 and main_rate_gap <= -warn_gap_pct:
        return f"达标率偏低（{main_rate_gap:+.1f}%）", "warn"
    if main_conc_rate is not None and main_conc_rate < 65:
        return "集中偏低·防跛脚", "warn"
    return "均衡平稳", "neutral"


def build_class_brief(
    grade_exams: list[tuple[dict, dict, dict]],
    target_exam_id: str,
    class_name: str,
    *,
    high_ratio: float | None = None,
    main_ratio: float | None = None,
) -> dict:
    """Build a complete dual-line class brief from real saved exam analyses.

    grade_exams: chronologically ordered list of (exam_summary, analysis, teachers_by_class).
    """
    if not grade_exams:
        raise ValueError("当前年级还没有已保存的考试。")

    cls = normalize_class(class_name)
    target_index = next((i for i, (info, _, _) in enumerate(grade_exams) if info["id"] == target_exam_id), len(grade_exams) - 1)
    curr_info, curr_analysis, curr_teachers_map = grade_exams[target_index]
    if cls not in curr_analysis["classes"]:
        raise ValueError(f"当前考试不包含 {cls} 班，请重新选择班级。")

    curr_rules = curr_analysis.get("rules") or {}
    high_ratio = float(curr_rules.get("high_ratio", 0.20) if high_ratio is None else high_ratio)
    main_ratio = float(curr_rules.get("main_ratio", 0.40) if main_ratio is None else main_ratio)
    if not (0 < high_ratio <= 1) or not (0 < main_ratio <= 1):
        raise ValueError("双线比例必须大于0且不超过100%。")
    if high_ratio > main_ratio:
        high_ratio, main_ratio = main_ratio, high_ratio

    borderline_band = int(curr_rules.get("borderline_band", 30))
    shift_threshold = int(curr_rules.get("shift_threshold", 50))
    warn_gap_pct = float(curr_rules.get("warn_gap_pct", 5))
    weak_rank_index = max(1, int(curr_rules.get("weak_rank_index", 1)))
    weak_cutoffs = list(curr_rules.get("weak_cutoffs") or WEAK_RANK_CUTOFFS)
    mentor_range = curr_rules.get("mentor_range")
    custom_top_nodes = list(curr_rules.get("top_nodes") or TEMPLATE1_LEADER_TOP)
    leader_top_cols = [n for n in custom_top_nodes if n in (50, 100) or n >= 150] or TEMPLATE1_LEADER_TOP
    teacher_top_cols = [n for n in leader_top_cols if n >= 200] or TEMPLATE1_TEACHER_TOP
    tracked_top_nodes = sorted(set(ALL_TRACKED_TOP) | set(custom_top_nodes))

    all_subjects = sorted(
        {sub for _, analysis, _ in grade_exams for sub in analysis["subjects"]},
        key=_subject_sort_key,
    )

    # Pre-evaluate ratios for all exams in the grade timeline
    timeline = []
    evals_by_exam = {}
    for seq, (info, analysis, teachers_map) in enumerate(grade_exams, start=1):
        ev_high = _eval_ratio(analysis, high_ratio)
        ev_main = _eval_ratio(analysis, main_ratio)
        ev_30 = _eval_ratio(analysis, 0.30)
        evals_by_exam[info["id"]] = (ev_high, ev_main, ev_30)

        cls_stat = next((c for c in analysis["class_stats"] if c["class"] == cls), None)
        if cls_stat is None:
            continue
        cls_active = [s for s in analysis["students"] if s["class"] == cls and s.get("eligible")]
        cls_ids = {s["id"] for s in cls_active}
        participants = len(cls_active)
        t_info = teachers_map.get(cls, {})
        homeroom = t_info.get("homeroom", "")
        t_subs = t_info.get("subjects", {})

        high_count = len(cls_ids & ev_high["elite_ids"])
        main_count = len(cls_ids & ev_main["elite_ids"])
        mid30_count = len(cls_ids & ev_30["elite_ids"])

        top_total = {str(n): sum(1 for s in cls_active if s["rank"] is not None and s["rank"] <= n) for n in tracked_top_nodes}
        subj_entries = {}
        for sub in analysis["subjects"]:
            st = cls_stat["subjects"][sub]
            sub_high_ach = len(cls_ids & ev_high["subject_achievers"][sub])
            sub_high_conc = len(cls_ids & ev_high["subject_achievers"][sub] & ev_high["elite_ids"])
            sub_main_ach = len(cls_ids & ev_main["subject_achievers"][sub])
            sub_main_conc = len(cls_ids & ev_main["subject_achievers"][sub] & ev_main["elite_ids"])
            sub_30_ach = len(cls_ids & ev_30["subject_achievers"][sub])
            sub_30_conc = len(cls_ids & ev_30["subject_achievers"][sub] & ev_30["elite_ids"])
            sub_top = {
                str(n): sum(1 for s in cls_active if s["ranks"].get(sub) is not None and s["ranks"][sub] <= n)
                for n in tracked_top_nodes
            }
            subj_entries[sub] = {
                "teacher": t_subs.get(sub, ""),
                "count": st["count"],
                "mean": st["mean"],
                "max": st["max"],
                "min": st["min"],
                "high_achievers": sub_high_ach,
                "high_concentrated": sub_high_conc,
                "main_achievers": sub_main_ach,
                "main_concentrated": sub_main_conc,
                "mid30_achievers": sub_30_ach,
                "mid30_concentrated": sub_30_conc,
                "top": sub_top,
            }

        grade_mean = analysis["summary"].get("mean")
        cls_mean = cls_stat.get("mean")
        timeline.append({
            "seq": seq,
            "exam_id": info["id"],
            "name": info["name"],
            "date": info["date"],
            "is_current": info["id"] == curr_info["id"],
            "homeroom": homeroom,
            "registered": cls_stat["registered"],
            "participants": participants,
            "mean": cls_mean,
            "grade_mean": grade_mean,
            "mean_diff": _diff(cls_mean, grade_mean, 1),
            "std": cls_stat.get("std"),
            "high_cutoff": ev_high["total_cutoff"]["score"],
            "high_count": high_count,
            "high_rate": _pct(high_count, participants),
            "main_cutoff": ev_main["total_cutoff"]["score"],
            "main_count": main_count,
            "main_rate": _pct(main_count, participants),
            "mid30_cutoff": ev_30["total_cutoff"]["score"],
            "mid30_count": mid30_count,
            "mid30_rate": _pct(mid30_count, participants),
            "top_total": top_total,
            "subjects": subj_entries,
        })

    curr_tl_idx = next(i for i, item in enumerate(timeline) if item["exam_id"] == curr_info["id"])
    curr_tl = timeline[curr_tl_idx]
    prev_tl = timeline[curr_tl_idx - 1] if curr_tl_idx > 0 else None
    entry_tl = timeline[0] if curr_tl_idx > 0 else None

    curr_ev_high, curr_ev_main, _ = evals_by_exam[curr_info["id"]]
    curr_active_all = [s for s in curr_analysis["students"] if s.get("eligible")]
    curr_n = len(curr_active_all)
    curr_cls_active = [s for s in curr_active_all if s["class"] == cls]
    bottom20_rank = math.floor(curr_n * 0.80) if curr_n else 0
    bottom20_count = sum(1 for s in curr_cls_active if s["rank"] is not None and s["rank"] > bottom20_rank)

    # Same-teacher cross-class stats for current exam
    all_class_metrics = {}
    for other_cls in curr_analysis["classes"]:
        other_active = [s for s in curr_active_all if s["class"] == other_cls]
        other_ids = {s["id"] for s in other_active}
        other_stat = next(c for c in curr_analysis["class_stats"] if c["class"] == other_cls)
        all_class_metrics[other_cls] = {
            "participants": len(other_active),
            "ids": other_ids,
            "stat": other_stat,
        }

    # Subject diagnosis for current exam
    prev_teachers_subs = prev_tl["subjects"] if prev_tl else {}
    subject_diagnosis = []
    for sub in curr_analysis["subjects"]:
        grade_sub = next(x for x in curr_analysis["subject_stats"] if x["subject"] == sub)
        curr_sub = curr_tl["subjects"][sub]
        teacher = curr_sub["teacher"]
        prev_teacher = prev_teachers_subs.get(sub, {}).get("teacher", "")
        teacher_changed = bool(prev_tl and teacher and prev_teacher and teacher != prev_teacher)

        h_ach, h_conc = curr_sub["high_achievers"], curr_sub["high_concentrated"]
        m_ach, m_conc = curr_sub["main_achievers"], curr_sub["main_concentrated"]
        h_gap = h_ach - curr_tl["high_count"]
        m_gap = m_ach - curr_tl["main_count"]
        h_conc_rate = _pct(h_conc, curr_tl["high_count"])
        m_conc_rate = _pct(m_conc, curr_tl["main_count"])
        m_ach_rate = _pct(m_ach, curr_tl["participants"])
        m_rate_gap = _diff(m_ach_rate, curr_tl["main_rate"], 1)
        label, tone = _diagnose_mismatch(
            h_gap, m_gap, m_conc_rate, main_rate_gap=m_rate_gap, warn_gap_pct=warn_gap_pct
        )

        same_teacher_others = []
        if teacher:
            for other_cls in sorted(curr_analysis["classes"], key=class_sort_key):
                if other_cls == cls:
                    continue
                other_t = curr_teachers_map.get(other_cls, {}).get("subjects", {}).get(sub, "")
                if other_t != teacher:
                    continue
                om = all_class_metrics[other_cls]
                o_sub = om["stat"]["subjects"][sub]
                o_h_ach = len(om["ids"] & curr_ev_high["subject_achievers"][sub])
                o_m_ach = len(om["ids"] & curr_ev_main["subject_achievers"][sub])
                same_teacher_others.append({
                    "class": other_cls,
                    "mean": o_sub["mean"],
                    "mean_diff": _diff(o_sub["mean"], grade_sub["mean"], 1),
                    "high_achievers": o_h_ach,
                    "high_rate": _pct(o_h_ach, om["participants"]),
                    "main_achievers": o_m_ach,
                    "main_rate": _pct(o_m_ach, om["participants"]),
                })

        subject_diagnosis.append({
            "subject": sub,
            "teacher": teacher,
            "prev_teacher": prev_teacher if teacher_changed else "",
            "teacher_changed": teacher_changed,
            "count": curr_sub["count"],
            "mean": curr_sub["mean"],
            "grade_mean": grade_sub["mean"],
            "mean_diff": _diff(curr_sub["mean"], grade_sub["mean"], 1),
            "max": curr_sub["max"],
            "min": curr_sub["min"],
            "high": {
                "cutoff": curr_ev_high["subject_cutoffs"][sub]["score"],
                "achievers": h_ach,
                "concentrated": h_conc,
                "achieve_rate": _pct(h_ach, curr_tl["participants"]),
                "conc_rate": h_conc_rate,
                "gap": h_gap,
            },
            "main": {
                "cutoff": curr_ev_main["subject_cutoffs"][sub]["score"],
                "achievers": m_ach,
                "concentrated": m_conc,
                "achieve_rate": _pct(m_ach, curr_tl["participants"]),
                "conc_rate": m_conc_rate,
                "gap": m_gap,
            },
            "mismatch_label": label,
            "mismatch_tone": tone,
            "same_teacher_other_classes": same_teacher_others,
        })

    # Borderline & single-lame student lists
    total_subjects = curr_analysis["rules"]["total_subjects"]

    def make_borderline(ev: dict, _fallback_pct: float) -> list[dict]:
        line_score = ev["total_cutoff"]["score"]
        if line_score is None:
            return []
        rank_limit = ev["k"] + max(borderline_band, 1)
        candidates = []
        for s in curr_cls_active:
            if s["id"] in ev["elite_ids"]:
                continue
            gap = rounded(line_score - s["total"], 1)
            if gap <= 0:
                continue
            if (s["rank"] is not None and s["rank"] <= rank_limit) or gap <= 20:
                missing = []
                for sub in total_subjects:
                    sub_cut = ev["subject_cutoffs"][sub]["score"]
                    sc = s["scores"].get(sub)
                    if sub_cut is not None and (sc is None or sc < sub_cut):
                        missing.append({
                            "subject": sub,
                            "score": sc,
                            "cutoff": sub_cut,
                            "gap": rounded(sub_cut - sc, 1) if sc is not None else None,
                        })
                missing.sort(key=lambda x: -(x["gap"] if x["gap"] is not None else 999))
                candidates.append({
                    "id": s["id"],
                    "name": s["name"],
                    "source_row": s.get("source_row"),
                    "total": s["total"],
                    "rank": s["rank"],
                    "score_gap": gap,
                    "missing_subjects": missing,
                    "single_lame": len(missing) == 1,
                })
        candidates.sort(key=lambda x: (not x["single_lame"], x["score_gap"], x["rank"] or 999999))
        return candidates[:15]

    borderline_high = make_borderline(curr_ev_high, 0.12)
    borderline_main = make_borderline(curr_ev_main, 0.14)

    # Dual-line flow matrix + drop alerts + breakthroughs (previous exam -> current exam)
    flow = {"available": False, "reason": "至少导入两场同年级考试并包含稳定学号或姓名后，可追踪双线人员流动。"}
    drop_alerts = []
    breakthroughs = []
    if prev_tl is not None:
        prev_exam_tuple = next(item for item in grade_exams if item[0]["id"] == prev_tl["exam_id"])
        prev_info, prev_analysis, _ = prev_exam_tuple
        prev_ev_high, prev_ev_main, _ = evals_by_exam[prev_info["id"]]
        prev_by_id = {
            s["id"]: s for s in prev_analysis["students"]
            if s.get("eligible") and s.get("identity_reliable")
        }
        matched = [
            (prev_by_id[s["id"]], s)
            for s in curr_cls_active
            if s.get("identity_reliable") and s["id"] in prev_by_id
        ]
        if matched:
            high_prev = high_keep = high_drop = high_rise = 0
            main_prev = main_keep = main_drop = main_rise = 0
            for ps, cs in matched:
                p_in_h = ps["id"] in prev_ev_high["elite_ids"]
                c_in_h = cs["id"] in curr_ev_high["elite_ids"]
                p_in_m = ps["id"] in prev_ev_main["elite_ids"]
                c_in_m = cs["id"] in curr_ev_main["elite_ids"]
                if p_in_h:
                    high_prev += 1
                    if c_in_h:
                        high_keep += 1
                    else:
                        high_drop += 1
                elif c_in_h:
                    high_rise += 1
                if p_in_m:
                    main_prev += 1
                    if c_in_m:
                        main_keep += 1
                    else:
                        main_drop += 1
                elif c_in_m:
                    main_rise += 1

                rank_diff = (cs["rank"] - ps["rank"]) if (cs["rank"] and ps["rank"]) else None
                crossed_down = (p_in_h and not c_in_h) or (p_in_m and not c_in_m)
                crossed_up = (not p_in_h and c_in_h) or (not p_in_m and c_in_m)
                big_drop = rank_diff is not None and rank_diff >= shift_threshold
                big_gain = rank_diff is not None and (-rank_diff) >= shift_threshold
                if crossed_down or big_drop:
                    common_subs = [sub for sub in curr_analysis["subjects"] if sub in prev_analysis["subjects"]]
                    sub_drops = []
                    for sub in common_subs:
                        pr = ps["ranks"].get(sub)
                        cr = cs["ranks"].get(sub)
                        if pr is not None and cr is not None and cr > pr:
                            sub_drops.append({"subject": sub, "prev_rank": pr, "curr_rank": cr, "drop": cr - pr})
                    sub_drops.sort(key=lambda x: -x["drop"])
                    prev_tier = f"前{int(round(high_ratio * 100))}%" if p_in_h else (f"前{int(round(main_ratio * 100))}%" if p_in_m else f"前{int(round(main_ratio * 100))}%外")
                    curr_tier = f"前{int(round(high_ratio * 100))}%" if c_in_h else (f"前{int(round(main_ratio * 100))}%" if c_in_m else f"前{int(round(main_ratio * 100))}%外")
                    if not crossed_down:
                        curr_tier = f"{curr_tier}（退步≥{shift_threshold}名）"
                    drop_alerts.append({
                        "id": cs["id"],
                        "name": cs["name"],
                        "prev_tier": prev_tier,
                        "curr_tier": curr_tier,
                        "prev_rank": ps["rank"],
                        "curr_rank": cs["rank"],
                        "rank_drop": rank_diff,
                        "biggest_drop_subjects": sub_drops[:2],
                    })
                elif crossed_up or big_gain:
                    target_label = (
                        f"冲进前{int(round(high_ratio * 100))}%" if (not p_in_h and c_in_h)
                        else f"冲进前{int(round(main_ratio * 100))}%" if (not p_in_m and c_in_m)
                        else f"显著进步（≥{shift_threshold}名）"
                    )
                    breakthroughs.append({
                        "id": cs["id"],
                        "name": cs["name"],
                        "target": target_label,
                        "prev_rank": ps["rank"],
                        "curr_rank": cs["rank"],
                        "rank_gain": (-rank_diff) if rank_diff is not None else None,
                    })
            drop_alerts.sort(key=lambda x: -(x["rank_drop"] or 0))
            breakthroughs.sort(key=lambda x: -(x["rank_gain"] or 0))
            flow = {
                "available": True,
                "prev_exam_name": prev_info["name"],
                "matched_count": len(matched),
                "high_prev": high_prev,
                "high_keep": high_keep,
                "high_keep_rate": _pct(high_keep, high_prev),
                "high_drop_count": high_drop,
                "high_rise_count": high_rise,
                "main_prev": main_prev,
                "main_keep": main_keep,
                "main_keep_rate": _pct(main_keep, main_prev),
                "main_drop_count": main_drop,
                "main_rise_count": main_rise,
            }
        else:
            flow = {"available": False, "reason": "当前或上次考试缺少稳定学号/姓名，无法追踪跨次人员流动。"}

    # Persistent weak subjects across recent up to 3 exams ending at target_index
    persistent_weak = []
    recent_slice = grade_exams[max(0, target_index - 2): target_index + 1]
    if len(recent_slice) >= 2:
        exam_student_maps = []
        for info, analysis, _ in recent_slice:
            exam_student_maps.append((
                info["name"],
                {s["id"]: s for s in analysis["students"] if s.get("eligible") and s.get("identity_reliable")},
            ))
        for cs in curr_cls_active:
            if not cs.get("identity_reliable"):
                continue
            weak_counter = Counter()
            appearances = 0
            for _, smap in exam_student_maps:
                st = smap.get(cs["id"])
                if not st or not st.get("weak"):
                    continue
                appearances += 1
                for item in st["weak"][:2]:
                    weak_counter[item["subject"]] += 1
            if appearances >= 2 and weak_counter:
                top_sub, hits = weak_counter.most_common(1)[0]
                if hits >= 2:
                    persistent_weak.append({
                        "id": cs["id"],
                        "name": cs["name"],
                        "rank": cs["rank"],
                        "total": cs["total"],
                        "subject": top_sub,
                        "hits": hits,
                        "exams_checked": appearances,
                        "curr_score": cs["scores"].get(top_sub),
                        "curr_sub_rank": cs["ranks"].get(top_sub),
                    })
        persistent_weak.sort(key=lambda x: (-x["hits"], x["rank"] or 999999))
        persistent_weak = persistent_weak[:15]

    # Template 2 current subject statistics matrix (rows: 实考/均分/最高/最低/前100..500)
    curr_subject_matrix = {
        "subjects": curr_analysis["subjects"],
        "rows": [
            ["实考人数"] + [curr_tl["subjects"][s]["count"] for s in curr_analysis["subjects"]],
            ["平均分"] + [curr_tl["subjects"][s]["mean"] for s in curr_analysis["subjects"]],
            ["最高分"] + [curr_tl["subjects"][s]["max"] for s in curr_analysis["subjects"]],
            ["最低分"] + [curr_tl["subjects"][s]["min"] for s in curr_analysis["subjects"]],
        ] + [
            [f"前{top_n}名"] + [curr_tl["subjects"][s]["top"][str(top_n)] for s in curr_analysis["subjects"]]
            for top_n in TEMPLATE2_SUBJECT_TOP
        ],
    }

    # Template 2 current weak subject counts for configured cutoffs & weak rank index
    weak_summary_rows = []
    weak_idx = weak_rank_index - 1
    for limit in weak_cutoffs:
        counts = Counter(
            s["weak"][weak_idx]["subject"]
            for s in curr_cls_active
            if s["rank"] is not None and s["rank"] <= limit and len(s.get("weak") or []) > weak_idx
        )
        weak_summary_rows.append({
            "cutoff": limit,
            "counts": {sub: counts.get(sub, 0) for sub in curr_analysis["subjects"]},
            "total": sum(counts.values()),
        })

    # Mentor list (导师制名单：总分名次落在 mentor_range 内)
    mentor_list = []
    if mentor_range and len(mentor_range) == 2:
        m_lo, m_hi = mentor_range
        for s in curr_cls_active:
            if s["rank"] is not None and m_lo <= s["rank"] <= m_hi:
                mentor_list.append({
                    "id": s["id"],
                    "name": s["name"],
                    "total": s["total"],
                    "rank": s["rank"],
                    "class_rank": s.get("class_rank"),
                    "weak": [w["subject"] for w in (s.get("weak") or [])[:2]],
                })
        mentor_list.sort(key=lambda x: (x["rank"] or 999999, x["name"]))

    # Generate diagnostic tags & pointed leadership talking points
    high_pct_label = f"{high_ratio * 100:g}%"
    main_pct_label = f"{main_ratio * 100:g}%"
    h_delta_prev = _diff(curr_tl["high_count"], prev_tl["high_count"], 0) if prev_tl else None
    m_delta_prev = _diff(curr_tl["main_count"], prev_tl["main_count"], 0) if prev_tl else None
    h_delta_entry = _diff(curr_tl["high_count"], entry_tl["high_count"], 0) if entry_tl else None
    m_delta_entry = _diff(curr_tl["main_count"], entry_tl["main_count"], 0) if entry_tl else None
    h_rate_delta_entry = _diff(curr_tl["high_rate"], entry_tl["high_rate"], 1) if entry_tl else None
    m_rate_delta_entry = _diff(curr_tl["main_rate"], entry_tl["main_rate"], 1) if entry_tl else None

    tags = []
    talking_points = []

    if m_delta_entry is not None:
        if m_delta_entry >= 3:
            tags.append({"tone": "good", "text": f"{main_pct_label}较首考净增+{m_delta_entry}人（高增值）"})
            talking_points.append(
                f"先肯定增值：{cls}班前{main_pct_label}人数从首考的 {entry_tl['main_count']} 人增至 {curr_tl['main_count']} 人（+{m_delta_entry}人，占比{m_rate_delta_entry:+.1f}%），班级整体处于上升通道。"
            )
        elif m_delta_entry <= -3:
            tags.append({"tone": "alert", "text": f"{main_pct_label}较首考减少{m_delta_entry}人"})
            talking_points.append(
                f"关注大盘走势：{cls}班前{main_pct_label}人数较首考减少 {abs(m_delta_entry)} 人（占比变化{m_rate_delta_entry:+.1f}%），需排查中优层持续失血原因。"
            )
    if h_delta_prev is not None:
        if h_delta_prev >= 2:
            tags.append({"tone": "good", "text": f"{high_pct_label}较上次+{h_delta_prev}人"})
            talking_points.append(
                f"尖优发力：前{high_pct_label}人数较上次（{prev_tl['name']}）净增 {h_delta_prev} 人，达到 {curr_tl['high_count']} 人。"
            )
        elif h_delta_prev <= -2:
            tags.append({"tone": "alert", "text": f"{high_pct_label}较上次{h_delta_prev}人（尖子流失）"})
            talking_points.append(
                f"尖优预警：前{high_pct_label}人数较上次减少 {abs(h_delta_prev)} 人，建议重点复盘掉出{high_pct_label}线的老优生失分学科。"
            )

    if subject_diagnosis:
        best_sub = max(subject_diagnosis, key=lambda x: (x["main"]["gap"] + x["high"]["gap"], x["mean_diff"] or -999))
        worst_sub = min(subject_diagnosis, key=lambda x: (x["main"]["gap"] + x["high"]["gap"], x["mean_diff"] or 999))
        if best_sub["main"]["gap"] > 0 or best_sub["high"]["gap"] > 0:
            t_name = f"（{best_sub['teacher']}）" if best_sub["teacher"] else ""
            tags.append({"tone": "good", "text": f"托举科：{best_sub['subject']}"})
            talking_points.append(
                f"点名表扬托举学科：{best_sub['subject']}{t_name}在{high_pct_label}线贡献差 {best_sub['high']['gap']:+d} 人、{main_pct_label}线贡献差 {best_sub['main']['gap']:+d} 人，有效托住了班级总分。"
            )
        if worst_sub["main"]["gap"] <= -2 or worst_sub["high"]["gap"] <= -2:
            t_name = f"（{worst_sub['teacher']}）" if worst_sub["teacher"] else ""
            tags.append({"tone": "alert", "text": f"短板科：{worst_sub['subject']}（{worst_sub['mismatch_label']}）"})
            talking_points.append(
                f"重点会诊短板：{worst_sub['subject']}{t_name}表现为“{worst_sub['mismatch_label']}”（{high_pct_label}贡献差 {worst_sub['high']['gap']:+d}，{main_pct_label}贡献差 {worst_sub['main']['gap']:+d}），建议针对对应分层精准调整讲评坡度。"
            )

    single_lame_main = [s for s in borderline_main if s["single_lame"]]
    single_lame_high = [s for s in borderline_high if s["single_lame"]]
    if single_lame_main or single_lame_high:
        parts = []
        if single_lame_high:
            names = "、".join(s["name"] for s in single_lame_high[:4])
            parts.append(f"冲{high_pct_label}单科跛脚生 {len(single_lame_high)} 人（如 {names}）")
        if single_lame_main:
            names = "、".join(s["name"] for s in single_lame_main[:4])
            parts.append(f"冲{main_pct_label}单科跛脚生 {len(single_lame_main)} 人（如 {names}）")
        tags.append({"tone": "warn", "text": f"可速提单科跛脚生 {len(single_lame_high) + len(single_lame_main)} 人"})
        talking_points.append("现场派活抓手：" + "；".join(parts) + "，可由对应薄弱科任课老师直接认领面批。")

    if not talking_points:
        talking_points.append(
            f"{cls}班本次前{high_pct_label}达线 {curr_tl['high_count']} 人（{curr_tl['high_rate'] or 0}%），前{main_pct_label}达线 {curr_tl['main_count']} 人（{curr_tl['main_rate'] or 0}%），各学科表现整体平稳。"
        )

    headline = {
        "registered": curr_tl["registered"],
        "participants": curr_tl["participants"],
        "mean": curr_tl["mean"],
        "grade_mean": curr_tl["grade_mean"],
        "mean_diff": curr_tl["mean_diff"],
        "std": curr_tl["std"],
        "bottom20_count": bottom20_count,
        "elite_ratio": _pct(curr_tl["high_count"], curr_tl["main_count"]),
        "high": {
            "ratio": high_ratio,
            "label": f"前{high_pct_label}",
            "cutoff": curr_tl["high_cutoff"],
            "count": curr_tl["high_count"],
            "rate": curr_tl["high_rate"],
            "delta_prev_count": h_delta_prev,
            "delta_prev_rate": _diff(curr_tl["high_rate"], prev_tl["high_rate"], 1) if prev_tl else None,
            "delta_entry_count": h_delta_entry,
            "delta_entry_rate": h_rate_delta_entry,
        },
        "main": {
            "ratio": main_ratio,
            "label": f"前{main_pct_label}",
            "cutoff": curr_tl["main_cutoff"],
            "count": curr_tl["main_count"],
            "rate": curr_tl["main_rate"],
            "delta_prev_count": m_delta_prev,
            "delta_prev_rate": _diff(curr_tl["main_rate"], prev_tl["main_rate"], 1) if prev_tl else None,
            "delta_entry_count": m_delta_entry,
            "delta_entry_rate": m_rate_delta_entry,
        },
        "tags": tags,
        "talking_points": talking_points,
    }

    return {
        "meta": {
            "grade": curr_info["grade"],
            "class": cls,
            "exam_id": curr_info["id"],
            "exam_name": curr_info["name"],
            "exam_date": curr_info["date"],
            "homeroom": curr_tl["homeroom"],
            "exam_count": len(timeline),
            "high_ratio": high_ratio,
            "main_ratio": main_ratio,
            "cutoff_rounding": curr_rules.get("cutoff_rounding", "floor"),
            "tie_mode": curr_rules.get("tie_mode", "competition"),
            "borderline_band": borderline_band,
            "shift_threshold": shift_threshold,
            "warn_gap_pct": warn_gap_pct,
            "weak_rank_index": weak_rank_index,
            "mentor_range": mentor_range,
            "classes": curr_analysis["classes"],
            "all_subjects": all_subjects,
        },
        "headline": headline,
        "subject_diagnosis": subject_diagnosis,
        "flow": flow,
        "action_lists": {
            "borderline_high": borderline_high,
            "borderline_main": borderline_main,
            "drop_alerts": drop_alerts[:15],
            "persistent_weak": persistent_weak,
            "breakthroughs": breakthroughs[:15],
            "mentor_list": mentor_list,
        },
        "timeline": timeline,
        "current_subject_matrix": curr_subject_matrix,
        "current_weak_summary": weak_summary_rows,
        "template_columns": {
            "leader_top": leader_top_cols,
            "teacher_top": teacher_top_cols,
        },
    }
