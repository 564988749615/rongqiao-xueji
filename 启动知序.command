#!/bin/zsh
cd "${0:A:h}" || exit 1
"${0:A:h}/打包/融侨学迹.app/Contents/MacOS/融侨学迹" "$@"
if [[ $? -ne 0 ]]; then
  print '融侨学迹启动未完成。如果软件已经打开，请访问 http://127.0.0.1:8877/ 。'
  read '?按回车关闭…'
fi
