# 融侨学迹 · 双入口实现合同

路径：`知序成绩分析软件/`。旧 `成绩分析工作台/` 保留不覆盖。
Python 标准库 HTTP 服务 + SQLite 本地持久化 + openpyxl；前端原生 HTML/CSS/JS，无构建、无外网资源。

## 前端公共能力（root 编写 web/common.js）
全局 `Z`：
- `api(path, body?)`：GET 或 JSON POST，成功返回 JSON 对象，失败抛中文 Error。
- `upload(file, metadata={})`：文件转base64，POST `/api/import`，返回 dataset。
- `escape(value)` HTML转义；`num(value,digits=1)` 空值显示—。
- `tableHTML(table)`；`copyTable(table)` 复制TSV（失败提供提示）；`downloadTable(table,filename)` CSV。
- `printTables(tables,title,subtitle='')` 打开真实可打印报告；`downloadWorkbook(analysis)` POST导出多页XLSX并下载。
- `notice(text, error=false)` 反馈；`icons(name)` 内联SVG。

`web/common.css` 提供 :root 色彩、.btn/.primary/.secondary/.panel/.field/.table-wrap/.badge/.empty/.error/.notice/.overlay/.dialog/.muted/.sr-only 等基础样式；页面可独立扩展，不用外网包。

## 数据集 Dataset
`{id, name, grade, date, filename, imported_at, subjects:[语文,...], classes:['01',...], rows:[{id,source_row,class,name,scores:{语文:100,...},identity_reliable:boolean}], warnings:[{level:'warning'|'error'|'info',message,row?,subject?}], mapping:{...}}`
空白/缺考为null，0保留为0；匿名数据name显示`第2行`且identity_reliable=false，不编造学生姓名。

## Rules
`{classes:null|['01',...],total_subjects:[...],cutoff_ratio:0.3,zero_policy:'exclude'|'include',missing_policy:'exclude_total'|'zero',weak_count:4,full_marks:{语文:150,...}}`
默认classes=null全量，total_subjects全部实际科目，full_marks={}（未确认不得猜满分）。零分选项影响实考/均分与全零总分纳入；排名在总分有效人群中对各科已有数值（含0）计算。缺分默认不生成总分，可显式选择按0合计。边界位置floor(N*p)最少1，竞争排名，同分全纳入；不复制旧表表头误计和重复弱科bug。

## Analysis
`{dataset_id, metadata:{name,grade,date,filename},rules,subjects,classes,summary:{registered,participants,excluded,mean,max,min,cutoff_rank,cutoff,elite_count,class_count},cutoffs:{总分:{score,count,k},语文:{...}},subject_stats:[{subject,count,mean,max,min,std,cutoff,achievers,concentrated,full_mark,score_rate}],class_stats:[{class,registered,participants,mean,max,min,elite_count,subjects:{语文:{count,mean,max,min,std,achievers,concentrated,score_rate}},top:{'50':n,'100':n,...}}],students:[{id,source_row,class,name,total,rank,class_rank,scores,ranks,grades:{语文:'A',...},levels:{语文:'A1',...},weak:[{subject,gap,rank,score}],identity_reliable}],warnings:[...],tables:[{id,title,columns:[中文列名],rows:[[值...]],note?}]}`
tables至少：scores排名、abc等级、levels六等级、effective有效分、class_stats班级统计、segments前N累计、weak薄弱学科、quality数据核验、rules口径说明。规则与标识须随打印导出保留。全量学生含排除行（rank=null）。

## API
- `GET /api/health` -> {ok:true,version,storage}
- `POST /api/shutdown` {} -> {ok:true,message}；安全关闭本机服务（同源校验）。
- `POST /api/import` {filename,content(base64),metadata:{name,grade,date},password?} -> Dataset；只解析不保存（小软件一次出表）。
- `POST /api/analyze` {dataset, rules} 或 {exam_id,rules?} -> Analysis
- `POST /api/exams` {dataset,rules?,edits?} -> {id,name,grade,date,filename,imported_at,row_count,subject_count,rules,edit_count,data_version,published_at}; 持久化。可选 `edits` 数组将作为首批成绩更正写入 `score_edits`（原始 `dataset` 保持不变）。
- `GET /api/exams` -> {exams:[上述概要]}
- `GET /api/exams/<id>` -> {dataset,effective_dataset,rules,edit_count,data_version,published_at}
- `POST /api/exams/<id>/rules` {rules} -> 概要
- `POST /api/exams/<id>/meta` {name,grade,date} -> 概要；更新考试名称、年级/届别和日期。
- `POST /api/exams/<id>/scores/preview` `{edits:[{row_id,subject,value}]}` 或 `{revoke_edit_id}` -> `{summary:{edited_cells,students_rank_changed,students_grade_changed,cutoffs_changed},students,cutoffs,classes,warnings}`；不写库，仅对比生效前后的排名、等级、有效分线与班级统计变化。
- `POST /api/exams/<id>/scores` `{edits:[{row_id,subject,value}],reason}` -> `{saved_count,batch_id,edit_count,data_version,updated_at}`；事务写入 `score_edits` 并递增 `data_version`、刷新 `updated_at`（原始 `dataset` 永不改写）；`reason` 必填（1–200 字），已发布或已归档考试禁止直接写入。
- `GET /api/exams/<id>/scores/edits` -> `{exam_id,data_version,edit_count,published_at,edits:[...]}`；按时间倒序返回全部更正及解锁审计记录（含已撤销条目）。
- `POST /api/exams/<id>/scores/edits/<edit_id>/revoke` `{}` -> `{ok:true,edit_count,data_version,updated_at}`；软撤销单条更正记录并重算生效数据与版本号。
- `GET /api/templates/score-edits.xlsx` -> 下载标准批量更正表模板（学号或姓名、班级、科目、新分数、原因）。
- `POST /api/exams/<id>/scores/import` `{filename,content(base64)}` -> 解析更正表并匹配学生，返回 `{matched_edits,unmatched,preview,summary}`（仅预览不落库，确认后再调 `POST /api/exams/<id>/scores`）。
- `POST /api/exams/<id>/publish` `{}` -> `{ok:true,published_at}`；锁定该场考试，禁止直接修改成绩。
- `POST /api/exams/<id>/unlock` `{reason}` -> `{ok:true,published_at:'',edit_count}`；解除发布锁并记入 `subject='__unlock__'` 审计记录（`reason` 必填）。
- `POST /api/exams/<id>/archive` {} -> {ok:true} 可在数据管理恢复
- `GET /api/exams?archived=1` -> {exams:...}
- `POST /api/exams/<id>/restore` {} -> {ok:true}
- `POST /api/exams/<id>/delete` {} -> {ok:true} 仅允许对已归档考试彻底删除（连同关联教研记录与成绩更正记录）。
- `GET /api/school` -> {grades:[{grade,exam(概要),analysis,grade_brief}], totals:{grades,classes,registered,participants},exam_count}; 每年级按date/created最新一场，含“本次三件事”简报，不跨年级加总分均分。
- `GET /api/students/search?q=...` -> 全局模糊搜索各年级学生并聚合关联场次。
- `GET /api/students/profile?grade=...&student_id=...` -> 个人历次轨迹、持续弱科与相关谈话记录。
- `GET /api/trends?grade=初三` -> {exams:[{id,name,date,grade,summary,subject_stats,class_stats}]}; 按日期，同年级。
- `POST /api/history` `{grade,exam_ids?:[exam_id,...],weights?:{exam_id:number}}` -> `{exams:[{id,name,date,weight}],selected_exam_ids,subject_trends,students:[{id,class,name,attempts,mean,trimmed,weighted,composite,rank,history:[{exam_id,name,date,class,rank,participants,total,scores,weak,grades,levels}]}],warnings}`。提供`exam_ids`时只对所选的同年级未归档考试计算，并按日期保留顺序。稳定编码优先串联转班、改名后的同一学生。无姓名和编码的记录不强行拼接个人轨迹。旧公式三均值融合，默认权重递增，界面可编辑。
- `GET /api/notes?exam_id=...` -> {notes:[{id,exam_id,class,text,created_at}]}
- `POST /api/notes` {exam_id,class?,text} -> note；领导真实保存教研记录。
- `POST /api/notes/<id>/update` {class?,text} -> note；更新教研记录。
- `POST /api/notes/<id>/delete` {} -> {ok:true}；删除教研记录。
- `GET /api/teachers?exam_id=...` -> {exam_id,teachers:[{exam_id,class,homeroom,subjects}]}；读取考试任课教师配置。
- `POST /api/teachers` {exam_id,rows:[{class,homeroom,subjects}]} -> 保存当前考试任课教师配置。
- `POST /api/teachers/import` {filename,content(base64),exam_id?,grade?} -> 解析《教师基本信息》Excel/CSV 并按考试名称自动匹配多场考试。
- `POST /api/class-brief` {exam_id,class?,high_ratio?:0.2,main_ratio?:0.4,all_classes?:boolean} -> 生成20%/40%双线班情诊断、谈话要点、同师跨班对比、分层流动、临界与单科短板名单与三套打印模板数据（`meta` 含 `data_version`、`edit_count`）。
- `POST /api/export/xlsx` {analysis} -> XLSX二进制（含数据版本与更正条数标注）。
- `GET /api/backup` -> JSON备份下载（`version: 2`，含全部已保存考试、规则、备注、教师配置与 `score_edits` 更正记录；恢复向下兼容 `version: 1`）。
- `POST /api/restore` {backup,mode?} -> {count,...}; 验证版本和结构后按ID幂等合并，云端/本地 `score_edits` 按记录 ID 合并且遵循撤销不可逆原则，不清除现有数据。
- `GET /api/example` -> 使用本机样例文件构成的Dataset；找不到本机样例时返回少量合成演示数据，不自动持久化。

入口 `/` 选择两个工作方式；`/quick.html`快速出表；`/leader.html`考试档案与全校统筹。品牌名为“融侨学迹”。
小软件“保存到全校平台”调用 /api/exams，仅用户点击才存。
大软件必须真实导入/保存/重读；只显示已导入年级，无合成初一初二数字。可一键导入随附原始数据并保存，标明其匿名来源。
