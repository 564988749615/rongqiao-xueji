#!/bin/zsh
cd "${0:A:h}" || exit 1
find_python() {
  local candidate
  for candidate in \
    "${RONGQIAO_PYTHON:-}" \
    "$PWD/.venv/bin/python" \
    "/opt/homebrew/bin/python3" \
    "/usr/local/bin/python3" \
    "$(command -v python3 2>/dev/null || true)" \
    "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      if "$candidate" -c 'import sys; assert sys.version_info >= (3,9)' 2>/dev/null; then
        print -r -- "$candidate"
        return 0
      fi
    fi
  done
  return 1
}
runtime_python="$(find_python || true)"
if [[ -z "$runtime_python" ]]; then
  print '请先安装 Python 3.9 或更新版本，再运行此文件。'
  read '?按回车关闭…'
  exit 1
fi
"$runtime_python" -m venv .venv || exit 1
.venv/bin/python -m pip install -r requirements.txt || exit 1
print '安装完成。现在可以双击「启动融侨学迹.command」或「打包/融侨学迹.app」。'
read '?按回车关闭…'
