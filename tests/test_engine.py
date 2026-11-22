"""Business-rule tests; run with: python -m unittest discover -s tests -v."""
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import openpyxl

from engine import analyze, ranks
from workbook import normalize_class, parse_workbook


def dataset(scores, subjects=("语文", "数学")):
    return {"id": "test", "name": "规则测试", "grade": "初三", "date": "2026-10-27", "filename": "test.xlsx",
            "subjects": list(subjects), "warnings": [],
            "rows": [{"id": f"student:{i}", "source_row": i + 2, "class": cls, "name": f"学生{i}",
                      "scores": dict(zip(subjects, values)), "identity_reliable": True}
                     for i, (cls, values) in enumerate(scores)]}


class ImportTests(unittest.TestCase):
    def test_csv_missing_numeric_and_anonymous(self):
        content = "班级,语文,数学\n1,80,缺考\n2,0,12.5\n".encode("utf-8-sig")
        d = parse_workbook(content, "成绩.csv")
        self.assertEqual(d["classes"], ["01", "02"])
        self.assertEqual(d["rows"][0]["name"], "第2行")
        self.assertFalse(d["rows"][0]["identity_reliable"])
        self.assertIsNone(d["rows"][0]["scores"]["数学"])
        self.assertEqual(d["rows"][1]["scores"]["语文"], 0)
        self.assertEqual(d["rows"][1]["scores"]["数学"], 12.5)

    def test_csv_gb18030_and_stable_id(self):
        content = "班级,学号,姓名,道德与法治,英语成绩\n01,0001,测试甲,60,110\n".encode("gb18030")
        d = parse_workbook(content, "测试.csv")
        self.assertEqual(d["subjects"], ["英语", "政治"])
        self.assertEqual(d["rows"][0]["id"], "student:0001")
        self.assertTrue(d["rows"][0]["identity_reliable"])

    def test_duplicate_identity_rejected(self):
        content = "班级,学号,语文\n01,0001,90\n02,0001,100\n".encode()
        with self.assertRaisesRegex(ValueError, "标识重复"):
            parse_workbook(content, "重复.csv")

    def test_non_numeric_and_negative_are_missing_with_errors(self):
        content = "班级,姓名,语文,数学\n01,测试甲,=1+1,-2\n".encode()
        d = parse_workbook(content, "异常.csv")
        self.assertEqual(d["rows"][0]["scores"], {"语文": None, "数学": None})
        self.assertEqual(sum(w["level"] == "error" for w in d["warnings"]), 2)

    def test_prefers_raw_sheet_and_scans_title_rows(self):
        book = openpyxl.Workbook()
        book.active.title = "成绩汇总"
        book.active.append(["班级", "姓名", "语文", "数学"])
        book.active.append([1, "测试甲", 1, 1])
        raw = book.create_sheet("原始成绩")
        raw.append(["某次考试"])
        raw.append(["班级", "姓名", "语文（150分）", "数学分数"])
        raw.append([1, "测试甲", 100, 110])
        output = io.BytesIO()
        book.save(output)
        d = parse_workbook(output.getvalue(), "原始.xlsx")
        self.assertEqual(d["mapping"]["sheet"], "原始成绩")
        self.assertEqual(d["mapping"]["header_row"], 2)
        self.assertEqual(d["rows"][0]["scores"]["数学"], 110)

    def test_missing_class_cannot_be_silently_skipped(self):
        with self.assertRaisesRegex(ValueError, "缺少班级"):
            parse_workbook("班级,姓名,语文\n,测试甲,100\n".encode(), "缺班.csv")

    def test_classes(self):
        self.assertEqual(normalize_class("初三（1）班"), "01")
        self.assertEqual(normalize_class(2), "02")
        self.assertEqual(normalize_class("高一(3)班"), "03")
        self.assertEqual(normalize_class("高二12班"), "12")
        self.assertEqual(normalize_class("初2027届（5）班"), "05")
        self.assertEqual(normalize_class("七（4）班"), "04")
        self.assertEqual(normalize_class("九年级一班"), "01")
        self.assertEqual(normalize_class("高三十一班"), "11")
        self.assertEqual(normalize_class("实验班"), "实验班")

    def test_summary_in_name_exam_id_and_unrecognized_columns(self):
        content = "班级,考号,姓名,语文,数学,日语\n高一(1)班,K001,测试甲,100,110,95\n,,年级平均,100,110,95\n".encode("utf-8")
        d = parse_workbook(content, "高一测试.csv")
        self.assertEqual(len(d["rows"]), 1)
        self.assertEqual(d["classes"], ["01"])
        self.assertEqual(d["mapping"]["exam_id"], 2)
        self.assertEqual(d["mapping"]["unrecognized"], ["日语"])
        messages = [w["message"] for w in d["warnings"]]
        self.assertTrue(any("汇总行" in m for m in messages))
        self.assertTrue(any("考号列" in m for m in messages))
        self.assertTrue(any("日语" in m for m in messages))


class CalculationTests(unittest.TestCase):
    def test_competition_ranks_and_boundary_ties(self):
        self.assertEqual(ranks([100, 98, 98, 96]), {100: 1, 98: 2, 96: 4})
        a = analyze(dataset([("01", [100, 100]), ("01", [90, 90]), ("02", [90, 90]), ("02", [80, 80])]), {"cutoff_ratio": .5})
        self.assertEqual(a["summary"]["cutoff_rank"], 2)
        self.assertEqual(a["summary"]["elite_count"], 3)
        self.assertEqual([s["rank"] for s in a["students"]], [1, 2, 2, 4])
        self.assertEqual(a["students"][1]["class_rank"], 2)
        self.assertEqual(a["students"][2]["class_rank"], 1)

    def test_missing_and_zero_policies_preserve_sources(self):
        d = dataset([("01", [0, 0]), ("01", [100, None]), ("01", [100, 0])])
        default = analyze(d)
        self.assertEqual(default["summary"]["registered"], 3)
        self.assertEqual(default["summary"]["participants"], 1)
        included = analyze(d, {"zero_policy": "include", "missing_policy": "zero"})
        self.assertEqual(included["summary"]["participants"], 3)
        blank = next(s for s in included["students"] if s["id"] == "student:1")
        self.assertEqual(blank["total"], 100)
        self.assertIsNone(blank["scores"]["数学"])
        self.assertIsNone(blank["ranks"]["数学"])
        self.assertIsNone(d["rows"][1]["scores"]["数学"])

    def test_all_missing_does_not_become_a_participant(self):
        a = analyze(dataset([("01", [None, None])]), {"zero_policy": "include", "missing_policy": "zero"})
        self.assertEqual(a["summary"]["participants"], 0)
        self.assertIsNone(a["summary"]["cutoff"])
        self.assertEqual(len(a["tables"]), 10)

    def test_weak_ties_are_unique_and_pe_excluded(self):
        a = analyze(dataset([("01", [100, 100, 100, 100, 50]), ("01", [80, 80, 80, 80, 50])], ("语文", "数学", "英语", "物理", "体育")))
        for s in a["students"]:
            names = [w["subject"] for w in s["weak"]]
            self.assertEqual(names, ["语文", "数学", "英语", "物理"])
            self.assertEqual(len(names), len(set(names)))

    def test_cohort_filter_recomputes_everything(self):
        d = dataset([("01", [10, 10]), ("02", [20, 20]), ("03", [100, 100])])
        a = analyze(d, {"classes": ["01", "02"], "cutoff_ratio": .5})
        self.assertEqual(a["summary"]["registered"], 2)
        self.assertEqual(a["summary"]["cutoff"], 40)
        self.assertEqual(a["classes"], ["01", "02"])
        self.assertEqual(sum(c["participants"] for c in a["class_stats"]), a["summary"]["participants"])
        self.assertEqual(a["students"][0]["rank"], 1)

    def test_intersection_and_full_marks(self):
        a = analyze(dataset([("01", [100, 10]), ("02", [80, 80]), ("02", [10, 100])]), {"cutoff_ratio": .34, "full_marks": {"语文": 100, "数学": 100}})
        self.assertEqual(a["summary"]["elite_count"], 1)
        for item in a["subject_stats"]:
            self.assertLessEqual(item["concentrated"], item["achievers"])
            self.assertLessEqual(item["concentrated"], a["summary"]["elite_count"])
        self.assertEqual(a["subject_stats"][0]["concentrated"], 0)
        self.assertIsNotNone(a["summary"]["score_rate"])
        self.assertIsNone(analyze(dataset([("01", [100, 100])]))["summary"]["score_rate"])

    def test_true_student_count_not_header_count(self):
        values = [("01", [100-i, 100-i]) for i in range(6)]
        a = analyze(dataset(values))
        # floor(6*.8)=4; an extra header would incorrectly make the B boundary 5.
        math_bounds = {x["grade"]: x["score"] for x in a["grade_boundaries"]["数学"]}
        self.assertEqual(math_bounds["B"], 97)

    def test_decimal_sum_preserves_ties_without_arbitrary_rounding(self):
        a = analyze(dataset([("01", [.1, .2]), ("01", [.3, 0]), ("01", [.10001, .2])]))
        self.assertEqual(a["students"][0]["total"], .30001)
        self.assertEqual([s["rank"] for s in a["students"]], [1, 2, 2])

    def test_custom_rules_tie_mode_grade_bounds_top_nodes_and_order(self):
        self.assertEqual(ranks([100, 98, 98, 96], "dense"), {100: 1, 98: 2, 96: 3})
        rows = [("01", [100 - i * 5, 90 - i * 4]) for i in range(10)]
        rows[2] = ("01", [95, 86])  # tie with index 1
        d = dataset(rows, ("语文", "数学"))
        rules = {
            "tie_mode": "dense",
            "subject_order": ["数学", "语文"],
            "top_nodes": [2, 5, 8],
            "abc_bounds": [["A", 0.3], ["B", 0.7], ["C", 1.0]],
            "level_bounds": [["A1", 0.2], ["A2", 0.4], ["B1", 0.6], ["B2", 0.8], ["C1", 0.9], ["C2", 1.0]],
            "high_ratio": 0.2,
            "main_ratio": 0.4,
            "borderline_band": 15,
            "shift_threshold": 30,
            "warn_gap_pct": 6,
            "weak_rank_index": 2,
            "weak_cutoffs": [100, 300, 500],
            "mentor_range": [2, 6],
            "score_bin_step": 25,
        }
        a = analyze(d, rules)
        self.assertEqual(a["subjects"], ["数学", "语文"])
        self.assertEqual(a["rules"]["tie_mode"], "dense")
        self.assertEqual(a["rules"]["top_nodes"], [2, 5, 8])
        self.assertEqual(a["rules"]["mentor_range"], [2, 6])
        self.assertEqual(a["rules"]["weak_rank_index"], 2)
        self.assertEqual(a["rules"]["weak_cutoffs"], [100, 300, 500])
        # Dense ranking: 1, 2, 2, 3 (not 1, 2, 2, 4)
        self.assertEqual([s["rank"] for s in a["students"][:4]], [1, 2, 2, 3])
        # Custom grade bounds: math scores sorted = [90, 86, 86, 78, 74, 70, 66, 62, 58, 54]
        # A=30% (3rd) => 86, B=70% (7th) => 66; A1=20% (2nd) => 86, A2=40% (4th) => 78
        math_abc = {g["grade"]: g["score"] for g in a["grade_boundaries"]["数学"]}
        self.assertEqual(math_abc["A"], 86)
        self.assertEqual(math_abc["B"], 66)
        math_lvl = {g["grade"]: g["score"] for g in a["level_boundaries"]["数学"]}
        self.assertEqual(math_lvl["A1"], 86)
        self.assertEqual(math_lvl["A2"], 78)
        self.assertEqual(set(a["class_stats"][0]["top"].keys()), {"2", "5", "8"})
        self.assertEqual(len(a["tables"]), 10)
        self.assertTrue(len(a["score_bins"]) >= 1)
        self.assertEqual(sum(b["count"] for b in a["score_bins"]), 10)

    def test_cutoff_rounding_four_tier_abcd_and_disabled_mentor(self):
        # 5 students with 30% => exact 1.5 -> floor=1, round=2, ceil=2
        rows = [("01", [100 - i * 10, 100 - i * 10]) for i in range(5)]
        d = dataset(rows, ("语文", "数学"))
        a_floor = analyze(d, {"cutoff_ratio": 0.3, "cutoff_rounding": "floor", "mentor_range": None})
        a_round = analyze(d, {"cutoff_ratio": 0.3, "cutoff_rounding": "round"})
        a_ceil = analyze(d, {"cutoff_ratio": 0.3, "cutoff_rounding": "ceil", "abc_bounds": [["A", 0.25], ["B", 0.55], ["C", 0.85], ["D", 1.0]]})
        self.assertEqual(a_floor["summary"]["cutoff_rank"], 1)
        self.assertEqual(a_round["summary"]["cutoff_rank"], 2)
        self.assertEqual(a_ceil["summary"]["cutoff_rank"], 2)
        self.assertIsNone(a_floor["rules"]["mentor_range"])
        self.assertEqual([g["grade"] for g in a_ceil["grade_boundaries"]["总分"]], ["A", "B", "C", "D"])

    def test_include_tables_false_skips_tables_without_changing_stats(self):
        d = dataset([("01", [95, 85]), ("02", [75, 90])])
        full = analyze(d)
        lite = analyze(d, include_tables=False)
        self.assertEqual(lite["tables"], [])
        self.assertEqual(lite["summary"], full["summary"])
        self.assertEqual(lite["subject_stats"], full["subject_stats"])
        self.assertEqual(lite["class_stats"], full["class_stats"])
        self.assertEqual(lite["students"], full["students"])

    def test_invalid_rules_rejected(self):
        d = dataset([("01", [50, 60])])
        for rule in ({"classes": []}, {"classes": ["99"]}, {"cutoff_ratio": 0}, {"total_subjects": []}, {"full_marks": {"语文": 0}}):
            with self.subTest(rule=rule), self.assertRaises(ValueError):
                analyze(d, rule)


class RealWorkbookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[2] / "原始数据.xlsx"
        if not path.exists():
            raise unittest.SkipTest("没有随环境提供原始数据.xlsx")
        cls.data = parse_workbook(path.read_bytes(), path.name, {"name": "初三定时二", "grade": "初三"})

    def test_full_22_class_baseline(self):
        a = analyze(self.data)
        self.assertEqual(len(self.data["rows"]), 967)
        self.assertEqual(a["summary"]["participants"], 942)
        self.assertEqual(a["summary"]["cutoff"], 521.5)
        self.assertEqual(a["summary"]["elite_count"], 283)
        self.assertEqual(a["cutoffs"]["数学"]["score"], 118)
        self.assertEqual(a["cutoffs"]["数学"]["count"], 285)
        self.assertEqual(a["cutoffs"]["语文"]["count"], 289)
        self.assertEqual(sum(c["participants"] for c in a["class_stats"]), 942)
        self.assertEqual(sum(c["elite_count"] for c in a["class_stats"]), 283)
        self.assertFalse(any(s["identity_reliable"] for s in a["students"]))

    def test_20_class_baseline_and_no_duplicate_weak(self):
        a = analyze(self.data, {"classes": [f"{i:02d}" for i in range(1, 21)]})
        self.assertEqual(a["summary"]["registered"], 900)
        self.assertEqual(a["summary"]["participants"], 878)
        self.assertEqual(a["summary"]["cutoff"], 527)
        self.assertEqual(a["summary"]["elite_count"], 264)
        self.assertEqual(a["cutoffs"]["数学"]["score"], 119)
        self.assertEqual(a["cutoffs"]["数学"]["count"], 264)
        self.assertEqual(a["cutoffs"]["语文"]["count"], 288)
        for student in a["students"]:
            weak = [item["subject"] for item in student["weak"]]
            self.assertEqual(len(weak), len(set(weak)))
        for subject in a["subject_stats"]:
            self.assertEqual(sum(c["subjects"][subject["subject"]]["achievers"] for c in a["class_stats"]), subject["achievers"])


if __name__ == "__main__":
    unittest.main()
