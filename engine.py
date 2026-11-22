"""Deterministic, versioned school score calculations.

All reported values derive from the selected rows and explicit rules. No AI or
synthetic statistics are involved, and input datasets are never mutated.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from statistics import mean, pstdev

from workbook import SUBJECT_ORDER, class_sort_key, normalize_class


ENGINE_VERSION = "1.0.0"
ABC = [("A", .30), ("B", .80), ("C", 1)]
LEVELS = [("A1", .18), ("A2", .30), ("B1", .55), ("B2", .80), ("C1", .90), ("C2", 1)]
TOP_N = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800]


def rounded(value, digits=1):
    if value is None:
        return None
    return float(Decimal(str(value)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def ranks(values, mode: str = "competition"):
    """Score -> rank. 'competition': 1, 2, 2, 4; 'dense': 1, 2, 2, 3."""
    result = {}
    if mode == "dense":
        rank_no = 0
        for value in sorted(values, reverse=True):
            if value not in result:
                rank_no += 1
                result[value] = rank_no
        return result
    for position, value in enumerate(sorted(values, reverse=True), start=1):
        result.setdefault(value, position)
    return result


def cutoff(values, k):
    if not values or not k:
        return {"score": None, "count": 0, "k": k or 0}
    score = sorted(values, reverse=True)[min(k, len(values)) - 1]
    return {"score": score, "count": sum(v >= score for v in values), "k": k}


def rank_position(n: int, ratio: float, rounding: str = "floor") -> int:
    if n <= 0:
        return 0
    exact = n * ratio
    if rounding == "ceil":
        pos = math.ceil(exact - 1e-12)
    elif rounding == "round":
        pos = int(Decimal(str(exact)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    else:
        pos = math.floor(exact + 1e-12)
    return max(1, min(n, pos))


def build_score_bins(values: list[float], step: float) -> list[dict]:
    if not values or not step or step <= 0:
        return []
    step_dec = Decimal(str(step))
    max_val = max(values)
    min_val = min(values)
    top_low = int(math.floor(max_val / float(step_dec))) * step_dec
    bot_low = int(math.floor(min_val / float(step_dec))) * step_dec
    # Cap bin count at 60 to guard against tiny steps on huge score ranges
    bins_needed = int((top_low - bot_low) / step_dec) + 1
    if bins_needed > 60:
        return []
    counts = Counter()
    for v in values:
        b = int(math.floor(v / float(step_dec))) * step_dec
        counts[b] += 1
    result = []
    cur = top_low
    while cur >= bot_low:
        hi = cur + step_dec
        lo_num = int(cur) if cur == int(cur) else float(cur)
        hi_num = int(hi) if hi == int(hi) else float(hi)
        result.append({
            "low": lo_num,
            "high": hi_num,
            "label": f"{lo_num}–{hi_num}",
            "count": counts.get(cur, 0),
        })
        cur -= step_dec
    return result


def stats(values):
    return {"count": len(values), "mean": rounded(mean(values)) if values else None,
            "max": max(values) if values else None, "min": min(values) if values else None,
            "std": rounded(pstdev(values)) if values else None}


def validate_dataset(dataset: dict, *, require_rows: bool = False) -> list[str]:
    if not isinstance(dataset, dict) or not isinstance(dataset.get("rows"), list):
        raise ValueError("成绩数据结构无效，请重新导入文件。")
    if (require_rows and not dataset["rows"]) or len(dataset["rows"]) > 50000:
        raise ValueError("单次分析支持1至50,000条学生记录。")
    subjects = dataset.get("subjects")
    if not isinstance(subjects, list) or not subjects or any(not isinstance(s, str) or not s or len(s) > 60 for s in subjects):
        raise ValueError("成绩数据缺少有效的学科清单。")
    if len(subjects) != len(set(subjects)) or len(subjects) > 40:
        raise ValueError("学科清单重复或数量超出范围。")
    ids = set()
    for row in dataset["rows"]:
        if not isinstance(row, dict) or not isinstance(row.get("scores"), dict):
            raise ValueError("学生成绩格式无效，请重新导入。")
        if not isinstance(row.get("id"), str) or not row["id"] or row["id"] in ids:
            raise ValueError("学生标识为空或重复，请重新核对成绩表。")
        ids.add(row["id"])
        if not isinstance(row.get("class"), str) or not row["class"].strip():
            raise ValueError("学生记录缺少班级。")
        for subject in subjects:
            value = row["scores"].get(subject)
            if value is not None and (not number(value) or value < 0):
                raise ValueError("成绩含无效数值或负分，请先完成数据校验。")
    for field in ("id", "name", "grade", "date", "filename"):
        if field in dataset and dataset[field] is not None:
            if not isinstance(dataset[field], str) or len(dataset[field]) > 300:
                raise ValueError("考试信息格式不正确。")
    return subjects


def _clean_bounds(raw, defaults, label_title: str) -> list[dict]:
    if raw is None:
        return [{"label": label, "pct": float(pct)} for label, pct in defaults]
    if not isinstance(raw, list) or not raw or len(raw) > 12:
        raise ValueError(f"{label_title}格式无效。")
    cleaned = []
    prev = 0.0
    for item in raw:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            label, pct = item
        elif isinstance(item, dict):
            label, pct = item.get("label") or item.get("grade"), item.get("pct")
        else:
            raise ValueError(f"{label_title}项格式无效。")
        label = str(label or "").strip()
        if not label or len(label) > 12:
            raise ValueError(f"{label_title}名称无效。")
        if not number(pct):
            raise ValueError(f"{label_title}「{label}」的比例必须是数字。")
        pct_val = float(pct) / 100.0 if float(pct) > 1 else float(pct)
        if pct_val <= prev or pct_val > 1.0001:
            raise ValueError(f"{label_title}累计比例必须严格递增且不超过100%。")
        pct_val = min(1.0, round(pct_val, 4))
        cleaned.append({"label": label, "pct": pct_val})
        prev = pct_val
    if abs(cleaned[-1]["pct"] - 1.0) > 1e-3:
        raise ValueError(f"{label_title}最后一级累计比例应为100%。")
    cleaned[-1]["pct"] = 1.0
    return cleaned


def _clean_int_list(raw, default: list[int], field_label: str, *, max_len: int = 24, max_val: int = 50000) -> list[int]:
    if raw is None:
        return list(default)
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.replace("，", ",").split(",") if p.strip()]
        raw = [int(p) for p in parts] if parts else []
    if not isinstance(raw, list) or not raw or len(raw) > max_len:
        raise ValueError(f"{field_label}应为非空的正整数列表。")
    vals = []
    for v in raw:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not float(v).is_integer() or int(v) <= 0 or int(v) > max_val:
            raise ValueError(f"{field_label}只能包含1至{max_val}的整数。")
        vals.append(int(v))
    return sorted(set(vals))


def _clean_mentor_range(raw) -> list[int] | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, str):
        text = raw.strip().replace("—", "-").replace("–", "-").replace("~", "-")
        if not text:
            return None
        parts = [p.strip() for p in text.split("-") if p.strip()]
        if len(parts) != 2 or not all(p.isdigit() for p in parts):
            raise ValueError("导师制名单名次范围格式应为“起-止”，如 180-300。")
        lo, hi = int(parts[0]), int(parts[1])
    elif isinstance(raw, (list, tuple)) and len(raw) == 2:
        if any(isinstance(v, bool) or not number(v) for v in raw):
            raise ValueError("导师制名单名次范围应为正整数。")
        lo, hi = int(raw[0]), int(raw[1])
    else:
        raise ValueError("导师制名单名次范围格式无效。")
    if lo < 1 or hi < lo or hi > 50000:
        raise ValueError("导师制名单名次范围应满足 1 ≤ 起始 ≤ 截止。")
    return [lo, hi]


PORTABLE_RULE_KEYS = (
    "cutoff_ratio", "cutoff_rounding", "high_ratio", "main_ratio", "borderline_band",
    "tie_mode", "zero_policy", "missing_policy", "shift_threshold", "warn_gap_pct",
    "top_nodes", "weak_count", "weak_rank_index", "weak_cutoffs", "mentor_range",
    "score_bin_step", "abc_bounds", "level_bounds", "full_marks",
)


def validate_portable_rules(raw: dict | None) -> dict:
    """Validate school-wide default rules independently of any single exam's classes/subjects."""
    rules = raw if isinstance(raw, dict) else {}
    ratio = rules.get("cutoff_ratio", .3)
    if not number(ratio) or not 0 < ratio <= 1:
        raise ValueError("有效分比例必须大于0且不超过100%。")
    cutoff_rounding = rules.get("cutoff_rounding", "floor")
    if cutoff_rounding not in {"floor", "round", "ceil"}:
        raise ValueError("有效分取整方式无效。")
    high_ratio = rules.get("high_ratio", .2)
    main_ratio = rules.get("main_ratio", .4)
    if not number(high_ratio) or not 0 < high_ratio <= 1 or not number(main_ratio) or not 0 < main_ratio <= 1:
        raise ValueError("班情双线比例必须大于0且不超过100%。")
    if high_ratio > main_ratio:
        high_ratio, main_ratio = main_ratio, high_ratio
    borderline_band = rules.get("borderline_band", 30)
    if isinstance(borderline_band, bool) or not number(borderline_band) or not 1 <= int(borderline_band) <= 500:
        raise ValueError("临界生带宽应为1至500的整数。")
    tie_mode = rules.get("tie_mode", "competition")
    if tie_mode not in {"competition", "dense"}:
        raise ValueError("并列名次规则无效。")
    zero_policy = rules.get("zero_policy", "exclude")
    missing_policy = rules.get("missing_policy", "exclude_total")
    if zero_policy not in {"exclude", "include"}:
        raise ValueError("零分处理规则无效。")
    if missing_policy not in {"exclude_total", "zero"}:
        raise ValueError("缺分处理规则无效。")
    shift_threshold = rules.get("shift_threshold", 50)
    if isinstance(shift_threshold, bool) or not number(shift_threshold) or not 1 <= int(shift_threshold) <= 5000:
        raise ValueError("显著进退阈值应为1至5000的整数。")
    warn_gap_pct = rules.get("warn_gap_pct", 5)
    if isinstance(warn_gap_pct, bool) or not number(warn_gap_pct) or not 0 <= float(warn_gap_pct) <= 100:
        raise ValueError("预警阈值应为0至100之间的数值。")
    top_nodes = _clean_int_list(rules.get("top_nodes"), TOP_N, "名次节点")
    weak_count = rules.get("weak_count", 4)
    if not isinstance(weak_count, int) or isinstance(weak_count, bool) or not 1 <= weak_count <= 10:
        raise ValueError("薄弱学科数量应为1至10的整数。")
    weak_rank_index = rules.get("weak_rank_index", 1)
    if isinstance(weak_rank_index, bool) or not number(weak_rank_index) or not 1 <= int(weak_rank_index) <= weak_count:
        raise ValueError(f"班级薄弱学科统计位次应为1至{weak_count}的整数。")
    weak_cutoffs = _clean_int_list(rules.get("weak_cutoffs"), [200, 400, 600], "薄弱学科名次范围", max_len=10)
    mentor_range = _clean_mentor_range(rules.get("mentor_range")) if "mentor_range" in rules else [180, 300]
    score_bin_step = rules.get("score_bin_step", 50)
    if isinstance(score_bin_step, bool) or not number(score_bin_step) or not 1 <= float(score_bin_step) <= 500:
        raise ValueError("分数段间隔应为1至500的正数。")
    abc_bounds = _clean_bounds(rules.get("abc_bounds"), ABC, "学生等级比例")
    level_bounds = _clean_bounds(rules.get("level_bounds"), LEVELS, "班情六级比例")
    raw_marks = rules.get("full_marks", {})
    if not isinstance(raw_marks, dict):
        raise ValueError("学科满分格式无效。")
    cleaned_marks = {}
    for subject, value in raw_marks.items():
        if not isinstance(subject, str) or not subject.strip() or value is None or value == "":
            continue
        if not number(value) or value <= 0:
            raise ValueError(f"{subject}满分必须为正数。")
        cleaned_marks[subject.strip()[:60]] = value
    return {
        "cutoff_ratio": float(ratio),
        "cutoff_rounding": cutoff_rounding,
        "high_ratio": float(high_ratio),
        "main_ratio": float(main_ratio),
        "borderline_band": int(borderline_band),
        "tie_mode": tie_mode,
        "zero_policy": zero_policy,
        "missing_policy": missing_policy,
        "shift_threshold": int(shift_threshold),
        "warn_gap_pct": float(warn_gap_pct),
        "top_nodes": top_nodes,
        "weak_count": weak_count,
        "weak_rank_index": int(weak_rank_index),
        "weak_cutoffs": weak_cutoffs,
        "mentor_range": mentor_range,
        "score_bin_step": int(score_bin_step) if float(score_bin_step).is_integer() else float(score_bin_step),
        "abc_bounds": abc_bounds,
        "level_bounds": level_bounds,
        "full_marks": cleaned_marks,
    }


def _validate(dataset, rules):
    subjects = validate_dataset(dataset)
    rules = rules if isinstance(rules, dict) else {}
    subject_order = rules.get("subject_order")
    if subject_order is not None:
        if not isinstance(subject_order, list) or not all(isinstance(s, str) for s in subject_order):
            raise ValueError("学科顺序格式无效。")
        ordered = [s for s in subject_order if s in subjects]
        for s in subjects:
            if s not in ordered:
                ordered.append(s)
        subjects = ordered
    classes = rules.get("classes")
    if classes is not None:
        if not isinstance(classes, list) or not classes:
            raise ValueError("请至少选择一个班级，或选择全部班级。")
        classes = sorted(set(normalize_class(c) for c in classes), key=class_sort_key)
        available = {r["class"] for r in dataset["rows"]}
        if not set(classes).issubset(available):
            raise ValueError("所选班级不在当前成绩表中，请重新选择统计范围。")
    total_subjects = rules.get("total_subjects", subjects)
    if not isinstance(total_subjects, list) or not total_subjects or not all(s in subjects for s in total_subjects):
        raise ValueError("请至少选择一门当前表中存在的总分科目。")
    total_subjects = [s for s in subjects if s in total_subjects]
    portable = validate_portable_rules(rules)
    cleaned_marks = {s: v for s, v in portable["full_marks"].items() if s in subjects}
    return subjects, {
        **portable,
        "classes": classes,
        "total_subjects": total_subjects,
        "subject_order": list(subjects),
        "full_marks": cleaned_marks,
    }


def analyze(dataset: dict, rules: dict | None = None, include_tables: bool = True) -> dict:
    subjects, rules = _validate(dataset, rules)
    selected = [r for r in dataset["rows"] if rules["classes"] is None or r["class"] in rules["classes"]]
    classes = sorted({r["class"] for r in selected}, key=class_sort_key)
    warnings = [dict(w) for w in dataset.get("warnings", []) if isinstance(w, dict)]
    students = []
    for row in selected:
        scores = {s: row["scores"].get(s) for s in subjects}
        missing = [s for s in rules["total_subjects"] if scores[s] is None]
        all_missing = len(missing) == len(rules["total_subjects"])
        total = None if missing and rules["missing_policy"] == "exclude_total" else float(sum((Decimal(str(scores[s] or 0)) for s in rules["total_subjects"]), Decimal(0)))
        eligible = total is not None and not all_missing and (total > 0 or rules["zero_policy"] == "include")
        status = "参与排名" if eligible else "总分科目缺分" if missing else "总分为0，按规则排除"
        if eligible and missing:
            status = "参与排名（缺分按0合计）"
        students.append({"id": row["id"], "source_row": row.get("source_row"), "class": row["class"],
                         "name": str(row.get("name") or f"第{row.get('source_row', '')}行"), "scores": scores,
                         "total": total, "rank": None, "class_rank": None, "ranks": {}, "grades": {},
                         "levels": {}, "weak": [], "eligible": eligible, "status": status,
                         "identity_reliable": bool(row.get("identity_reliable", False))})
    active = [s for s in students if s["eligible"]]
    n = len(active)
    rounding = rules["cutoff_rounding"]
    k = rank_position(n, rules["cutoff_ratio"], rounding)
    totals = [s["total"] for s in active]
    tie_mode = rules["tie_mode"]
    rank_total = ranks(totals, mode=tie_mode)
    by_class = {cls: [s for s in active if s["class"] == cls] for cls in classes}
    class_rank_maps = {cls: ranks([s["total"] for s in members], mode=tie_mode) for cls, members in by_class.items()}
    subject_values = {subject: [s["scores"][subject] for s in active if s["scores"][subject] is not None] for subject in subjects}
    subject_ranks = {subject: ranks(values, mode=tie_mode) for subject, values in subject_values.items()}
    cutoffs = {"总分": cutoff(totals, k), **{subject: cutoff(values, k) for subject, values in subject_values.items()}}
    grade_bounds = {}
    level_bounds = {}
    abc_cfg = [(item["label"], item["pct"]) for item in rules["abc_bounds"]]
    lvl_cfg = [(item["label"], item["pct"]) for item in rules["level_bounds"]]
    for subject, values in {"总分": totals, **subject_values}.items():
        grade_bounds[subject] = [(label, cutoff(values, rank_position(n, pct, rounding))["score"]) for label, pct in abc_cfg]
        level_bounds[subject] = [(label, cutoff(values, rank_position(n, pct, rounding))["score"]) for label, pct in lvl_cfg]
    def label_for(value, bounds):
        if value is None:
            return None
        return next((label for label, boundary in bounds if boundary is not None and value >= boundary), None)
    weak_order = {subject: i for i, subject in enumerate(subjects)}
    for student in active:
        student["rank"] = rank_total[student["total"]]
        student["class_rank"] = class_rank_maps[student["class"]][student["total"]]
        student["grades"]["总分"] = label_for(student["total"], grade_bounds["总分"])
        student["levels"]["总分"] = label_for(student["total"], level_bounds["总分"])
        weak = []
        for subject in subjects:
            score = student["scores"][subject]
            rank = subject_ranks[subject].get(score) if score is not None else None
            student["ranks"][subject] = rank
            student["grades"][subject] = label_for(score, grade_bounds[subject])
            student["levels"][subject] = label_for(score, level_bounds[subject])
            if rank is not None and subject != "体育":
                weak.append({"subject": subject, "gap": student["rank"] - rank, "rank": rank, "score": score})
        student["weak"] = sorted(weak, key=lambda x: (x["gap"], weak_order[x["subject"]]))[:rules["weak_count"]]
    students.sort(key=lambda s: (s["rank"] is None, s["rank"] or 0, class_sort_key(s["class"]), s.get("source_row") or 0, s["id"]))
    elite_ids = {s["id"] for s in active if cutoffs["总分"]["score"] is not None and s["total"] >= cutoffs["总分"]["score"]}
    achieved = {subject: {s["id"] for s in active if s["scores"][subject] is not None and cutoffs[subject]["score"] is not None and s["scores"][subject] >= cutoffs[subject]["score"]} for subject in subjects}
    def subject_stat(subject, members):
        values = [s["scores"][subject] for s in members if s["scores"][subject] is not None and (s["scores"][subject] > 0 or rules["zero_policy"] == "include")]
        result = stats(values)
        ids = {s["id"] for s in members}
        full_mark = rules["full_marks"].get(subject)
        result.update({"subject": subject, "cutoff": cutoffs[subject]["score"], "achievers": len(ids & achieved[subject]),
                       "concentrated": len(ids & achieved[subject] & elite_ids), "full_mark": full_mark,
                       "score_rate": rounded(mean(values) / full_mark * 100) if full_mark and values else None})
        return result
    subject_stats = [subject_stat(subject, active) for subject in subjects]
    class_stats = []
    top_nodes = rules["top_nodes"]
    for cls in classes:
        members = by_class[cls]
        result = stats([s["total"] for s in members])
        result.update({"class": cls, "registered": sum(s["class"] == cls for s in students), "participants": len(members),
                       "elite_count": sum(s["id"] in elite_ids for s in members),
                       "subjects": {subject: subject_stat(subject, members) for subject in subjects},
                       "top": {str(top): sum(s["rank"] <= top for s in members) for top in top_nodes}})
        class_stats.append(result)
    summary = stats(totals)
    summary.update({"registered": len(students), "participants": n, "excluded": len(students) - n,
                    "class_count": len(classes), "cutoff_rank": k, "cutoff": cutoffs["总分"]["score"], "elite_count": len(elite_ids)})
    total_full_mark = sum(rules["full_marks"].get(s, 0) for s in rules["total_subjects"])
    full_marks_complete = all(s in rules["full_marks"] for s in rules["total_subjects"])
    summary["full_mark"] = total_full_mark if full_marks_complete else None
    summary["score_rate"] = rounded(mean(totals) / total_full_mark * 100) if full_marks_complete and total_full_mark and totals else None
    for cls in class_stats:
        cls["score_rate"] = rounded(cls["mean"] / total_full_mark * 100) if full_marks_complete and cls["mean"] is not None and total_full_mark else None
    excluded_counts = Counter(s["status"] for s in students if not s["eligible"])
    for reason, count in excluded_counts.items():
        warnings.append({"level": "warning", "message": f"当前范围{count}人未参与总分、单科排名和分层：{reason}。"})
    for subject, maximum in rules["full_marks"].items():
        rows_over = [s for s in students if s["scores"][subject] is not None and s["scores"][subject] > maximum]
        if rows_over:
            warnings.append({"level": "error", "subject": subject, "message": f"{subject}有{len(rows_over)}人成绩超过所设满分{maximum}；成绩仍保留，请核对满分或原始分数。"})
    if n and n * rules["cutoff_ratio"] < 1:
        warnings.append({"level": "info", "message": "当前样本较少，比例对应位置不足1，参考位置按第1名处理。"})
    if not full_marks_complete:
        warnings.append({"level": "info", "message": "尚未确认全部总分科目的满分；只报告原始分数，不推算总分得分率。"})
    if not n:
        warnings.append({"level": "warning", "message": "当前规则下没有可参与排名的记录，请查看缺分和零分规则。"})
    if rules["missing_policy"] == "zero":
        warnings.append({"level": "info", "message": "已选择缺分按0合计；原始空值仍保留，缺失科目的单科排名与等级留空，不伪造单科0分。"})
    score_bins = build_score_bins(totals, rules["score_bin_step"])
    metadata = {key: str(dataset.get(key) or "") for key in ("name", "grade", "date", "filename")}
    analysis = {"dataset_id": dataset.get("id"), "engine_version": ENGINE_VERSION, "metadata": metadata, "rules": rules,
                "subjects": subjects, "classes": classes, "summary": summary, "cutoffs": cutoffs,
                "grade_boundaries": {s: [{"grade": label, "score": value} for label, value in b] for s, b in grade_bounds.items()},
                "level_boundaries": {s: [{"grade": label, "score": value} for label, value in b] for s, b in level_bounds.items()},
                "score_bins": score_bins,
                "subject_stats": subject_stats, "class_stats": class_stats, "students": students, "warnings": warnings}
    analysis["tables"] = make_tables(analysis) if include_tables else []
    return analysis


def make_tables(a):
    subjects, students, summary, rules = a["subjects"], a["students"], a["summary"], a["rules"]
    scope = "、".join(a["classes"]) + "班"
    note = f"{a['metadata']['grade']} · {a['metadata']['name']} · {scope}；总分科目：{'、'.join(rules['total_subjects'])}。同分同名次，边界同分全纳入。"
    tables = []
    def add(identifier, title, columns, rows, extra=""):
        tables.append({"id": identifier, "title": title, "columns": columns, "rows": rows, "note": note + (" " + extra if extra else "")})
    add("scores", "成绩与排名", ["年级名次", "班级", "姓名或原表行号", "总分", "班内名次"] + [value for s in subjects for value in (s, s + "名次")] + ["状态"],
        [[s["rank"], s["class"], s["name"], s["total"], s["class_rank"]] + [value for subject in subjects for value in (s["scores"][subject], s["ranks"].get(subject))] + [s["status"]] for s in students])
    abc_text = "、".join(f"{item['label']}:{item['pct'] * 100:g}%" for item in rules["abc_bounds"])
    lvl_text = "、".join(f"{item['label']}:{item['pct'] * 100:g}%" for item in rules["level_bounds"])
    for identifier, title, key, explanation in [("abc", "ABC等级", "grades", f"累计边界 {abc_text}；缺失或未纳入排名的记录留空。"),
                                               ("levels", "六层等级", "levels", f"累计边界 {lvl_text}；不计表头人数。")]:
        add(identifier, title, ["班级", "姓名或原表行号", "总分等级"] + subjects + ["状态"],
            [[s["class"], s["name"], s[key].get("总分")] + [s[key].get(subject) for subject in subjects] + [s["status"]] for s in students], explanation)
    add("cutoffs", "有效分分界", ["科目", "参考位置", "分界分数", "达到分界人数"],
        [[subject, a["cutoffs"][subject]["k"], a["cutoffs"][subject]["score"], a["cutoffs"][subject]["count"]] for subject in ["总分"] + subjects],
        f"各科独立按前{rules['cutoff_ratio'] * 100:g}%；使用实际参与人数{summary['participants']}，边界并列可使达标人数超过比例。")
    effective_rows = [[c["class"], c["participants"], c["elite_count"]] + [v for subject in subjects for v in (c["subjects"][subject]["achievers"], c["subjects"][subject]["concentrated"])] for c in a["class_stats"]]
    effective_rows.append(["合计", summary["participants"], summary["elite_count"]] + [v for s in a["subject_stats"] for v in (s["achievers"], s["concentrated"])])
    add("effective", "有效分达标与集中人数", ["班级", "参考人数", "总分优生数"] + [v for subject in subjects for v in (subject + "达标", subject + "集中")], effective_rows,
        "集中数为总分达标与该学科达标的交集；只展示人数，未猜测学校比率分母。")
    class_rows = []
    for c in a["class_stats"]:
        class_rows.append([c["class"], "总分", c["registered"], c["participants"], c["mean"], c["max"], c["min"], c["std"], c["elite_count"], c["elite_count"]])
        for subject in subjects:
            st = c["subjects"][subject]
            class_rows.append([c["class"], subject, c["registered"], st["count"], st["mean"], st["max"], st["min"], st["std"], st["achievers"], st["concentrated"]])
    add("class_stats", "班级学科统计", ["班级", "科目", "导入人数", "有效人数", "平均分", "最高分", "最低分", "总体标准差", "达标数", "集中数"], class_rows,
        "学科统计基于总分有效人群；均分、极值和标准差共用所选零分规则，避免旧表指标分母不一致。")
    top_nodes = rules["top_nodes"]
    add("segments", "前N名累计人数", ["班级"] + [f"前{n}名" for n in top_nodes],
        [[c["class"]] + [c["top"][str(n)] for n in top_nodes] for c in a["class_stats"]] + [["合计"] + [sum(c["top"][str(n)] for c in a["class_stats"]) for n in top_nodes]],
        "累计统计名次≤N，同分可以超过N人；不是互斥的名次区间。")
    weak_rows = []
    for s in students:
        row = [s["class"], s["name"], s["rank"]]
        for i in range(rules["weak_count"]):
            item = s["weak"][i] if i < len(s["weak"]) else {}
            row.extend([item.get("subject"), item.get("score"), item.get("rank"), item.get("gap")])
        weak_rows.append(row)
    add("weak", "薄弱学科", ["班级", "姓名或原表行号", "总分名次"] + [name for i in range(1, rules["weak_count"] + 1) for name in (f"薄弱科{i}", f"分数{i}", f"单科名次{i}", f"名次差{i}")], weak_rows,
        "按总分名次−单科名次升序，差值并列依所设学科顺序选不同学科；体育不参与，缺分不选。此为相对位次描述。")
    add("quality", "数据核验", ["级别", "原表行号", "学科", "核验说明"],
        [[{"info": "说明", "warning": "待核对", "error": "异常"}.get(w.get("level"), "说明"), w.get("row"), w.get("subject"), w.get("message")] for w in a["warnings"]] or [["通过", None, None, "未发现可自动识别的输入异常。"]])
    mentor_text = f"{rules['mentor_range'][0]}-{rules['mentor_range'][1]}名" if rules.get("mentor_range") else "未启用"
    add("rules", "本次计算口径", ["项目", "内容"], [
        ["计算引擎版本", a["engine_version"]], ["来源文件", a["metadata"]["filename"]], ["考试名称", a["metadata"]["name"]],
        ["年级", a["metadata"]["grade"]], ["考试日期", a["metadata"]["date"]], ["统计班级", scope],
        ["导入人数", summary["registered"]], ["参与排名人数", summary["participants"]], ["排除人数", summary["excluded"]],
        ["总分科目", "、".join(rules["total_subjects"])],
        ["并列名次", "跳号（1, 1, 3）" if rules["tie_mode"] == "competition" else "不跳号密集排名（1, 1, 2）"],
        ["零分规则", "均分/人数/标准差排除0；全零总分不排名" if rules["zero_policy"] == "exclude" else "有有效成绩记录的真实0分计入人数和统计"],
        ["缺分规则", "总分科目缺分则不参与总分与单科排名" if rules["missing_policy"] == "exclude_total" else "缺分按0合计；原始缺分与单科名次仍留空；全缺分不排名"],
        ["学科排名", "总分有效人群内，有数值的单科成绩均参与排名（包含0）；没有分数的不排名"],
        ["有效分算法", f"各科独立前{rules['cutoff_ratio'] * 100:g}%（{'向下取整' if rules['cutoff_rounding'] == 'floor' else '四舍五入' if rules['cutoff_rounding'] == 'round' else '向上取整'}；班情双线：前{rules['high_ratio'] * 100:g}% / 前{rules['main_ratio'] * 100:g}%）；临界生带宽 ±{rules['borderline_band']} 名"],
        ["学生等级比例", abc_text], ["班情六级比例", lvl_text],
        ["名次节点", ",".join(str(x) for x in top_nodes)],
        ["薄弱科规则", f"每人列{rules['weak_count']}科；班级统计按第{rules['weak_rank_index']}薄弱；名次范围{','.join(str(x) for x in rules['weak_cutoffs'])}；不含体育"],
        ["导师制与预警", f"导师制名次 {mentor_text}；显著进退 ≥ {rules['shift_threshold']} 名；预警阈值 {rules['warn_gap_pct']:g} 个百分点；分数段间隔 {rules['score_bin_step']} 分"],
        ["满分设置", "；".join(f"{s}：{m}" for s, m in rules["full_marks"].items()) or "未设置，不推算得分率"],
        ["未提供的信息", "本次单表不推造历史成绩、体育分数、教师归属、学校人工目标或未知排名来源"],
    ])
    return tables
