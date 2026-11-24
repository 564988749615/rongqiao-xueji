# 融侨学迹 · 成绩更正功能实施计划

> 对应设计规格：`docs/superpowers/specs/2026-11-24-score-edit-design.md`
> 技术栈：Python 3.10+、标准库 `http.server`、SQLite、`openpyxl`、原生 HTML/CSS/JS。
> 通用约定：先写失败测试 → 确认失败 → 最小实现 → 通过 → 全量测试 `python3 -m unittest discover -s tests -v` → 每任务单独提交 `feat(score-edit): ...`。

## 任务清单与依赖

- **任务 0（已完成）**：核对 `engine.py`、`server.py`、`web/leader.js` 中 4 项待确认点并写入设计文档。
- **任务 1**：`score_edits` 表、`exams` 新列（`edit_count`, `data_version`, `published_at`）、`effective_dataset()` 及全部计算入口接入。
- **任务 2**：`POST /api/exams/<id>/scores/preview` 影响预览接口与严格分数校验。
- **任务 3**：`POST /api/exams/<id>/scores`、`GET /api/exams/<id>/scores/edits`、`POST /api/exams/<id>/scores/edits/<edit_id>/revoke` 正式保存、列表与单条撤销。
- **任务 4**：备份、恢复（含 v1 向后兼容）与云同步 `smart_merge` 不可逆撤销合并。
- **任务 5**：主工作台成绩修改 UI（学生明细表 & 学生详情抽屉单元格编辑、缺考开关、底部暂存条、影响预览弹窗、修改标记、更正记录与撤销抽屉）+ 浏览器验收测试。
- **任务 6**：批量导入更正表 `POST /api/exams/<id>/scores/import`、模板下载 `GET /api/templates/score-edits.xlsx` 与前端导入入口。
- **任务 7**：报表与导出版本标注（Excel、分发包、ABC 表、打印模板）及浏览器本地过时提示。
- **任务 8**：快速出表内存改分 + `POST /api/exams` 携带 `edits` 首录入库。
- **任务 9**：考试发布锁定（`publish` / `unlock`）与解锁审计记录。
- **任务 10**：更新 `API.md`、`使用说明.md`、`验收记录.md`，重新构建桌面端应用并执行端到端验收。
