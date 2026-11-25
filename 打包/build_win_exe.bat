@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title 融侨学迹 · Windows 单文件打包脚本

cd /d "%~dp0\.."
echo ======================================================
echo   融侨学迹 · Windows 免 Python 环境单文件打包 (.exe)
echo ======================================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  set "PY_CMD=py -3"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    set "PY_CMD=python"
  ) else (
    echo [错误] 未检测到 Python 3，请先在构建机安装 Python 3.10+ 后重试。
    pause
    exit /b 1
  )
)

echo [1/4] 准备构建虚拟环境 (.venv-winbuild)...
if not exist ".venv-winbuild\Scripts\python.exe" (
  %PY_CMD% -m venv .venv-winbuild
)
call ".venv-winbuild\Scripts\activate.bat"

echo [2/4] 安装运行时依赖与 PyInstaller...
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt pyinstaller
if %errorlevel% neq 0 (
  echo [错误] 依赖安装失败，请检查网络连接。
  pause
  exit /b 1
)

echo [3/4] 开始打包单文件可执行程序...
if exist "dist\融侨学迹.exe" del /f /q "dist\融侨学迹.exe"

set "SAMPLE_OPT="
if exist "样例" set "SAMPLE_OPT=--add-data 样例;样例"

pyinstaller --noconfirm --clean --onefile ^
  --name "融侨学迹" ^
  --add-data "web;web" ^
  %SAMPLE_OPT% ^
  --hidden-import=openpyxl ^
  --hidden-import=et_xmlfile ^
  --hidden-import=msoffcrypto ^
  --hidden-import=olefile ^
  server.py

if %errorlevel% neq 0 (
  echo [错误] PyInstaller 打包失败，请查看上方日志。
  pause
  exit /b 1
)

echo [4/4] 打包完成！
echo.
echo 输出文件：%cd%\dist\融侨学迹.exe
echo 分发说明：直接将 dist\融侨学迹.exe 发给老师双击运行即可，无需安装 Python。
echo 数据目录：默认保存在用户目录下的本地 SQLite（不会随 exe 覆盖丢失）。
echo.
pause
