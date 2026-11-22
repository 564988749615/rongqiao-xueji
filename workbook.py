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
SUBJECT_ALIASES.update({"道德与法治": "政治", "道法": "政治", "思品": "政治", "思想品德": "政治", "政治与法治": "政治", "外语": "英语", "信息科技": "信息技术"})
CLASS_HEADERS = {"班级", "班号", "班别", "行政班", "教学班", "班级名称", "班"}
NAME_HEADERS = {"姓名", "学生姓名", "名字", "学生"}
ID_HEADERS = {"学号", "学生编号", "学生id", "学生代码", "学籍号", "学籍号码"}
EXAM_ID_HEADERS = {"考号", "准考证号", "考试号", "考试编号"}
MISSING_WORDS = {"", "缺考", "缺", "未考", "旷考", "缓考", "免考", "未录入", "缺失", "待录入", "无", "--", "-", "—", "/", "na", "n/a", "null", "none"}
MAX_ROWS = 50000
MAX_COLUMNS = 256


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def normalize_class(value: Any) -> str:
    text = _text(value)
    text = re.sub(r"[\s\u3000]", "", text)
    matched = re.fullmatch(r"(?:初[一二三]|[七八九]年级|\d+年级)?[（(]?(\d+)[）)]?班?", text)
    if matched:
        return str(int(matched.group(1))).zfill(2)
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
        for index, cell in enumerate(row[:MAX_COLUMNS]):
            header = _header(cell)
            if header in CLASS_HEADERS:
                columns.setdefault("class", index)
            elif header in NAME_HEADERS:
                columns.setdefault("name", index)
            elif header in ID_HEADERS:
                columns.setdefault("id", index)
            elif header in EXAM_ID_HEADERS:
                columns.setdefault("exam_id", index)
            subject = _subject(cell)
            if subject:
                if subject in columns["subjects"]:
                    duplicate_subjects.append(subject)
                columns["subjects"][subject] = index
        if "class" in columns and columns["subjects"]:
            columns["duplicate_subjects"] = duplicate_subjects
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


def _xlsx_rows(content: bytes, password: str | None) -> tuple[list[list[Any]], str, int]:
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
        workbook = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True, keep_links=False)
    except ValueError:
        raise
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
        if cls in {"合计", "总计", "平均", "平均分", "年级", "全年级", "全校", "汇总"}:
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
    if candidate_count > 1:
        warnings.append({"level": "info", "message": f"工作簿中识别到{candidate_count}张候选成绩页，本次采用“{sheet_name}”；如需其他页，请单独另存后导入。"})
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
                    "subjects": {s: mapping["subjects"][s] + 1 for s in subjects},
                    "identity": "稳定学号" if "id" in mapping else "班级和姓名" if "name" in mapping else "原表行号"},
    }


def class_sort_key(cls: str) -> tuple:
    return (0, int(cls)) if cls.isdigit() else (1, cls)
