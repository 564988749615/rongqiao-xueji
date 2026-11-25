# Windows 免 Python 环境打包说明（单文件 .exe）

本目录提供 [build_win_exe.bat](build_win_exe.bat)，用于在任意一台装有 Python 3.10+ 的 Windows 电脑上，将「融侨学迹」打包为单文件 `融侨学迹.exe`，方便分发给其他老师双击使用（目标电脑无需安装 Python 或配置环境）。

## 构建步骤

1. 在 Windows 电脑上进入项目根目录，双击 `打包\build_win_exe.bat`（或在命令行执行）。
2. 脚本会自动创建独立构建环境 `.venv-winbuild`，安装 `requirements.txt` 与 `pyinstaller`，并将 `web/`、`样例/` 与运行库打入单文件。
3. 完成后产物位于项目根目录下的 `dist\融侨学迹.exe`。

## 分发与使用

- 可直接将 `dist\融侨学迹.exe` 上传至 GitHub Releases 或通过微信/内网发给老师。
- 老师双击 `融侨学迹.exe` 后会自动启动本机服务（`127.0.0.1:8877`）并打开默认浏览器，纯离线运行。
- 换机或升级时，建议先在「数据管理 → 下载完整备份」保存 JSON，再在新版本中恢复。
