@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY_CMD="
if exist ".venv\Scripts\python.exe" (
  set "PY_CMD=.venv\Scripts\python.exe"
) else (
  where py >nul 2>nul && set "PY_CMD=py -3"
)
if "%PY_CMD%"=="" (
  where python >nul 2>nul && set "PY_CMD=python"
)
if "%PY_CMD%"=="" (
  echo 未检测到 Python 3.10 或更新版本。请先安装 Python，然后运行「首次安装_Windows.bat」。
  pause
  exit /b 1
)
%PY_CMD% -c "import sys; assert sys.version_info >= (3,9); import openpyxl" >nul 2>nul
if errorlevel 1 (
  echo 首次使用融侨学迹需要 Python 3.9+ 和 openpyxl，请先运行「首次安装_Windows.bat」。
  pause
  exit /b 1
)
%PY_CMD% server.py %*
if errorlevel 1 pause
