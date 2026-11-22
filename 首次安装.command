#!/bin/zsh
cd "${0:A:h}" || exit 1
runtime_python="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
if [[ ! -x "$runtime_python" ]]; then runtime_python="$(command -v python3)"; fi
if [[ -z "$runtime_python" ]] || ! "$runtime_python" -c 'import sys; assert sys.version_info >= (3,10)' 2>/dev/null; then
  print '请先安装 Python 3.10 或更新版本，再运行此文件。'
  read '?按回车关闭…'
  exit 1
fi
"$runtime_python" -m venv .venv || exit 1
.venv/bin/python -m pip install -r requirements.txt || exit 1
print '安装完成。现在可以双击「启动融侨学迹.command」。'
read '?按回车关闭…'
