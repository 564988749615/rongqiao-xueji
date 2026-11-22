# 融侨学迹真实软件接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把融侨学迹紫藤档案工作台接入知序真实引擎，完成真实导入、学生成长轨迹、长期档案和可启动软件交付。

**Architecture:** 继续使用现有 Python 本地服务、SQLite、`workbook.py` 解析器和 `engine.py` 计算器。前端把当前考试、快速导入和多次分析接入同一套 API，历史结果由服务端按稳定学生编码生成。发布阶段保留现有脚本并增加 macOS 应用包包装器。

**Tech Stack:** Python 3.10+, `http.server`, SQLite, openpyxl, msoffcrypto-tool, 原生 HTML/CSS/JavaScript, 现有浏览器验收脚本。

**Spec:** `docs/superpowers/specs/2026-11-22-rongqiao-xueji-integration-design.md`

## Global Constraints

- 本机优先，成绩和规则保存于本地 SQLite。
- 上传文件最多 20MB，密码只用于当次读取，不写入数据库或日志。
- 历史个人关联优先使用稳定学生编码，匿名记录不进入个人历次轨迹。
- 不改变现有排名、等级、有效分和薄弱学科计算口径。
- 现有 25 项计算与服务测试必须继续通过。

## Review Focus

- 多次考试选中数量变化后，生成按钮、结果范围和权重必须保持一致。测试归入历史接口任务。
- 稳定编码重复、改名、转班和匿名行不能错误合并。测试归入历史数据任务。
- 未选文件、导入异常和字段识别失败不能显示成功或丢失用户当前文件。测试归入导入接口任务。
- 切换考试后摘要和更新时间不能残留上一场数据。测试归入前端状态任务。
- 应用包找不到依赖或端口已被占用时要给出可恢复提示。测试归入打包任务。

## 文件地图

- 修改 `engine.py`：保留计算逻辑，必要时扩展历史所需的学生结果字段。
- 修改 `server.py`：扩展历史接口和导入/保存校验，补充选定考试范围与成长轨迹数据。
- 修改 `web/index.html`、`web/common.css`：统一融侨学迹品牌入口和紫藤档案外壳。
- 修改 `web/quick.html`、`web/quick.css`、`web/quick.js`：保留快速出表能力，接通真实导入状态与字段核验展示。
- 修改 `web/leader.html`、`web/leader.css`、`web/leader.js`：接入融侨学迹档案工作台、导入抽屉、多次分析结果页和学生成长抽屉。
- 修改 `tests/test_engine.py`、`tests/test_service.py`：覆盖历史明细、考试选择和导入边界。
- 新增 `tests/leader-ui-check.cjs` 或扩展现有脚本：覆盖真实入口、抽屉状态、考试切换和窄屏。
- 新增 `打包/融侨学迹.app/Contents/Info.plist`、`打包/融侨学迹.app/Contents/MacOS/融侨学迹`：macOS 应用包包装器。
- 修改 `启动知序.command`、`启动知序.bat` 和新增 `启动融侨学迹.command`：统一启动入口与错误提示。

---

### Task 1: 历史接口提供学生成长明细

**Files:**
- Modify: `server.py:calculate_history`
- Test: `tests/test_service.py`

**Interfaces:**
- Consumes: existing `/api/history` payload with `grade`, optional `weights`, optional `exam_ids`.
- Produces: `exams`, `students`, `warnings`, `subject_trends`, and `selected_exam_ids`. Each student history item includes `exam_id`, `name`, `date`, `class`, `rank`, `participants`, `total`, `scores`, `weak`, `grades`, and `levels` where available.

- [ ] **Step 1: Write the failing service tests**

Add tests that save three stable-ID exams, request only two `exam_ids`, assert the response contains exactly those exams, and assert one student history item carries total, subject scores, class and rank. Add a test that a transfer between classes keeps one student record because the ID is stable.

- [ ] **Step 2: Run the focused tests and verify RED**

Run `python3 -m unittest tests.test_service.ServiceTests.test_history_selected_exams_and_growth -v`.
Expected failure: the history response lacks `exam_ids` selection and score details.

- [ ] **Step 3: Implement the minimal history response**

Filter saved exams by `exam_ids` when provided, preserve chronological order, and build each history item from the existing `analyze` student result. Keep the existing composite rank formula and warnings. Generate subject trend rows from the selected analyses without introducing a second calculation path.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the focused test, then `python3 -m unittest tests.test_service -v`.

- [ ] **Step 5: Refactor only after green**

Extract a small serializer for history items if needed. Keep all existing API keys and old clients compatible.

### Task 2: 融侨学迹真实导入与档案保存

**Files:**
- Modify: `server.py`, `workbook.py`
- Modify: `web/leader.html`, `web/leader.js`, `web/leader.css`
- Modify: `web/quick.html`, `web/quick.js`, `web/quick.css`
- Test: `tests/test_service.py`, `tests/test_engine.py`, `tests/leader-ui-check.cjs`, `tests/quick-ui-check.cjs`

**Interfaces:**
- Consumes: `POST /api/import`, `POST /api/analyze`, `POST /api/exams`, existing Dataset and rules structures.
- Produces: file chooser/drag-drop state, field preview, warning list, explicit save action, and a reloadable exam archive.

- [ ] **Step 1: Write failing API tests**

Add tests for a malformed score file that returns warnings without saving, a valid stable-ID file that returns mapping and rows, and a save-then-reload path that preserves dataset and rules. Add a test that missing/duplicate identifiers remain visible in the warning response.

- [ ] **Step 2: Run focused tests and verify RED**

Run `python3 -m unittest tests.test_service.ServiceTests.test_import_preview_and_save_validation -v`.
Expected failure: the new field mapping and explicit validation response is absent.

- [ ] **Step 3: Implement import state in the API and UI**

Reuse `parse_workbook` and `validate_dataset`. Add only the response metadata needed for the UI to show source sheet, header row, field mapping and validation counts. Keep the file bytes in memory until the user saves. In the UI, disable the next step until a file is selected, show the selected filename, show warnings inline, preserve the file on errors, and call `/api/exams` only after user confirmation.

- [ ] **Step 4: Run focused API tests and existing browser checks**

Run `python3 -m unittest tests.test_service tests.test_engine -v`. Run the existing quick and leader UI checks against a temporary test data directory.

- [ ] **Step 5: Apply the 紫藤档案 visual system**

Change visible branding to 融侨学迹, preserve existing accessible controls, and bring the current exam header, archive navigation, quick import drawer, validation list and save feedback into the warm-white purple system. Keep the existing engine and export actions unchanged.

### Task 3: 多次成绩结果页与学生成长轨迹

**Files:**
- Modify: `web/leader.html`, `web/leader.js`, `web/leader.css`
- Modify: `API.md`, `使用说明.md`
- Test: `tests/leader-ui-check.cjs`, `tests/test_service.py`

**Interfaces:**
- Consumes: `/api/history` growth response from Task 1 and `/api/trends` for selected grade.
- Produces: selected exam drawer, history result table, student growth detail drawer, subject trend summary and composite rank columns.

- [ ] **Step 1: Write failing UI and API assertions**

Add an API assertion that the selected history response includes a student growth item with stable ID and exam details. Add browser assertions for selecting two or three exams, cancelling one and seeing the count update, generating results, opening a student detail, and closing it with focus restored.

- [ ] **Step 2: Run focused checks and verify RED**

Run the focused service test and the browser check. Expected failure: current leader page only offers a history table without selected exam growth details.

- [ ] **Step 3: Implement the result page**

Add a history view that keeps the selected exam list visible, displays participation count and composite rank, and opens a student detail drawer with total/rank/score/weak-subject rows by exam. Use the existing `lineChart` or SVG conventions from the current UI without adding a chart dependency. Missing exams and anonymous records must be labeled in the result.

- [ ] **Step 4: Run focused and full verification**

Run the browser check at desktop and 390px widths, then `python3 -m unittest discover -s tests -v`.

### Task 4: 融侨学迹软件入口与 macOS 应用包

**Files:**
- Modify: `web/index.html`, `web/help.html`, `web/quick.html`, `web/leader.html`
- Modify: `启动知序.command`, `启动知序.bat`, `小软件－快速出表.command`, `大软件－全校统筹.command`
- Create: `启动融侨学迹.command`
- Create: `打包/融侨学迹.app/Contents/Info.plist`
- Create: `打包/融侨学迹.app/Contents/MacOS/融侨学迹`
- Test: `tests/launcher-check.sh` or equivalent shell/Python check

**Interfaces:**
- Consumes: existing local server startup and runtime detection.
- Produces: branded entry page, quick/leader launchers, macOS app wrapper and Windows launcher compatibility.

- [ ] **Step 1: Write failing launcher checks**

Check that the app bundle contains an executable launcher, points to the bundled project root, uses the existing Python runtime fallback, opens `/`, and exits with a readable message when the port is occupied.

- [ ] **Step 2: Run the check and verify RED**

Run `bash tests/launcher-check.sh`. Expected failure: the 融侨学迹 app bundle and launcher do not exist.

- [ ] **Step 3: Implement the wrappers**

Create a lightweight app bundle wrapper that launches the existing local service and browser entry. Keep the current `.command` and `.bat` scripts working. Do not embed secrets or copy live database data into the bundle.

- [ ] **Step 4: Run launcher and runtime verification**

Run the launcher check, start the server with `--no-open`, query `/api/health`, open both page URLs, and verify the app wrapper exits cleanly after the server is stopped.

### Task 5: Release verification and user-facing documentation

**Files:**
- Modify: `API.md`, `使用说明.md`, `设计与实现说明.md`
- Test: all existing unit/service/browser/launcher checks

- [ ] **Step 1: Run the complete test suite**

Run `python3 -m unittest discover -s tests -v` and both browser checks. Record exact pass counts and any environment-only limitations.

- [ ] **Step 2: Run a real sample workflow**

Use `样例/原始数据.xlsx` to import, analyze, save, reload, select multiple exams, open a growth detail, export one workbook and verify the database remains readable after refresh.

- [ ] **Step 3: Run desktop and narrow-screen screenshot checks**

Use the existing screenshot workflow for the 融侨学迹 entry, quick import drawer, history result and student detail. Check console errors, horizontal overflow, file state, drawer closing and visible error recovery.

- [ ] **Step 4: Update documentation**

Document the two entry modes, stable-ID requirement, selected-exam history behavior, backup boundary and software startup paths. State clearly which calculations still come from the existing engine and which records are not generated from missing source data.

