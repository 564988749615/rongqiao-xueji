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
        return "集中偏低·防偏科", "warn"
    return "均衡平稳", "neutral"


def build_class_brief(
    grade_exams: list[tuple[dict, dict, dict]],
    target_exam_id: str,
    class_name: str,
    *,
    high_ratio: float | None = None,
    main_ratio: float | None = None,
    compare_exam_id: str | None = None,
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
                f"关注大盘走势：{cls}班前{main_pct_label}人数较首考减少 {abs(m_delta_entry)} 人（占比变化{m_rate_delta_entry:+.1f}%），需排查中优层持续流失原因。"
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
            parts.append(f"冲{high_pct_label}单科短板生 {len(single_lame_high)} 人（如 {names}）")
        if single_lame_main:
            names = "、".join(s["name"] for s in single_lame_main[:4])
            parts.append(f"冲{main_pct_label}单科短板生 {len(single_lame_main)} 人（如 {names}）")
        tags.append({"tone": "warn", "text": f"可速提单科短板生 {len(single_lame_high) + len(single_lame_main)} 人"})
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

    # Build per-student comparison vs selected baseline exam (defaults to immediate previous exam)
    default_prev_id = prev_tl["exam_id"] if prev_tl is not None else None
    compare_options = [
        {
            "id": info["id"],
            "name": info["name"],
            "date": info["date"],
            "is_prev": info["id"] == default_prev_id,
        }
        for info, _, _ in reversed(grade_exams)
        if info["id"] != curr_info["id"]
    ]
    chosen_compare_tuple = None
    if compare_exam_id:
        chosen_compare_tuple = next(
            (item for item in grade_exams if item[0]["id"] == compare_exam_id and item[0]["id"] != curr_info["id"]),
            None,
        )
    if chosen_compare_tuple is None and default_prev_id:
        chosen_compare_tuple = next(
            (item for item in grade_exams if item[0]["id"] == default_prev_id),
            None,
        )

    compare_info = None
    compare_by_id = {}
    compare_common_subs: list[str] = []
    if chosen_compare_tuple is not None:
        c_info, c_analysis, _ = chosen_compare_tuple
        compare_info = {"id": c_info["id"], "name": c_info["name"], "date": c_info["date"]}
        compare_by_id = {
            s["id"]: s
            for s in c_analysis["students"]
            if s.get("eligible") and s.get("identity_reliable")
        }
        compare_common_subs = [sub for sub in curr_analysis["subjects"] if sub in c_analysis["subjects"]]

    persistent_by_student: dict[str, set[str]] = {}
    for pw in persistent_weak:
        persistent_by_student.setdefault(pw["id"], set()).add(pw["subject"])

    bh_ids = {x["id"] for x in borderline_high}
    bm_ids = {x["id"] for x in borderline_main}
    mentor_ids = {x["id"] for x in mentor_list}
    drop_ids = {x["id"] for x in drop_alerts}
    weak_display_limit = min(max(1, int(curr_rules.get("weak_count", 3))), 3)

    student_comp_rows = []
    rank_gains_list: list[int] = []
    big_gain_count = 0
    big_drop_count = 0
    sorted_cls_students = sorted(
        curr_cls_active,
        key=lambda s: (
            s.get("class_rank") if s.get("class_rank") is not None else 999999,
            s.get("rank") if s.get("rank") is not None else 999999,
            s.get("name", ""),
        ),
    )
    for cs in sorted_cls_students:
        sid = cs["id"]
        in_high = sid in curr_ev_high["elite_ids"]
        in_main = sid in curr_ev_main["elite_ids"]
        tier = "high" if in_high else ("main" if in_main else "below")
        tier_label = f"前{high_pct_label}" if in_high else (f"前{main_pct_label}" if in_main else "—")

        ps = compare_by_id.get(sid) if cs.get("identity_reliable") else None
        prev_total = ps.get("total") if ps else None
        prev_rank = ps.get("rank") if ps else None
        total_delta = _diff(cs.get("total"), prev_total, 1)
        rank_gain = int(prev_rank - cs["rank"]) if (prev_rank is not None and cs.get("rank") is not None) else None
        is_big_gain = rank_gain is not None and rank_gain >= shift_threshold
        is_big_drop = rank_gain is not None and (-rank_gain) >= shift_threshold
        if rank_gain is not None:
            rank_gains_list.append(rank_gain)
            if is_big_gain:
                big_gain_count += 1
            if is_big_drop:
                big_drop_count += 1

        prev_weak_names = [w["subject"] for w in (ps.get("weak") or [])[:2]] if ps else []
        persist_set = persistent_by_student.get(sid, set()) | set(prev_weak_names)
        curr_weak_items = [
            {
                "subject": w["subject"],
                "score": (cs.get("scores") or {}).get(w["subject"]),
                "rank": (cs.get("ranks") or {}).get(w["subject"]),
                "persistent": w["subject"] in persist_set,
            }
            for w in (cs.get("weak") or [])[:weak_display_limit]
        ]

        biggest_drop_sub = None
        biggest_gain_sub = None
        sub_mover_text = "—"
        if ps and compare_common_subs:
            drops = []
            gains = []
            for sub in compare_common_subs:
                pr = (ps.get("ranks") or {}).get(sub)
                cr = (cs.get("ranks") or {}).get(sub)
                if pr is None or cr is None:
                    continue
                delta = int(pr - cr)  # positive = improved, negative = dropped
                if delta < 0:
                    drops.append((abs(delta), sub))
                elif delta > 0:
                    gains.append((delta, sub))
            if drops:
                drops.sort(reverse=True)
                biggest_drop_sub = {"subject": drops[0][1], "delta": drops[0][0]}
            if gains:
                gains.sort(reverse=True)
                biggest_gain_sub = {"subject": gains[0][1], "delta": gains[0][0]}
            if rank_gain is not None and rank_gain <= -10 and biggest_drop_sub and biggest_drop_sub["delta"] >= 15:
                sub_mover_text = f"{biggest_drop_sub['subject']}↓{biggest_drop_sub['delta']}"
            elif rank_gain is not None and rank_gain >= 10 and biggest_gain_sub and biggest_gain_sub["delta"] >= 15:
                sub_mover_text = f"{biggest_gain_sub['subject']}↑{biggest_gain_sub['delta']}"
            else:
                d_val = biggest_drop_sub["delta"] if biggest_drop_sub else 0
                g_val = biggest_gain_sub["delta"] if biggest_gain_sub else 0
                if max(d_val, g_val) >= 25:
                    if d_val >= g_val and biggest_drop_sub:
                        sub_mover_text = f"{biggest_drop_sub['subject']}↓{d_val}"
                    elif biggest_gain_sub:
                        sub_mover_text = f"{biggest_gain_sub['subject']}↑{g_val}"
                else:
                    sub_mover_text = "平稳"

        student_comp_rows.append({
            "id": sid,
            "name": cs["name"],
            "class_rank": cs.get("class_rank"),
            "total": cs.get("total"),
            "rank": cs.get("rank"),
            "tier": tier,
            "tier_label": tier_label,
            "prev_total": prev_total,
            "prev_rank": prev_rank,
            "total_delta": total_delta,
            "rank_gain": rank_gain,
            "is_big_gain": is_big_gain,
            "is_big_drop": is_big_drop,
            "weak": curr_weak_items,
            "prev_weak": prev_weak_names,
            "biggest_drop_sub": biggest_drop_sub,
            "biggest_gain_sub": biggest_gain_sub,
            "sub_mover_text": sub_mover_text,
            "in_borderline_high": sid in bh_ids,
            "in_borderline_main": sid in bm_ids,
            "in_mentor": sid in mentor_ids,
            "in_drop_alert": sid in drop_ids,
        })

    student_comparison = {
        "compare_exam": compare_info,
        "compare_options": compare_options,
        "matched_count": len(rank_gains_list),
        "big_gain_count": big_gain_count,
        "big_drop_count": big_drop_count,
        "avg_rank_gain": rounded(sum(rank_gains_list) / len(rank_gains_list), 1) if rank_gains_list else None,
        "rows": student_comp_rows,
    }

    # Build privacy-safe multi-tier (A1/A2/B1/B2/C1/C2) teacher lever profile — ZERO raw scores, ZERO exact ranks!
    raw_bounds = curr_rules.get("level_bounds") or [
        {"label": "A1", "ratio": 0.18}, {"label": "A2", "ratio": 0.30},
        {"label": "B1", "ratio": 0.55}, {"label": "B2", "ratio": 0.80},
        {"label": "C1", "ratio": 0.90}, {"label": "C2", "ratio": 1.0},
    ]
    tier_pairs = []
    for item in raw_bounds:
        if isinstance(item, dict) and item.get("label") and item.get("ratio") is not None:
            tier_pairs.append((str(item["label"]), float(item["ratio"])))
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            tier_pairs.append((str(item[0]), float(item[1])))
    if not tier_pairs:
        tier_pairs = [("A1", 0.18), ("A2", 0.30), ("B1", 0.55), ("B2", 0.80), ("C1", 0.90), ("C2", 1.0)]
    tiers = [lbl for lbl, _ in tier_pairs]
    tier_index = {lbl: idx for idx, lbl in enumerate(tiers)}
    tier_expected: dict[str, float] = {}
    prev_cum = 0.0
    for lbl, cum in tier_pairs:
        tier_expected[lbl] = rounded((cum - prev_cum) * 100.0, 1)
        prev_cum = cum

    a_tiers = [t for t in tiers if t.upper().startswith("A")] or tiers[:max(1, min(2, len(tiers)))]
    a_set = set(a_tiers)
    c_tiers = [t for t in tiers if t.upper().startswith("C")] or tiers[max(1, len(tiers) - 2):]
    c_set = set(c_tiers)
    good_set = set(a_tiers) | {t for t in tiers if t.upper() in ("B1", "B")}
    if len(good_set) == len(tiers) and len(tiers) > 2:
        good_set = set(tiers[: (len(tiers) + 1) // 2])
    top_tier = tiers[0] if tiers else "A1"
    second_tier = tiers[1] if len(tiers) > 1 else top_tier

    # Compute rank boundary per tier internally ONLY to identify "升档临界" without ever exposing scores/ranks
    grade_n = int(curr_analysis["summary"]["participants"] or 0)
    tier_upper_rank: dict[str, int] = {}
    rounding_mode = curr_rules.get("cutoff_rounding", "floor")
    for lbl, cum in tier_pairs:
        tier_upper_rank[lbl] = rank_position(grade_n, cum, rounding_mode) if grade_n else 0
    push_margin = max(12, min(borderline_band, max(12, int(grade_n * 0.05)))) if grade_n else 15

    curr_level_counts = Counter((s.get("levels") or {}).get("总分") for s in curr_cls_active)
    prev_cls_active = []
    if chosen_compare_tuple is not None:
        _, cmp_ana, _ = chosen_compare_tuple
        prev_cls_active = [s for s in cmp_ana["students"] if s["class"] == cls and s.get("eligible")]
    prev_level_counts = Counter((s.get("levels") or {}).get("总分") for s in prev_cls_active)

    cls_n = len(curr_cls_active)
    total_distribution = []
    for lbl in tiers:
        cnt = curr_level_counts.get(lbl, 0)
        rate = _pct(cnt, cls_n)
        exp = tier_expected.get(lbl, 0.0)
        p_cnt = prev_level_counts.get(lbl, 0) if prev_cls_active else None
        total_distribution.append({
            "level": lbl,
            "count": cnt,
            "rate": rate,
            "expected_rate": exp,
            "rate_diff": _diff(rate, exp, 1),
            "prev_count": p_cnt,
            "delta_count": (cnt - p_cnt) if p_cnt is not None else None,
        })

    a_cls_rate = _pct(sum(curr_level_counts.get(t, 0) for t in a_set), cls_n) or 0.0
    a_exp_rate = sum(tier_expected.get(t, 0.0) for t in a_set)
    c_cls_rate = _pct(sum(curr_level_counts.get(t, 0) for t in c_set), cls_n) or 0.0
    c_exp_rate = sum(tier_expected.get(t, 0.0) for t in c_set)
    if a_cls_rate >= a_exp_rate + 4 and c_cls_rate >= c_exp_rate + 4:
        structure_tag = "哑铃分化（优生强 · 尾段偏厚）"
    elif a_cls_rate >= a_exp_rate + 4 and c_cls_rate <= c_exp_rate:
        structure_tag = "尖优引领（整体高位）"
    elif c_cls_rate >= c_exp_rate + 5:
        structure_tag = "尾段偏厚 · 优先抓基础兜底"
    elif a_cls_rate <= a_exp_rate - 5 and c_cls_rate <= c_exp_rate + 2:
        structure_tag = "纺锤偏中 · 缺拔高冲优"
    else:
        structure_tag = "结构均衡"

    # Subject desensitized synergy + 4-tier classroom teaching groups (NO mean, NO cutoff, NO rank)
    subject_synergy = []
    for sub in curr_analysis["subjects"]:
        sub_cnts = Counter()
        valid_sub_n = 0
        mismatch_a = []
        grp_top, grp_push, grp_steady, grp_support = [], [], [], []
        for s in sorted(curr_cls_active, key=lambda x: x.get("name", "")):
            slvl = (s.get("levels") or {}).get(sub)
            tlvl = (s.get("levels") or {}).get("总分")
            if not slvl:
                continue
            sub_cnts[slvl] += 1
            valid_sub_n += 1
            if tlvl in a_set and slvl not in a_set:
                mismatch_a.append({"name": s["name"], "total_level": tlvl, "sub_level": slvl})
            if slvl == top_tier:
                grp_top.append(s["name"])
            elif slvl == second_tier or (tlvl in a_set and slvl not in a_set):
                grp_push.append(s["name"])
            elif slvl in c_set:
                grp_support.append(s["name"])
            else:
                grp_steady.append(s["name"])

        sub_a_rate = _pct(sum(sub_cnts.get(t, 0) for t in a_set), valid_sub_n)
        sub_good_rate = _pct(sum(sub_cnts.get(t, 0) for t in good_set), valid_sub_n)
        sub_c_rate = _pct(sum(sub_cnts.get(t, 0) for t in c_set), valid_sub_n)
        subject_synergy.append({
            "subject": sub,
            "teacher": curr_teachers_map.get(cls, {}).get("subjects", {}).get(sub, ""),
            "counts": {lbl: sub_cnts.get(lbl, 0) for lbl in tiers},
            "a_rate": sub_a_rate,
            "good_rate": sub_good_rate,
            "c_rate": sub_c_rate,
            "mismatch_a_count": len(mismatch_a),
            "mismatch_a_students": mismatch_a,
            "teaching_groups": [
                {"id": "top", "label": f"拔尖拓展组（{top_tier}）", "hint": "拓展思维与压轴题，鼓励自主探究", "names": grp_top},
                {"id": "push", "label": f"冲优提质组（{second_tier} / 总评A未达A）", "hint": "规范答题与中难题突破，重点冲高档", "names": grp_push},
                {"id": "steady", "label": "夯基稳中组（中层）", "hint": "抓中档得分点与错题二次过关", "names": grp_steady},
                {"id": "support", "label": f"基础兜底组（{'/'.join(c_tiers)}）", "hint": "抓核心概念、基础题面批与信心建立", "names": grp_support},
            ],
        })

    # Per-student zero-score, zero-rank teacher levers (sorted by tier + name so row position never reveals exact rank!)
    up_count = same_count = down_count = 0
    flow_pair_counts = Counter()
    student_levers = []
    comp_by_sid = {r["id"]: r for r in student_comp_rows}

    for cs in curr_cls_active:
        sid = cs["id"]
        lvl = (cs.get("levels") or {}).get("总分") or (tiers[-1] if tiers else "—")
        abc = (cs.get("grades") or {}).get("总分") or "—"
        curr_idx = tier_index.get(lvl, len(tiers))

        ps = compare_by_id.get(sid) if cs.get("identity_reliable") else None
        prev_lvl = (ps.get("levels") or {}).get("总分") if ps else None
        prev_idx = tier_index.get(prev_lvl) if prev_lvl in tier_index else None

        level_step = (prev_idx - curr_idx) if (prev_idx is not None and curr_idx < len(tiers)) else None
        if level_step is not None:
            if level_step > 0:
                up_count += 1
                flow_pair_counts[f"{prev_lvl}→{lvl}"] += 1
                transition_text = f"{prev_lvl}→{lvl}（升{level_step}档）"
            elif level_step < 0:
                down_count += 1
                flow_pair_counts[f"{prev_lvl}→{lvl}"] += 1
                transition_text = f"{prev_lvl}→{lvl}（降{abs(level_step)}档）"
            else:
                same_count += 1
                transition_text = f"守档（{lvl}）"
        else:
            transition_text = "—"

        # Qualitative status signal (derived internally without leaking any numeric rank!)
        comp_rec = comp_by_sid.get(sid) or {}
        rk_gain = comp_rec.get("rank_gain")
        if (level_step is not None and level_step >= 2) or (level_step is not None and level_step >= 1 and comp_rec.get("is_big_gain")) or comp_rec.get("is_big_gain"):
            status_code, status_label = "surge", "🚀 显著跃升"
        elif (level_step is not None and level_step <= -2) or (level_step is not None and level_step <= -1 and comp_rec.get("is_big_drop")) or comp_rec.get("is_big_drop"):
            status_code, status_label = "slide", "⚠️ 明显滑坡·优先谈心"
        elif (level_step is not None and level_step > 0) or (rk_gain is not None and rk_gain >= max(15, shift_threshold // 3)):
            status_code, status_label = "rise", "↗ 稳步上行"
        elif (level_step is not None and level_step < 0) or (rk_gain is not None and rk_gain <= -max(15, shift_threshold // 3)):
            status_code, status_label = "dip", "↘ 略有回落"
        else:
            status_code, status_label = "steady", "● 稳定守档"

        # Upper-tier push target ("临门一脚" — without revealing exact rank or score gap!)
        push_target = None
        if curr_idx > 0 and curr_idx < len(tiers) and cs.get("rank") is not None:
            target_lvl = tiers[curr_idx - 1]
            upper_bound_rank = tier_upper_rank.get(target_lvl, 0)
            if upper_bound_rank > 0 and cs["rank"] <= upper_bound_rank + push_margin:
                target_idx = curr_idx - 1
                blocks = []
                for sub in curr_analysis["subjects"]:
                    sl = (cs.get("levels") or {}).get(sub)
                    if sl in tier_index and tier_index[sl] > target_idx:
                        blocks.append({"subject": sub, "level": sl, "gap_steps": tier_index[sl] - target_idx})
                blocks.sort(key=lambda x: -x["gap_steps"])
                push_target = {
                    "target_level": target_lvl,
                    "label": f"冲 {target_lvl}",
                    "single_block": len(blocks) == 1,
                    "block_subjects": [f"{b['subject']}({b['level']})" for b in blocks[:2]],
                }

        # Drag subjects (sub level strictly worse than total level, prioritizing >= 2 steps & persistent)
        prev_weak_names = set(comp_rec.get("prev_weak") or [])
        persist_set = persistent_by_student.get(sid, set()) | prev_weak_names
        drag_list = []
        strength_list = []
        sub_lvls_map = {}
        for sub in curr_analysis["subjects"]:
            sl = (cs.get("levels") or {}).get(sub)
            if not sl:
                continue
            sub_lvls_map[sub] = sl
            s_idx = tier_index.get(sl, len(tiers))
            step_diff = s_idx - curr_idx  # positive = subject lags behind total tier
            if step_diff >= 1:
                drag_list.append({
                    "subject": sub,
                    "level": sl,
                    "drag_steps": step_diff,
                    "persistent": sub in persist_set,
                })
            elif step_diff <= 0:
                strength_list.append({"subject": sub, "level": sl, "lead_steps": -step_diff})
        drag_list.sort(key=lambda x: (-x["drag_steps"], not x["persistent"], x["subject"]))
        # If no subject lags in tier (e.g. all C2), fall back to top 2 weak subjects with their levels (zero scores!)
        if not drag_list:
            for w in (cs.get("weak") or [])[:2]:
                sub = w["subject"]
                sl = sub_lvls_map.get(sub)
                if sl:
                    drag_list.append({
                        "subject": sub,
                        "level": sl,
                        "drag_steps": 0,
                        "persistent": sub in persist_set,
                    })
        strength_list.sort(key=lambda x: (-x["lead_steps"], tier_index.get(x["level"], 99), x["subject"]))

        # Qualitative driver (no numeric rank delta!)
        driver_parts = []
        if ps and compare_common_subs:
            sub_step_drops = []
            sub_step_ups = []
            for sub in compare_common_subs:
                pl = (ps.get("levels") or {}).get(sub)
                cl = (cs.get("levels") or {}).get(sub)
                if pl in tier_index and cl in tier_index:
                    sd = tier_index[pl] - tier_index[cl]  # >0 improved, <0 dropped
                    if sd < 0:
                        sub_step_drops.append((abs(sd), sub))
                    elif sd > 0:
                        sub_step_ups.append((sd, sub))
            sub_step_drops.sort(reverse=True)
            sub_step_ups.sort(reverse=True)
            if status_code in ("slide", "dip") and sub_step_drops:
                driver_parts.append("、".join(s for _, s in sub_step_drops[:2]) + "降档")
            elif status_code in ("surge", "rise") and sub_step_ups:
                driver_parts.append("、".join(s for _, s in sub_step_ups[:2]) + "升档")
            elif sub_step_drops and sub_step_drops[0][0] >= 2:
                driver_parts.append(f"{sub_step_drops[0][1]}降档明显")
            elif sub_step_ups and sub_step_ups[0][0] >= 2:
                driver_parts.append(f"{sub_step_ups[0][1]}升档明显")
        driver_text = "；".join(driver_parts) if driver_parts else ("各科均衡" if ps else "—")

        is_drag = any(d["drag_steps"] >= 2 or d["persistent"] for d in drag_list)
        student_levers.append({
            "id": sid,
            "name": cs["name"],
            "level": lvl,
            "abc": abc,
            "prev_level": prev_lvl,
            "level_step": level_step,
            "transition_text": transition_text,
            "status_code": status_code,
            "status_label": status_label,
            "push_target": push_target,
            "drag_subjects": drag_list[:3],
            "strength_subjects": strength_list[:2],
            "driver_text": driver_text,
            "subject_levels": sub_lvls_map,
            "is_slide": status_code in ("slide", "dip") or (level_step is not None and level_step < 0),
            "is_push": push_target is not None,
            "is_drag": is_drag,
            "is_surge": status_code in ("surge", "rise") or (level_step is not None and level_step > 0),
        })

    # CRITICAL PRIVACY INVARIANT: Sort by (tier_index, name), NEVER by exact score or rank!
    student_levers.sort(key=lambda x: (tier_index.get(x["level"], 99), x["name"]))

    level_profile = {
        "tiers": tiers,
        "a_tiers": a_tiers,
        "c_tiers": c_tiers,
        "structure_tag": structure_tag,
        "total_distribution": total_distribution,
        "transitions": {
            "available": bool(compare_info and (up_count + same_count + down_count) > 0),
            "compare_exam": compare_info,
            "matched_count": up_count + same_count + down_count,
            "up_count": up_count,
            "same_count": same_count,
            "down_count": down_count,
            "top_flows": [
                {"flow": k, "count": v}
                for k, v in flow_pair_counts.most_common(6)
            ],
        },
        "subject_synergy": subject_synergy,
        "student_levers": student_levers,
        "counts": {
            "all": len(student_levers),
            "slide": sum(1 for x in student_levers if x["is_slide"]),
            "push": sum(1 for x in student_levers if x["is_push"]),
            "drag": sum(1 for x in student_levers if x["is_drag"]),
            "surge": sum(1 for x in student_levers if x["is_surge"]),
        },
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
        "student_comparison": student_comparison,
        "level_profile": level_profile,
        "timeline": timeline,
        "current_subject_matrix": curr_subject_matrix,
        "current_weak_summary": weak_summary_rows,
        "template_columns": {
            "leader_top": leader_top_cols,
            "teacher_top": teacher_top_cols,
        },
    }


def build_grade_brief(grade_exams: list[tuple[dict, dict]]) -> dict | None:
    """Build an executive one-page '本次三件事' brief for a grade's latest exam (vs previous exam if present)."""
    if not grade_exams:
        return None
    curr_info, curr_ana = grade_exams[-1]
    prev_info, prev_ana = grade_exams[-2] if len(grade_exams) >= 2 else (None, None)

    rules = curr_ana.get("rules") or {}
    high_ratio = float(rules.get("high_ratio") or 0.20)
    main_ratio = float(rules.get("main_ratio") or 0.40)
    border_band = int(rules.get("borderline_band") or 30)
    high_pct = f"{int(round(high_ratio * 100))}%"
    main_pct = f"{int(round(main_ratio * 100))}%"

    curr_high = _eval_ratio(curr_ana, high_ratio)
    curr_main = _eval_ratio(curr_ana, main_ratio)
    prev_main = _eval_ratio(prev_ana, main_ratio) if prev_ana else None
    prev_high = _eval_ratio(prev_ana, high_ratio) if prev_ana else None

    # 1. 进步最大 & 退步最大的班 (based on main_ratio rate delta vs previous exam, or curr main_rate if single exam)
    def _class_rates(ana: dict, ev: dict) -> dict[str, dict]:
        out = {}
        by_cls: dict[str, list[dict]] = {}
        for s in ana["students"]:
            if s.get("eligible"):
                by_cls.setdefault(s["class"], []).append(s)
        for c in ana["classes"]:
            sts = by_cls.get(c, [])
            cnt = len(sts)
            hit = sum(1 for s in sts if s["id"] in ev["elite_ids"])
            rate = rounded(100.0 * hit / cnt, 1) if cnt else 0.0
            mean_v = rounded(sum(s["total"] for s in sts) / cnt, 1) if cnt else None
            out[c] = {"class": c, "count": cnt, "hit": hit, "rate": rate, "mean": mean_v}
        return out

    curr_cls = _class_rates(curr_ana, curr_main)
    prev_cls = _class_rates(prev_ana, prev_main) if (prev_ana and prev_main) else {}
    compared_classes = []
    for c, item in curr_cls.items():
        if c in prev_cls and item["count"] > 0 and prev_cls[c]["count"] > 0:
            compared_classes.append({
                **item,
                "prev_rate": prev_cls[c]["rate"],
                "delta_rate": rounded(item["rate"] - prev_cls[c]["rate"], 1),
                "delta_hit": item["hit"] - prev_cls[c]["hit"],
            })

    if compared_classes:
        best_c = max(compared_classes, key=lambda x: (x["delta_rate"], x["rate"]))
        lag_c = min(compared_classes, key=lambda x: (x["delta_rate"], x["rate"]))
        class_mover = {
            "has_prev": True,
            "compare_name": prev_info["name"],
            "ratio_label": main_pct,
            "best": best_c,
            "lag": lag_c if lag_c["class"] != best_c["class"] else None,
        }
    else:
        valid_c = [v for v in curr_cls.values() if v["count"] > 0]
        best_c = max(valid_c, key=lambda x: (x["rate"], x["mean"] or 0)) if valid_c else None
        lag_c = min(valid_c, key=lambda x: (x["rate"], x["mean"] or 0)) if valid_c else None
        class_mover = {
            "has_prev": False,
            "compare_name": "",
            "ratio_label": main_pct,
            "best": best_c,
            "lag": lag_c if (lag_c and best_c and lag_c["class"] != best_c["class"]) else None,
        }

    # 2. 最需要会诊的学科 (widest class spread / lowest concentration rate / most lagging classes)
    sub_candidates = []
    sub_stats_map = {st["subject"]: st for st in curr_ana.get("subject_stats") or []}
    for sub in curr_ana.get("subjects") or []:
        st = sub_stats_map.get(sub) or {}
        g_mean = st.get("mean")
        ach_ids = curr_main["subject_achievers"].get(sub, set())
        conc_cnt = len(ach_ids & curr_main["elite_ids"])
        ach_cnt = len(ach_ids)
        conc_rate = rounded(100.0 * conc_cnt / ach_cnt, 1) if ach_cnt else None
        cls_means = []
        lag_classes = []
        for cs in curr_ana.get("class_stats") or []:
            sm = (cs.get("subjects") or {}).get(sub, {}).get("mean")
            if sm is not None:
                cls_means.append((cs["class"], sm))
                if g_mean is not None and g_mean > 0 and (g_mean - sm) / g_mean >= 0.035:
                    lag_classes.append((cs["class"], rounded(sm - g_mean, 1)))
        spread = rounded(max(m for _, m in cls_means) - min(m for _, m in cls_means), 1) if len(cls_means) >= 2 else 0.0
        rel_spread = (spread / g_mean * 100.0) if (g_mean and g_mean > 0) else 0.0
        # Priority score: lower concentration rate + more lagging classes + wider relative spread
        alert_score = (100.0 - (conc_rate if conc_rate is not None else 75.0)) + len(lag_classes) * 6.0 + rel_spread * 0.8
        lag_classes.sort(key=lambda x: x[1])
        sub_candidates.append({
            "subject": sub,
            "conc_rate": conc_rate,
            "mean": g_mean,
            "spread": spread,
            "weak_class_count": len(lag_classes),
            "weak_classes": [c for c, _ in lag_classes[:4]],
            "alert_score": round(alert_score, 2),
        })
    subject_alert = max(sub_candidates, key=lambda x: x["alert_score"]) if sub_candidates else None

    # 3. 临界生与单科短板盘面
    total_subs = list(rules.get("total_subjects") or curr_ana.get("subjects") or [])
    active_students = [s for s in curr_ana["students"] if s.get("eligible") and s.get("rank") is not None]
    main_k = curr_main["k"]
    high_k = curr_high["k"]
    border_main_ids = set()
    border_high_ids = set()
    single_short_ids = set()
    border_by_class: Counter = Counter()

    for s in active_students:
        rk = s["rank"]
        sid = s["id"]
        in_h = high_k < rk <= high_k + border_band
        in_m = main_k < rk <= main_k + border_band
        if in_h:
            border_high_ids.add(sid)
            miss = [sub for sub in total_subs if sid not in curr_high["subject_achievers"].get(sub, set())]
            if len(miss) == 1:
                single_short_ids.add(sid)
        if in_m:
            border_main_ids.add(sid)
            miss = [sub for sub in total_subs if sid not in curr_main["subject_achievers"].get(sub, set())]
            if len(miss) == 1:
                single_short_ids.add(sid)
        if in_h or in_m:
            border_by_class[s["class"]] += 1

    top_border_cls = border_by_class.most_common(1)[0] if border_by_class else None
    borderline_focus = {
        "high_label": f"前{high_pct}",
        "main_label": f"前{main_pct}",
        "high_count": len(curr_high["elite_ids"]),
        "main_count": len(curr_main["elite_ids"]),
        "high_delta": (len(curr_high["elite_ids"]) - len(prev_high["elite_ids"])) if prev_high else None,
        "main_delta": (len(curr_main["elite_ids"]) - len(prev_main["elite_ids"])) if prev_main else None,
        "borderline_high_count": len(border_high_ids),
        "borderline_main_count": len(border_main_ids),
        "borderline_total": len(border_high_ids | border_main_ids),
        "single_short_count": len(single_short_ids),
        "top_class": top_border_cls[0] if top_border_cls else (curr_ana["classes"][0] if curr_ana["classes"] else ""),
        "top_class_count": top_border_cls[1] if top_border_cls else 0,
    }

    return {
        "exam_id": curr_info["id"],
        "exam_name": curr_info["name"],
        "exam_date": curr_info["date"],
        "grade": curr_info["grade"],
        "class_mover": class_mover,
        "subject_alert": subject_alert,
        "borderline_focus": borderline_focus,
    }
