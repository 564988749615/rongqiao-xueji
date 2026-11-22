@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY_CMD="
where py >nul 2>nul && set "PY_CMD=py -3"
if "%PY_CMD%"=="" where python >nul 2>nul && set "PY_CMD=python"
if "%PY_CMD%"=="" (
  echo 请先安装 Python 3.10 或更新版本，再运行此安装脚本。
  pause
  exit /b 1
)
%PY_CMD% -m venv .venv
if errorlevel 1 (
  echo 创建虚拟环境失败，请确认 Python 版本为 3.10 或更新。
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 (
  echo 依赖安装未完成，请检查网络连接后重试。
  pause
  exit /b 1
)
echo 安装完成。现在可以双击「启动融侨学迹.bat」。
pause
