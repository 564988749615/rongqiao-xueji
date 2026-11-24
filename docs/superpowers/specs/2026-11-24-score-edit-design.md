# 融侨学迹 · 成绩更正（单科改分、影响预览、撤销、批量更正与数据版本）设计规格

> 归档日期：2026-11-24
> 源码核对状态：全部 4 处「待核对」项已在 Task 0 核对完毕并记录于对应章节。

## 1. 意图
允许在已保存的考试档案中修改学生单科成绩。保存后，排名、等级、有效分线、班级统计、班情诊断、历次分析等所有派生结果自动更新。每一处修改都可以预览影响、写明原因、查看记录和单独撤销。

## 2. 用户与场景
- **教务或年级组**：发布成绩后收到复核申请（查分、漏登、录入错位），逐条或批量更正。
- **年级主任**：修改前想知道“这一分会让谁的名次、等级变化，会不会挪动分数线”。
- **校领导**：拿到的报表要能看出是否含更正、是哪个数据版本。

## 3. 现状与可复用的部分
- 排名、等级、有效分、班级统计都是用 Dataset + Rules 经 `analyze()` 现算得出，没有单独存放结果。
- `server.py` 已有分析缓存，缓存键为 `(str(DATA), row['id'], row['updated_at'], rules_key, include_tables)`。只要考试的 `updated_at` 变化，旧缓存自动失效。
- `exams` 表把整场考试的原始 Dataset 存成 JSON，放在 `dataset` 字段。
- Dataset 中每行学生为 `{id, source_row, class, name, scores:{科目:分数}, identity_reliable}`。空白或缺考为 `null`，`0` 保留为 `0`。
- Rules 中有 `full_marks`（未确认满分时为空）、`zero_policy`、`missing_policy`。
- 云同步智能合并按考试的 `updated_at` 判断哪边更新；备份与恢复函数为 `_build_backup_dict()` 和 `_restore_backup_dict(backup, mode)`（支持 `append_only` 与 `smart_merge`）。

## 4. 目标
1. 在考试档案中按单元格修改单科成绩，可以改成新分数，也可以改成“缺考”（`null`）。
2. 保存前展示影响预览：该生自身的变化、其他学生名次与等级的变化、分数线变化、班级统计变化。
3. 每条修改必须填写原因，并记录原值、新值和时间；可以单条撤销。
4. 支持导入更正表批量修改。
5. 所有报表和导出注明数据版本与更正条数；之前导出过的材料提示已过时。
6. 快速出表中也能修改，保存到档案时这些修改作为首批更正记录入库。
7. 考试可设为“已发布”，发布后修改需要先解锁。

## 5. 非目标
- 本轮不改动排名、等级、有效分、薄弱学科的计算口径。
- 本轮不做多账号与权限，“修改人”字段先留空或记录本机名称。
- 不在这里修改姓名、班级、学号。
- 不允许新增或删除学生行，不允许新增科目。

## 6. 约束
- 原始导入数据（`exams.dataset`）永不修改。所有修改只写入 `score_edits` 表，计算时叠加。
- 现有全部单元测试与服务测试必须继续通过。
- 服务仍只监听 `127.0.0.1`，日志不记录分数内容。
- 修改或撤销后必须更新考试的 `updated_at`，并刷新缓存。

## 7. 数据模型

### 7.1 新表 `score_edits`
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | `uuid4().hex` |
| `exam_id` | `TEXT NOT NULL` | 外键关联 `exams(id)` |
| `row_id` | `TEXT NOT NULL` | Dataset 中学生行的 `id` |
| `source_row` | `INTEGER` | 原表行号，用于展示和兜底定位 |
| `subject` | `TEXT NOT NULL` | 科目名，必须是 Dataset `subjects` 中已有的科目（解锁记录为 `__unlock__`） |
| `old_value` | `REAL` | 本条修改生效前的值（可空） |
| `new_value` | `REAL` | 新值；`NULL` 表示缺考 |
| `reason` | `TEXT NOT NULL` | 修改或解锁原因，1–200 字 |
| `editor` | `TEXT NOT NULL DEFAULT ''` | 预留 |
| `batch_id` | `TEXT NOT NULL DEFAULT ''` | 同一次保存的修改共用一个批次号 |
| `created_at` | `TEXT NOT NULL` | ISO 时间 |
| `revoked_at` | `TEXT` | 撤销时间；为空表示有效 |

索引：`(exam_id, revoked_at)`、`(exam_id, row_id, subject)`。

> ✅ 已核对（任务 0）：`engine.py:115-120` 的 `validate_dataset()` 严格校验同一场考试内 `row['id']` 为非空字符串且全局唯一（重复直接抛出 `ValueError("学生标识为空或重复...")`）。因此 `row_id` 在单场考试内唯一，`source_row` 同步记录用于展示。

### 7.2 `exams` 表新增列
沿用 `_EXAM_META_COLUMNS` 补列机制：
- `edit_count INTEGER NOT NULL DEFAULT 0`：当前有效成绩修改条数（不含 `__unlock__` 解锁日志）
- `data_version INTEGER NOT NULL DEFAULT 1`：每次保存修改或撤销时加 1
- `published_at TEXT NOT NULL DEFAULT ''`：发布时间；为空表示未发布

### 7.3 生效数据的计算规则
```text
有效 Dataset = 原始 Dataset 深拷贝
  依次叠加该考试所有 revoked_at IS NULL 且 subject != '__unlock__' 的修改（按 created_at ASC, rowid ASC）
  同一 (row_id, subject) 有多条有效修改时，以最后一条为准
```
撤销某条修改时，如果它之后还有同一格子的有效修改，则后者仍然生效。

## 8. 接口合同

### 8.1 `POST /api/exams/<id>/scores/preview`
只计算，不写库。
- 请求：`{"edits": [{"row_id": "...", "subject": "数学", "value": 124}]}`（长度 1–500；`value` 为 `null` 或 `0 <= value <= 满分`（未设满分上限 1000），最多 1 位小数）。也支持预览单条撤销：`{"revoke_edit_id": "<edit_id>"}`。
- 响应：`{students, cutoffs, classes, summary, warnings}`。

> ✅ 已核对（任务 0）：`engine.py:342-409` 输出确认：
> - `analysis['students'][i]['id']` 与 Dataset 行 `id` 完全一致；
> - `student['grades']` 与 `student['levels']` 均包含键 `'总分'` 以及各学科名；
> - `analysis['cutoffs']` 键为 `'总分'` 与各学科名，值为 `{"score": float|None, "count": int, "k": int}`；
> - `analysis['class_stats']` 每班含 `class`, `registered`, `participants`, `mean`, `max`, `min`, `std`, `elite_count`, `score_rate`, `top`（键为 `str(top_node)`）, `subjects`（每科含 `mean`, `achievers`, `concentrated`, `count`, `score_rate`）。

### 8.2 `POST /api/exams/<id>/scores`
正式保存：请求增加必填 `reason`（1–200 字）。单事务写入，共用 `batch_id`，更新 `updated_at`、`edit_count`、`data_version + 1`，清除缓存，触发云同步。响应 `{ok: true, batch_id, data_version, edit_count}`。

### 8.3 `GET /api/exams/<id>/scores/edits`
返回 `{edits, data_version, edit_count, published_at}`，按 `created_at DESC, rowid DESC`。

### 8.4 `POST /api/exams/<id>/scores/edits/<edit_id>/revoke`
写入 `revoked_at`，重算 `edit_count`，`data_version + 1`，更新 `updated_at`，清除缓存。已撤销记录或 `__unlock__` 日志拒绝再次撤销。

### 8.5 `POST /api/exams/<id>/scores/import` 与 `GET /api/templates/score-edits.xlsx`
上传更正表（列：`学号或姓名 | 班级 | 科目 | 新分数`），返回与 8.1 同构预览 + `matched_edits` + `unmatched: [{row, reason}]`；仅预览不保存。

### 8.6 发布与解锁
- `POST /api/exams/<id>/publish`：设置 `published_at`
- `POST /api/exams/<id>/unlock`：需填写 `reason`（1–200 字），清空 `published_at` 并在 `score_edits` 记录 `subject='__unlock__'`

### 8.7 现有接口变化
- `GET /api/exams` 与 `GET /api/exams/<id>` 的考试概要新增 `edit_count`、`data_version`、`published_at`。
- `GET /api/exams/<id>` 同时返回原始 `dataset`、`effective_dataset`、`rules`、`edit_count`、`data_version`、`published_at`、`active_edits`。
- `analysis['metadata']` 注入 `data_version` 与 `edit_count`（便于报表、打印、Excel、分发包统一标注版本）。

## 9. 计算接入点核对清单

> ✅ 已核对（任务 0）：全局扫描 `server.py` 全部 9 处 `json.loads(...['dataset'])`：
> 1. `init_db` 旧库元数据回填 → 元数据读取，保留原始
> 2. `_build_backup_dict` → 备份原样搬运，保留原始，顶层另附 `score_edits`
> 3. `exam_summary` 旧行回退 → 元数据读取，保留原始
> 4. `exam_analysis` → **核心计算入口，改为 `effective_dataset(conn, row)`**（自动覆盖 `/api/analyze`、`/api/class-brief`、`/api/trends`、`/api/school`、`/api/history`、`/api/student-cards`、`/api/students/search`、`/api/students/profile`、`/api/exams/<id>/class-packages.zip`、`/api/exams/<id>/class-abc.xlsx|.zip`）
> 5. `GET /api/exams/<id>` → 保留原始 `dataset`，另加 `effective_dataset` 与版本字段
> 6. `POST /api/workbook/inspect` → 仅做姓名/班号体检，保留原始
> 7. `POST /api/roster-check` → 仅做姓名/班号体检，保留原始
> 8. `POST /api/exams/<id>/rules`（同年级同步校验 `sib_ds`）→ **改为 `effective_dataset(conn, sib)`**
> 9. `POST /api/exams/<id>/meta`（改名/日期/年级）→ 原样写回 `exams.dataset` 元数据字段，保留原始分数

## 10. 备份、恢复与云同步
- `_build_backup_dict()` 增加顶层字段 `score_edits`（包含已撤销记录），`version` 升级为 `2`；`_validate_backup_payload()` 同时兼容 `version in (1, 2)`。
- `_restore_backup_dict()`：
  - 旧版备份无 `score_edits` 时视为空列表；
  - `append_only`：按 `id` 插入缺失的 `score_edits`；
  - `smart_merge`：按 `id` 合并，若任一端已撤销（`revoked_at` 非空）则合并后保持已撤销；合并后重算受影响考试的 `edit_count`、确保 `data_version` 单调递增并刷新 `updated_at`。

## 11. 快速出表对接（`POST /api/exams`）

> ✅ 已核对（任务 0）：`POST /api/exams` 当前请求体为 `{dataset, rules?, name_fixes?}`。扩展可选字段 `edits?: [{row_id, subject, value, reason?}]`：先将原始 `dataset` 存入 `exams`，再在同事务中将 `edits` 写入 `score_edits`（默认原因 `"快速出表中修改"`），更新 `edit_count` 与 `data_version=2`。不带 `edits` 的旧调用行为完全不变。
