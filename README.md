# 融侨学迹

融侨学迹是一套本机运行的成绩分析软件，服务于两种工作方式。

- 快速出表。导入一次成绩，生成排名、等级、有效分、班级统计和数据核验。
- 考试档案。保存每场考试，查看年级、班级、学科、历次趋势和学生成长轨迹。

## 运行

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

启动后打开 <http://127.0.0.1:8877/>。

macOS 也可以双击 [启动融侨学迹.command](启动融侨学迹.command)，或打开 [打包/融侨学迹.app](打包/融侨学迹.app)。

## 数据边界

成绩和分析结果默认保存在本机 SQLite。仓库不包含真实成绩工作簿、学生数据库、分析结果和验收截图。导入文件只在读取和保存流程中使用，文件密码不会写入数据库或日志。

学生跨考试匹配优先使用稳定学生编码。没有可靠身份的记录只参与当前考试统计，不生成个人成长轨迹。

## 主要目录

- `server.py` 本地服务、SQLite、导入、历史分析和导出
- `workbook.py` 成绩工作簿解析与字段识别
- `engine.py` 排名、等级、有效分和薄弱学科计算
- `web/` 融侨学迹页面和交互
- `tests/` 单元、服务和浏览器验收脚本
- `docs/superpowers/` 产品集成设计与实施计划

## 测试

```bash
python3 -m unittest discover -s tests -v
```

浏览器验收脚本需要本机 Chrome、Playwright 和一份本地成绩文件。它们不会把成绩文件提交到仓库。
