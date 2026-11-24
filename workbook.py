"""Read score workbooks without altering the uploaded source."""
from __future__ import annotations

import csv
import io
import math
import re
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

import openpyxl


SUBJECT_ORDER = ["语文", "数学", "英语", "物理", "化学", "政治", "历史", "地理", "生物", "体育", "信息技术", "科学", "音乐", "美术", "劳动"]
SUBJECT_ALIASES = {s: s for s in SUBJECT_ORDER}
SUBJECT_ALIASES.update({"道德与法治": "政治", "道法": "政治", "道德法治": "政治", "思品": "政治", "思想品德": "政治", "政治与法治": "政治", "外语": "英语", "信息科技": "信息技术"})
CLASS_HEADERS = {"班级", "班号", "班别", "行政班", "教学班", "班级名称", "班"}
NAME_HEADERS = {"姓名", "学生姓名", "名字", "学生"}
ID_HEADERS = {"学号", "学生编号", "学生id", "学生代码", "学籍号", "学籍号码"}
EXAM_ID_HEADERS = {"考号", "准考证号", "考试号", "考试编号"}
SUMMARY_WORDS = {"合计", "总计", "平均", "平均分", "年级", "全年级", "全校", "汇总", "年级平均", "全校平均", "总平均"}
IGNORED_HEADERS = {"序号", "编号", "性别", "备注", "说明", "状态", "类别", "层次", "选科", "组合", "学校", "校区", "年级", "届别", "考场", "座号", "座位号"}
DERIVED_TOKENS = ("排名", "名次", "等级", "得分率", "平均", "总分", "总成绩", "标准分", "赋分", "进退", "弱科", "薄弱", "达标", "集中", "优生")
MISSING_WORDS = {"", "缺考", "缺", "未考", "旷考", "缓考", "免考", "未录入", "缺失", "待录入", "无", "--", "-", "—", "/", "na", "n/a", "null", "none"}
MAX_ROWS = 50000
MAX_COLUMNS = 256
_CN_DIGITS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _cn_int(token: str) -> int | None:
    if not token:
        return None
    if token == "十":
        return 10
    if token.startswith("十") and len(token) == 2 and token[1] in _CN_DIGITS:
        return 10 + _CN_DIGITS[token[1]]
    if token.endswith("十") and len(token) == 2 and token[0] in _CN_DIGITS:
        return _CN_DIGITS[token[0]] * 10
    if len(token) == 3 and token[1] == "十" and token[0] in _CN_DIGITS and token[2] in _CN_DIGITS:
        return _CN_DIGITS[token[0]] * 10 + _CN_DIGITS[token[2]]
    if len(token) == 1 and token in _CN_DIGITS:
        return _CN_DIGITS[token]
    return None


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def normalize_class(value: Any) -> str:
    text = _text(value)
    text = re.sub(r"[\s\u3000]", "", text)
    grade_prefix = r"(?:(?:初|高)?\d{2,4}[届级]|[初高][一二三]|[一二三四五六七八九十]+年级|\d+年级)"
    matched = re.fullmatch(rf"{grade_prefix}?[（(]?(\d+)[）)]?班?", text)
    if not matched:
        matched = re.fullmatch(r"[七八九][（(](\d+)[）)]班?", text)
    if matched:
        return str(int(matched.group(1))).zfill(2)
    cn_match = re.fullmatch(rf"{grade_prefix}?[（(]?([一二三四五六七八九十]{{1,3}})[）)]?班", text)
    if cn_match:
        num = _cn_int(cn_match.group(1))
        if num is not None:
            return str(num).zfill(2)
    return text


def _header(value: Any) -> str:
    text = _text(value).lower()
    text = re.sub(r"[\s\u3000]", "", text)
    text = re.sub(r"[（(\[].*?[）)\]]", "", text)
    return text


def _subject(value: Any) -> str | None:
    header = _header(value)
    if any(token in header for token in ("排名", "名次", "等级", "得分率", "平均", "总分", "总成绩", "标准分", "赋分")):
        return None
    for tail in ("原始成绩", "原始分", "成绩", "分数", "得分"):
        if header.endswith(tail):
            header = header[:-len(tail)]
            break
    return SUBJECT_ALIASES.get(header)


def _find_header(rows: list[list[Any]]) -> tuple[int, dict] | None:
    candidates = []
    for row_index, row in enumerate(rows[:20]):
        columns: dict[str, Any] = {"subjects": {}}
        duplicate_subjects = []
        used_indices = set()
        for index, cell in enumerate(row[:MAX_COLUMNS]):
            header = _header(cell)
            if header in CLASS_HEADERS:
                columns.setdefault("class", index)
                used_indices.add(index)
            elif header in NAME_HEADERS:
                columns.setdefault("name", index)
                used_indices.add(index)
            elif header in ID_HEADERS:
                columns.setdefault("id", index)
                used_indices.add(index)
            elif header in EXAM_ID_HEADERS:
                columns.setdefault("exam_id", index)
                used_indices.add(index)
            subject = _subject(cell)
            if subject:
                if subject in columns["subjects"]:
                    duplicate_subjects.append(subject)
                columns["subjects"][subject] = index
                used_indices.add(index)
        if "class" in columns and columns["subjects"]:
            unrecognized = []
            for index, cell in enumerate(row[:MAX_COLUMNS]):
                if index in used_indices:
                    continue
                raw_label = _text(cell)
                header = _header(cell)
                if not header or header in IGNORED_HEADERS or any(tok in header for tok in DERIVED_TOKENS):
                    continue
                if raw_label not in unrecognized:
                    unrecognized.append(raw_label)
            columns["duplicate_subjects"] = duplicate_subjects
            columns["unrecognized"] = unrecognized
            candidates.append((len(columns["subjects"]), -row_index, row_index, columns))
    if not candidates:
        return None
    _, _, index, columns = max(candidates, key=lambda x: x[:2])
    return index, columns


def _score(value: Any, row: int, subject: str, warnings: list) -> float | int | None:
    if value is None or _text(value).lower() in MISSING_WORDS:
        return None
    if isinstance(value, bool):
        warnings.append({"level": "error", "row": row, "subject": subject, "message": f"第{row}行{subject}不是有效分数，已标记为缺失。"})
        return None
    try:
        numeric = float(_text(value).replace("，", ",").replace(",", ""))
    except (TypeError, ValueError):
        warnings.append({"level": "error", "row": row, "subject": subject, "message": f"第{row}行{subject}含非数字内容，已标记为缺失，请核对原表。"})
        return None
    if not math.isfinite(numeric) or numeric < 0:
        warnings.append({"level": "error", "row": row, "subject": subject, "message": f"第{row}行{subject}分数为负数或无效数值，已标记为缺失。"})
        return None
    return int(numeric) if numeric.is_integer() else numeric


def _decrypt_and_validate_xlsx(content: bytes, password: str | None) -> bytes:
    if not content.startswith(b"PK"):
        if not password:
            raise ValueError("文件可能已加密或不是有效的 .xlsx。请提供密码，或在 Excel 中另存为未加密的 .xlsx 后导入。")
        try:
            import msoffcrypto
        except ImportError as exc:
            raise ValueError("当前环境未安装加密读取组件，请先运行安装依赖，或另存为未加密的 .xlsx。") from exc
        try:
            decrypted = io.BytesIO()
            office = msoffcrypto.OfficeFile(io.BytesIO(content))
            office.load_key(password=password, verify_password=True)
            office.decrypt(decrypted)
            content = decrypted.getvalue()
        except Exception as exc:
            raise ValueError("未能解密文件，请核对密码与文件格式。") from exc
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 100 * 1024 * 1024:
                raise ValueError("工作簿展开后超过100MB，请仅保留需要导入的原始成绩页。")
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("无法读取工作簿，请确认文件是完整的 .xlsx 文件。") from exc
    return content


def _xlsx_rows(content: bytes, password: str | None) -> tuple[list[list[Any]], str, int]:
    content = _decrypt_and_validate_xlsx(content, password)
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True, keep_links=False)
    except Exception as exc:
        raise ValueError("无法读取工作簿，请确认文件是完整的 .xlsx 文件。") from exc
    candidates = []
    try:
        for order, sheet in enumerate(workbook.worksheets):
            head = [list(row) for row in sheet.iter_rows(min_row=1, max_row=20, max_col=min(sheet.max_column or MAX_COLUMNS, MAX_COLUMNS), values_only=True)]
            found = _find_header(head)
            if found:
                header_index, mapping = found
                # Prefer explicitly named raw input over derived sheets.
                raw_bonus = 100 if "原始" in sheet.title else 0
                visible_bonus = 1 if sheet.sheet_state == "visible" else 0
                candidates.append((raw_bonus + len(mapping["subjects"]), visible_bonus, -order, sheet.title, header_index))
        if not candidates:
            raise ValueError("未找到成绩表头。请在前20行包含“班级”和至少一门学科，如“语文”“数学”或“英语”。")
        _, _, _, name, header_index = max(candidates)
        sheet = workbook[name]
        if (sheet.max_row or 0) > MAX_ROWS + 20:
            raise ValueError("单次导入最多支持50,000行，请拆分成绩表后导入。")
        rows = [list(row) for row in sheet.iter_rows(max_col=min(sheet.max_column or MAX_COLUMNS, MAX_COLUMNS), values_only=True)]
        return rows, name, len(candidates)
    finally:
        workbook.close()


def _parse_score_rows(
    rows: list[list[Any]],
    sheet_name: str,
    filename: str,
    metadata: dict | None = None,
    candidate_count: int = 1,
) -> dict:
    metadata = metadata if isinstance(metadata, dict) else {}
    if len(rows) > MAX_ROWS + 20:
        raise ValueError("单次导入最多支持50,000行，请拆分成绩表后导入。")
    found = _find_header(rows)
    if not found:
        raise ValueError("未找到成绩表头。请在前20行包含“班级”和至少一门学科名称。")
    header_index, mapping = found
    if mapping["duplicate_subjects"]:
        raise ValueError("同一表头出现重复学科列：" + "、".join(mapping["duplicate_subjects"]) + "。请保留一列实际分数后重试。")
    subjects = sorted(mapping["subjects"], key=lambda x: SUBJECT_ORDER.index(x))
    warnings: list[dict] = []
    dataset_id = str(uuid.uuid4())
    parsed_rows = []
    seen_ids = {}
    anonymous_count = 0
    missing_counts = {s: 0 for s in subjects}
    all_zero_count = 0
    def get(row: list, field: str):
        column = mapping.get(field)
        return row[column] if column is not None and column < len(row) else None
    for source_row, row in enumerate(rows[header_index + 1:], start=header_index + 2):
        if not any(value is not None and _text(value) != "" for value in row):
            continue
        raw_class = get(row, "class")
        cls = normalize_class(raw_class)
        raw_scores = {s: row[c] if c < len(row) else None for s, c in mapping["subjects"].items()}
        has_scores = any(value is not None and _text(value) != "" for value in raw_scores.values())
        name = _text(get(row, "name"))
        stable_id = _text(get(row, "id"))
        if cls in SUMMARY_WORDS or (not cls and (name in SUMMARY_WORDS or any(name.startswith(w) for w in ("合计", "总计", "平均", "全年级", "全校", "汇总")))):
            warnings.append({"level": "info", "row": source_row, "message": f"第{source_row}行为汇总行，未作为学生成绩导入。"})
            continue
        if not has_scores and not name and not stable_id:
            continue
        if not cls:
            raise ValueError(f"第{source_row}行缺少班级，无法生成班级分析；请补全后重新导入。")
        scores = {s: _score(raw_scores[s], source_row, s, warnings) for s in subjects}
        for subject, score in scores.items():
            if score is None:
                missing_counts[subject] += 1
        if all(score == 0 for score in scores.values()):
            all_zero_count += 1
        if stable_id:
            identity = "student:" + stable_id
            reliable = True
        elif name:
            identity = "name:" + cls + ":" + name
            reliable = True
        else:
            identity = f"anonymous:{dataset_id}:{source_row}"
            reliable = False
            anonymous_count += 1
        if identity in seen_ids:
            raise ValueError(f"第{source_row}行与第{seen_ids[identity]}行的学生标识重复，请核对学号或同班同名记录后导入。")
        seen_ids[identity] = source_row
        parsed_rows.append({"id": identity, "source_row": source_row, "class": cls,
                            "name": name or f"第{source_row}行", "scores": scores,
                            "identity_reliable": reliable})
    if not parsed_rows:
        raise ValueError("已识别表头，但没有找到可导入的学生成绩行。")
    if anonymous_count:
        warnings.append({"level": "warning", "message": f"{anonymous_count}条记录没有姓名或稳定学号，按原始行号展示；可做本次班级统计，不能据行号匹配跨次学生。"})
    elif "id" not in mapping:
        warnings.append({"level": "info", "message": "当前以班级和姓名匹配学生。转班、改名或同名时，请使用稳定学号重新导入，以便准确连接历史。"})
    if all_zero_count:
        warnings.append({"level": "warning", "message": f"{all_zero_count}条记录所有已导入学科均为0；默认保留记录但不进入总分排名，请核对是否缺考。"})
    for subject, count in missing_counts.items():
        if count:
            warnings.append({"level": "warning", "subject": subject, "message": f"{subject}有{count}条缺失或无效成绩；空白未自动当作0。"})
    if "id" not in mapping and "exam_id" in mapping:
        warnings.append({"level": "info", "message": f"检测到考号列（第{mapping['exam_id'] + 1}列）；因考号可能随考试变化，未自动当作跨次稳定学号。如需跨考试追踪个人轨迹，请提供固定学号列。"})
    if mapping.get("unrecognized"):
        warnings.append({"level": "info", "message": "以下表头列未被识别为内置学科，本次已跳过：" + "、".join(mapping["unrecognized"][:12]) + "。如为正式学科，请修改为标准学科名称后重导。"})
    if candidate_count > 1:
        warnings.append({"level": "info", "message": f"工作簿中识别到{candidate_count}张候选成绩页，本次采用“{sheet_name}”；如需一次导入多场考试，可使用「多考总表批量导入」。"})
    return {
        "id": dataset_id, "name": _text(metadata.get("name")) or Path(filename).stem,
        "grade": _text(metadata.get("grade")) or "未指定年级", "date": _text(metadata.get("date")),
        "filename": filename, "imported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "subjects": subjects, "classes": sorted({r["class"] for r in parsed_rows}, key=class_sort_key),
        "rows": parsed_rows, "warnings": warnings,
        "mapping": {"sheet": sheet_name, "header_row": header_index + 1,
                    "class": mapping["class"] + 1,
                    "name": mapping.get("name", -1) + 1 or None,
                    "id": mapping.get("id", -1) + 1 or None,
                    "exam_id": mapping.get("exam_id", -1) + 1 or None,
                    "subjects": {s: mapping["subjects"][s] + 1 for s in subjects},
                    "unrecognized": mapping.get("unrecognized", []),
                    "identity": "稳定学号" if "id" in mapping else "班级和姓名" if "name" in mapping else "原表行号"},
    }


def parse_workbook(content: bytes, filename: str, metadata: dict | None = None, password: str | None = None) -> dict:
    """Parse a standard score table. No user file is written or modified."""
    if not isinstance(content, bytes) or not content:
        raise ValueError("文件为空，请重新选择成绩文件。")
    metadata = metadata if isinstance(metadata, dict) else {}
    filename = Path(filename).name
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        decoded = None
        for encoding in ("utf-8-sig", "gb18030"):
            try:
                decoded = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if decoded is None:
            raise ValueError("CSV编码无法识别，请另存为UTF-8编码后重试。")
        try:
            dialect = csv.Sniffer().sniff(decoded[:8192], delimiters=",\t;")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(io.StringIO(decoded), dialect=dialect))
        sheet_name, candidate_count = "CSV", 1
    elif suffix in (".xlsx", ".xlsm"):
        rows, sheet_name, candidate_count = _xlsx_rows(content, password)
    else:
        raise ValueError("支持 .xlsx、.xlsm 和 .csv。旧版 .xls 请先在 Excel 中另存为 .xlsx。")
    return _parse_score_rows(rows, sheet_name, filename, metadata, candidate_count)


def class_sort_key(cls: str) -> tuple:
    return (0, int(cls)) if cls.isdigit() else (1, cls)


HOMEROOM_HEADERS = {"班主任", "班主", "班主任姓名"}
EXAM_NAME_HEADERS = {"考试名称", "考试", "测验名称", "考试名"}


def _find_teacher_header(rows: list[list[Any]]) -> tuple[int, dict] | None:
    candidates = []
    for row_index, row in enumerate(rows[:20]):
        cols: dict[str, Any] = {"subjects": {}}
        for index, cell in enumerate(row[:MAX_COLUMNS]):
            header = _header(cell)
            if header in CLASS_HEADERS:
                cols.setdefault("class", index)
            elif header in HOMEROOM_HEADERS:
                cols.setdefault("homeroom", index)
            elif header in EXAM_NAME_HEADERS:
                cols.setdefault("exam_name", index)
            subject = _subject(cell)
            if subject:
                cols["subjects"].setdefault(subject, index)
        if "class" in cols and ("homeroom" in cols or cols["subjects"]):
            score = len(cols["subjects"]) + (2 if "homeroom" in cols else 0) + (2 if "exam_name" in cols else 0)
            candidates.append((score, -row_index, row_index, cols))
    if not candidates:
        return None
    _, _, idx, cols = max(candidates, key=lambda x: x[:2])
    return idx, cols


def parse_teachers_workbook(content: bytes, filename: str, password: str | None = None) -> dict:
    """Parse a teacher-assignment sheet (single-exam or multi-exam '教师基本信息')."""
    if not isinstance(content, bytes) or not content:
        raise ValueError("文件为空，请重新选择任课教师表。")
    filename = Path(filename).name
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        decoded = None
        for encoding in ("utf-8-sig", "gb18030"):
            try:
                decoded = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if decoded is None:
            raise ValueError("CSV编码无法识别，请另存为UTF-8编码后重试。")
        try:
            dialect = csv.Sniffer().sniff(decoded[:8192], delimiters=",\t;")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(io.StringIO(decoded), dialect=dialect))
        sheet_name = "CSV"
    elif suffix in (".xlsx", ".xlsm"):
        if not content.startswith(b"PK"):
            if not password:
                raise ValueError("文件可能已加密或不是有效的 .xlsx。")
            import msoffcrypto
            decrypted = io.BytesIO()
            office = msoffcrypto.OfficeFile(io.BytesIO(content))
            office.load_key(password=password, verify_password=True)
            office.decrypt(decrypted)
            content = decrypted.getvalue()
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 100 * 1024 * 1024:
                raise ValueError("工作簿展开后超过100MB，请精简后导入。")
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True, keep_links=False)
        try:
            candidates = []
            for order, sheet in enumerate(wb.worksheets):
                head = [list(r) for r in sheet.iter_rows(min_row=1, max_row=20, max_col=min(sheet.max_column or MAX_COLUMNS, MAX_COLUMNS), values_only=True)]
                found = _find_teacher_header(head)
                if found:
                    _, cols = found
                    bonus = 100 if "教师" in sheet.title else 0
                    candidates.append((bonus + len(cols["subjects"]), -order, sheet.title))
            if not candidates:
                raise ValueError("未找到任课教师表头。请包含“班级”以及“班主任”或学科列（如语文、数学）。")
            _, _, sheet_name = max(candidates)
            sheet = wb[sheet_name]
            rows = [list(r) for r in sheet.iter_rows(max_col=min(sheet.max_column or MAX_COLUMNS, MAX_COLUMNS), values_only=True)]
        finally:
            wb.close()
    else:
        raise ValueError("支持 .xlsx、.xlsm 和 .csv 格式的任课教师表。")

    return _parse_teacher_rows(rows, sheet_name)


def _parse_teacher_rows(rows: list[list[Any]], sheet_name: str) -> dict:
    found = _find_teacher_header(rows)
    if not found:
        raise ValueError("未找到任课教师表头。请包含“班级”以及“班主任”或学科列。")
    header_index, mapping = found
    subjects = sorted(mapping["subjects"], key=lambda x: SUBJECT_ORDER.index(x))
    parsed = []
    for row in rows[header_index + 1:]:
        if not any(v is not None and _text(v) != "" for v in row):
            continue
        cls_idx = mapping["class"]
        raw_cls = row[cls_idx] if cls_idx < len(row) else None
        cls = normalize_class(raw_cls)
        if not cls or cls in SUMMARY_WORDS:
            continue
        exam_name = ""
        if "exam_name" in mapping and mapping["exam_name"] < len(row):
            exam_name = _text(row[mapping["exam_name"]])
        homeroom = ""
        if "homeroom" in mapping and mapping["homeroom"] < len(row):
            homeroom = _text(row[mapping["homeroom"]])
        subj_teachers = {}
        for sub in subjects:
            idx = mapping["subjects"][sub]
            val = _text(row[idx]) if idx < len(row) else ""
            if val:
                subj_teachers[sub] = val
        if not homeroom and not subj_teachers:
            continue
        parsed.append({"exam_name": exam_name, "class": cls, "homeroom": homeroom, "subjects": subj_teachers})
    if not parsed:
        raise ValueError("已识别表头，但未找到有效的班级任课教师记录。")
    return {"sheet": sheet_name, "has_exam_name": "exam_name" in mapping, "subjects": subjects, "rows": parsed}


_NON_RAW_SHEET_TOKENS = (
    "使用指南", "填写说明", "打印模板", "综合名次", "薄弱学科",
    "历次测试", "达标率", "集中率", "单科数据对比", "班情分析", "分析结果",
)


def _extract_date_from_title(title: str) -> str:
    m = re.search(r"(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})", title)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    m2 = re.search(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)", title)
    if m2:
        y, mo, d = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    return ""


def _is_numeric_like(val: Any) -> bool:
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return True
    s = _text(val)
    if not s or s.lower() in MISSING_WORDS:
        return False
    try:
        float(s.replace("，", ",").replace(",", ""))
        return True
    except ValueError:
        return False


def _looks_like_teacher_sheet(title: str, rows: list[list[Any]]) -> bool:
    if any(tok in title for tok in ("教师", "任课")):
        return _find_teacher_header(rows[:20]) is not None
    found = _find_teacher_header(rows[:20])
    if not found:
        return False
    header_idx, mapping = found
    if "homeroom" in mapping:
        return True
    sub_cols = list(mapping["subjects"].values())
    if not sub_cols:
        return False
    non_num = 0
    total = 0
    for r in rows[header_idx + 1: header_idx + 35]:
        for c in sub_cols:
            if c < len(r):
                txt = _text(r[c])
                if not txt or txt.lower() in MISSING_WORDS:
                    continue
                total += 1
                if not _is_numeric_like(r[c]):
                    non_num += 1
    return total >= 3 and (non_num / total) >= 0.6


def inspect_multi_workbook(
    content: bytes,
    filename: str,
    *,
    grade: str = "",
    default_date: str = "",
    existing_exams: list[dict] | None = None,
    password: str | None = None,
) -> dict:
    """Scan all sheets in a multi-exam Excel workbook, classifying score sheets & teacher sheets."""
    if not isinstance(content, bytes) or not content:
        raise ValueError("文件为空，请重新选择工作簿文件。")
    filename = Path(filename).name
    suffix = Path(filename).suffix.lower()
    if suffix not in (".xlsx", ".xlsm"):
        raise ValueError("多考总表批量导入仅支持 .xlsx / .xlsm 工作簿；单个 CSV 请使用常规导入。")
    raw_bytes = _decrypt_and_validate_xlsx(content, password)
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True, read_only=True, keep_links=False)
    except Exception as exc:
        raise ValueError("无法读取工作簿，请确认文件是完整的 .xlsx 文件。") from exc

    existing_by_name = {}
    for ex in (existing_exams or []):
        nm = _text(ex.get("name"))
        if nm:
            existing_by_name[nm] = ex

    score_sheets = []
    teacher_sheets = []
    ignored_sheets = []

    try:
        for order, sheet in enumerate(wb.worksheets):
            title = sheet.title
            if any(tok in title for tok in _NON_RAW_SHEET_TOKENS):
                ignored_sheets.append({"sheet": title, "reason": "模板 / 派生汇总或说明页"})
                continue
            if (sheet.max_row or 0) > MAX_ROWS + 20:
                ignored_sheets.append({"sheet": title, "reason": "超过 50,000 行上限"})
                continue
            rows = [
                list(r)
                for r in sheet.iter_rows(max_col=min(sheet.max_column or MAX_COLUMNS, MAX_COLUMNS), values_only=True)
            ]
            if not rows:
                ignored_sheets.append({"sheet": title, "reason": "空白工作表"})
                continue
            if _looks_like_teacher_sheet(title, rows):
                try:
                    parsed_t = _parse_teacher_rows(rows, title)
                    teacher_sheets.append({
                        "sheet": title,
                        "row_count": len(parsed_t["rows"]),
                        "has_exam_name": parsed_t["has_exam_name"],
                        "subjects": parsed_t["subjects"],
                        "parsed": parsed_t,
                    })
                    continue
                except ValueError:
                    pass
            found_score = _find_header(rows[:20])
            if found_score:
                try:
                    suggested_name = title.strip() or Path(filename).stem
                    suggested_date = _extract_date_from_title(title) or default_date
                    ds = _parse_score_rows(
                        rows,
                        title,
                        filename,
                        metadata={"name": suggested_name, "grade": grade or "未指定年级", "date": suggested_date},
                        candidate_count=1,
                    )
                    matched = existing_by_name.get(suggested_name)
                    score_sheets.append({
                        "sheet": title,
                        "order": order,
                        "exam_name": suggested_name,
                        "exam_date": suggested_date,
                        "status": "exists" if matched else "new",
                        "existing_id": matched["id"] if matched else None,
                        "existing_date": matched.get("date", "") if matched else "",
                        "row_count": len(ds["rows"]),
                        "class_count": len(ds["classes"]),
                        "subjects": ds["subjects"],
                        "warnings": ds["warnings"],
                        "dataset": ds,
                    })
                    continue
                except ValueError as exc:
                    ignored_sheets.append({"sheet": title, "reason": str(exc)[:80]})
                    continue
            ignored_sheets.append({"sheet": title, "reason": "未识别到成绩或任课教师表头"})
    finally:
        wb.close()

    if not score_sheets and not teacher_sheets:
        raise ValueError("工作簿中未识别到可导入的成绩页或任课教师页，请确认表头包含“班级”和学科列。")
    return {
        "filename": filename,
        "grade": grade,
        "score_sheets": score_sheets,
        "teacher_sheets": teacher_sheets,
        "ignored_sheets": ignored_sheets,
    }


def _is_edit_distance_one(a: str, b: str) -> bool:
    if a == b:
        return False
    la, lb = len(a), len(b)
    if abs(la - lb) > 1 or min(la, lb) < 2:
        return False
    if la == lb:
        diffs = sum(1 for x, y in zip(a, b) if x != y)
        return diffs == 1
    # Insertion / deletion of 1 character
    short, long = (a, b) if la < lb else (b, a)
    i = j = diffs = 0
    while i < len(short) and j < len(long):
        if short[i] == long[j]:
            i += 1
            j += 1
        else:
            diffs += 1
            if diffs > 1:
                return False
            j += 1
    return True


def check_roster_hygiene(incoming_rows: list[dict], existing_datasets: list[dict]) -> dict:
    """Compare incoming exam roster with existing grade history to flag typos, transfers & duplicates."""
    # 1. Intra-exam duplicate names without stable student IDs across the grade
    name_classes: dict[str, list[str]] = {}
    for r in incoming_rows:
        if not r.get("identity_reliable"):
            continue
        nm = _text(r.get("name"))
        if not nm:
            continue
        if not str(r.get("id", "")).startswith("student:"):
            name_classes.setdefault(nm, []).append(r["class"])
    duplicate_names = [
        {"name": nm, "classes": sorted(set(cls_list), key=class_sort_key), "count": len(cls_list)}
        for nm, cls_list in sorted(name_classes.items())
        if len(cls_list) >= 2
    ]

    if not existing_datasets:
        return {
            "has_baseline": False,
            "baseline_exam": None,
            "typo_candidates": [],
            "class_transfers": [],
            "duplicate_names": duplicate_names,
            "new_count": 0,
            "missing_count": 0,
            "new_samples": [],
            "missing_samples": [],
        }

    # Latest dataset is expected first (or we take the last in chronological order)
    latest = existing_datasets[-1]
    base_rows = latest.get("rows") or []

    base_by_class: dict[str, set[str]] = {}
    base_by_id: dict[str, dict] = {}
    base_name_to_classes: dict[str, set[str]] = {}
    for r in base_rows:
        if not r.get("identity_reliable"):
            continue
        nm = _text(r.get("name"))
        cls = r["class"]
        if nm:
            base_by_class.setdefault(cls, set()).add(nm)
            base_name_to_classes.setdefault(nm, set()).add(cls)
        if str(r.get("id", "")).startswith("student:"):
            base_by_id[r["id"]] = r

    inc_by_class: dict[str, dict[str, dict]] = {}
    inc_name_to_classes: dict[str, set[str]] = {}
    for r in incoming_rows:
        if not r.get("identity_reliable"):
            continue
        nm = _text(r.get("name"))
        cls = r["class"]
        if nm:
            inc_by_class.setdefault(cls, {})[nm] = r
            inc_name_to_classes.setdefault(nm, set()).add(cls)

    typo_candidates = []
    class_transfers = []
    new_students = []
    missing_students = []

    matched_base_in_class: dict[str, set[str]] = {}
    matched_inc_in_class: dict[str, set[str]] = {}

    # Detect class transfers first (via stable ID or unique name across grade)
    transferred_inc_keys = set()
    transferred_base_keys = set()
    for r in incoming_rows:
        if not r.get("identity_reliable"):
            continue
        rid = str(r.get("id", ""))
        nm = _text(r.get("name"))
        cls = r["class"]
        if rid.startswith("student:") and rid in base_by_id:
            prev = base_by_id[rid]
            if prev["class"] != cls:
                class_transfers.append({
                    "name": nm,
                    "id": rid,
                    "from_class": prev["class"],
                    "to_class": cls,
                    "source_row": r.get("source_row"),
                    "by": "学号匹配",
                })
                transferred_inc_keys.add((cls, nm))
                transferred_base_keys.add((prev["class"], _text(prev.get("name"))))
        elif nm and nm not in base_by_class.get(cls, set()):
            prev_classes = base_name_to_classes.get(nm, set())
            if len(prev_classes) == 1 and len(inc_name_to_classes.get(nm, set())) == 1:
                prev_cls = next(iter(prev_classes))
                if prev_cls != cls and nm not in inc_by_class.get(prev_cls, {}):
                    class_transfers.append({
                        "name": nm,
                        "id": rid,
                        "from_class": prev_cls,
                        "to_class": cls,
                        "source_row": r.get("source_row"),
                        "by": "全年级唯一姓名",
                    })
                    transferred_inc_keys.add((cls, nm))
                    transferred_base_keys.add((prev_cls, nm))

    # Detect same-class 1-char typos between unmatched incoming and unmatched baseline
    all_classes = sorted(set(base_by_class) | set(inc_by_class), key=class_sort_key)
    for cls in all_classes:
        b_names = base_by_class.get(cls, set())
        i_map = inc_by_class.get(cls, {})
        i_names = set(i_map.keys())
        unmatched_inc = sorted(nm for nm in (i_names - b_names) if (cls, nm) not in transferred_inc_keys)
        unmatched_base = sorted(nm for nm in (b_names - i_names) if (cls, nm) not in transferred_base_keys)
        used_base = set()
        for inc_nm in unmatched_inc:
            candidates = [b for b in unmatched_base if b not in used_base and _is_edit_distance_one(inc_nm, b)]
            if len(candidates) == 1:
                sug = candidates[0]
                used_base.add(sug)
                matched_base_in_class.setdefault(cls, set()).add(sug)
                matched_inc_in_class.setdefault(cls, set()).add(inc_nm)
                typo_candidates.append({
                    "class": cls,
                    "incoming_name": inc_nm,
                    "suggested_name": sug,
                    "source_row": i_map[inc_nm].get("source_row"),
                })
        for inc_nm in unmatched_inc:
            if inc_nm not in matched_inc_in_class.get(cls, set()):
                new_students.append({"class": cls, "name": inc_nm})
        for base_nm in unmatched_base:
            if base_nm not in matched_base_in_class.get(cls, set()):
                missing_students.append({"class": cls, "name": base_nm})

    return {
        "has_baseline": True,
        "baseline_exam": latest.get("name", "上一场考试"),
        "typo_candidates": typo_candidates[:50],
        "class_transfers": class_transfers[:50],
        "duplicate_names": duplicate_names[:50],
        "new_count": len(new_students),
        "missing_count": len(missing_students),
        "new_samples": new_students[:15],
        "missing_samples": missing_students[:15],
    }


def apply_name_fixes(dataset: dict, fixes: list[dict] | None) -> int:
    """Apply confirmed typo name fixes in-place on a dataset before saving."""
    if not fixes or not isinstance(fixes, list):
        return 0
    fix_map: dict[tuple[str, str], str] = {}
    for item in fixes:
        if not isinstance(item, dict):
            continue
        cls = normalize_class(item.get("class", ""))
        src = _text(item.get("incoming_name") or item.get("from_name"))
        dst = _text(item.get("suggested_name") or item.get("to_name"))
        if cls and src and dst and src != dst:
            fix_map[(cls, src)] = dst
    if not fix_map:
        return 0
    existing_ids = {r["id"] for r in dataset.get("rows", [])}
    applied = 0
    for row in dataset.get("rows", []):
        key = (row.get("class", ""), _text(row.get("name")))
        if key in fix_map:
            new_name = fix_map[key]
            new_id = row["id"]
            if str(row["id"]).startswith("name:"):
                candidate_id = f"name:{row['class']}:{new_name}"
                if candidate_id in existing_ids and candidate_id != row["id"]:
                    raise ValueError(f"{row['class']}班已存在“{new_name}”，无法自动合并，请检查原表是否重复录入。")
                existing_ids.discard(row["id"])
                existing_ids.add(candidate_id)
                new_id = candidate_id
            row["name"] = new_name
            row["id"] = new_id
            applied += 1
    return applied


def parse_score_edits_file(content: bytes, filename: str) -> list[dict]:
    """Parse an uploaded score-correction Excel/CSV file into row records."""
    import csv
    import io
    from pathlib import Path

    ext = Path(filename or '').suffix.lower()
    raw_rows: list[list] = []
    if ext == '.csv':
        text = None
        for enc in ('utf-8-sig', 'utf-8', 'gb18030'):
            try:
                text = content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise ValueError('更正表 CSV 编码无法识别，请另存为 UTF-8 或 Excel 后重试。')
        raw_rows = list(csv.reader(io.StringIO(text)))
    else:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
        try:
            ws = wb.active
            for row in ws.iter_rows(values_only=True):
                raw_rows.append(list(row))
        finally:
            wb.close()

    if not raw_rows:
        raise ValueError('更正表为空，请检查文件内容。')

    id_aliases = {'学号或姓名', '学号', '考号', '准考证号', '学生标识', '姓名', '学生姓名', '学生'}
    cls_aliases = {'班级', '班号', '班别', '所在班级'}
    sub_aliases = {'科目', '学科', '更正科目', '修改科目'}
    val_aliases = {'新分数', '更正后分数', '修改后分数', '分数', '成绩', '新成绩'}

    header_idx = None
    col_map: dict[str, int] = {}
    for r_idx, row in enumerate(raw_rows[:15]):
        norm = [str(c or '').strip() for c in row]
        found: dict[str, int] = {}
        for c_idx, cell in enumerate(norm):
            if not cell:
                continue
            if 'id' not in found and cell in id_aliases:
                found['id'] = c_idx
            elif 'name' not in found and cell in {'姓名', '学生姓名'}:
                found['name'] = c_idx
            elif 'class' not in found and cell in cls_aliases:
                found['class'] = c_idx
            elif 'subject' not in found and cell in sub_aliases:
                found['subject'] = c_idx
            elif 'value' not in found and cell in val_aliases:
                found['value'] = c_idx
        if 'id' in found and 'subject' in found and 'value' in found:
            header_idx = r_idx
            col_map = found
            break

    if header_idx is None:
        raise ValueError('未能识别更正表表头，请使用「学号或姓名、班级、科目、新分数」列（可下载标准更正模板）。')

    records = []
    for offset, row in enumerate(raw_rows[header_idx + 1:], start=header_idx + 2):
        if not any(c is not None and str(c).strip() != '' for c in row):
            continue
        def _cell(key):
            idx = col_map.get(key)
            return row[idx] if (idx is not None and idx < len(row)) else None

        ident = str(_cell('id') or '').strip()
        extra_name = str(_cell('name') or '').strip()
        cls_raw = str(_cell('class') or '').strip()
        sub_raw = str(_cell('subject') or '').strip()
        val_raw = _cell('value')
        records.append({
            'row': offset,
            'identifier': ident,
            'name': extra_name,
            'class_raw': cls_raw,
            'subject': sub_raw,
            'raw_value': val_raw,
        })
    if not records:
        raise ValueError('更正表中没有找到待更正的数据行。')
    if len(records) > 500:
        raise ValueError('单次更正表最多支持 500 行，请拆分后导入。')
    return records
