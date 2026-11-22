#!/bin/zsh
cd "${0:A:h}" || exit 1
runtime_python="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
if [[ -x ".venv/bin/python" ]]; then
  runtime_python="$PWD/.venv/bin/python"
elif [[ ! -x "$runtime_python" ]]; then
  runtime_python="$(command -v python3)"
fi
if [[ -z "$runtime_python" ]] || ! "$runtime_python" -c 'import sys; assert sys.version_info >= (3,10); import openpyxl' 2>/dev/null; then
  print '首次使用融侨学迹需要 Python 3.10 或更新版本，以及 openpyxl。请先运行「首次安装.command」。'
  read '?按回车关闭…'
  exit 1
fi
"$runtime_python" server.py "$@"
if [[ $? -ne 0 ]]; then
  print '融侨学迹启动未完成。如果软件已经打开，请访问 http://127.0.0.1:8877/ 。'
  read '?按回车关闭…'
fi
