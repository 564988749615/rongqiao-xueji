#!/bin/zsh
# Build a self-contained macOS .app bundle for 融侨学迹.
# Usage: ./打包/build_mac_app.sh [output_app_path]
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_APP="${1:-$HOME/Desktop/融侨学迹.app}"
TARGET_DIR="$(dirname "$TARGET_APP")"

mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_APP"

CONTENTS="$TARGET_APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
APP_DIR="$RESOURCES/app"
RUNTIME_DIR="$APP_DIR/.runtime"

mkdir -p "$MACOS" "$RESOURCES" "$APP_DIR" "$RUNTIME_DIR"

# 1. Copy core backend, frontend and sample assets
for pyfile in server.py engine.py workbook.py exporter.py history.py class_brief.py distribution.py item_analysis.py s3_store.py requirements.txt; do
  cp "$PROJECT_ROOT/$pyfile" "$APP_DIR/$pyfile"
done
cp -R "$PROJECT_ROOT/web" "$APP_DIR/web"
if [[ -d "$PROJECT_ROOT/样例" ]]; then
  cp -R "$PROJECT_ROOT/样例" "$APP_DIR/样例"
fi

# 2. Bundle pure-Python runtime dependencies (.runtime + openpyxl + et_xmlfile)
if [[ -d "$PROJECT_ROOT/.runtime" ]]; then
  cp -R "$PROJECT_ROOT/.runtime/." "$RUNTIME_DIR/"
fi

find_site_python() {
  local candidate
  for candidate in \
    "${RONGQIAO_PYTHON:-}" \
    "$PROJECT_ROOT/.venv/bin/python" \
    "/opt/homebrew/bin/python3" \
    "/usr/local/bin/python3" \
    "$(command -v python3 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      if "$candidate" -c 'import openpyxl, et_xmlfile' 2>/dev/null; then
        print -r -- "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

BUILD_PY="$(find_site_python || true)"
if [[ -z "$BUILD_PY" ]]; then
  print '构建失败：未找到已安装 openpyxl 的 Python 环境。' >&2
  exit 1
fi

"$BUILD_PY" - "$RUNTIME_DIR" <<'PYEOF'
import importlib
import shutil
import sys
from pathlib import Path

dest = Path(sys.argv[1])
for pkg in ("openpyxl", "et_xmlfile"):
    mod = importlib.import_module(pkg)
    src = Path(mod.__file__).resolve().parent
    target = dest / pkg
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(src, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"))
PYEOF

# Clean any __pycache__ or .DS_Store inside bundle
find "$APP_DIR" \( -name "__pycache__" -o -name "*.pyc" -o -name ".DS_Store" \) -exec rm -rf {} + 2>/dev/null || true

# 3. Generate high-resolution macOS AppIcon.icns (wisteria purple squircle + 3 rising bars)
ICON_TMP="$(mktemp -d /tmp/rongqiao-icon.XXXXXX)"
trap 'rm -rf "$ICON_TMP"' EXIT
ICONSET="$ICON_TMP/AppIcon.iconset"
mkdir -p "$ICONSET"

"$BUILD_PY" - "$ICON_TMP/icon_1024.png" <<'PYEOF'
import math
import struct
import sys
import zlib

out_path = sys.argv[1]
SIZE = 512  # Rendered with 2x2 supersampling then upscaled smoothly via sips if needed, or direct 512->1024

def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v

def rounded_rect_sdf(px, py, cx, cy, hw, hh, r):
    dx = abs(px - cx) - (hw - r)
    dy = abs(py - cy) - (hh - r)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return outside + inside - r

# macOS icon safe inset (~10% padding) and rounded rect geometry in 512x512 canvas
PAD = 50.0
CX = CY = SIZE / 2.0
HW = HH = (SIZE - 2 * PAD) / 2.0
CORNER = 94.0

# Three rising white bars matching the 融侨学迹 brand mark
BAR_W = 24.0  # half-width -> 48px wide
BAR_R = 14.0
BASE_Y = 358.0
BARS = [
    (174.0, 146.0, 0.80),  # left bar: height 146
    (256.0, 232.0, 1.00),  # center tall bar: height 232
    (338.0, 186.0, 0.90),  # right medium bar: height 186
]

rows = []
for y in range(SIZE):
    row = bytearray(SIZE * 4)
    for x in range(SIZE):
        px = x + 0.5
        py = y + 0.5
        d_bg = rounded_rect_sdf(px, py, CX, CY, HW, HH, CORNER)
        alpha_bg = clamp(0.5 - d_bg)
        if alpha_bg <= 0.0:
            continue

        # Wisteria purple diagonal gradient (#9373c7 -> #6b4b9c)
        t = clamp(((px - PAD) * 0.45 + (py - PAD) * 0.85) / (SIZE - 2 * PAD))
        r = 148.0 * (1.0 - t) + 104.0 * t
        g = 116.0 * (1.0 - t) + 71.0 * t
        b = 202.0 * (1.0 - t) + 150.0 * t

        # Subtle top-edge inner sheen for tactile depth
        if d_bg > -6.0 and py < CY:
            sheen = clamp((6.0 + d_bg) / 6.0) * 0.14 * clamp((CY - py) / HH)
            r = r + (255.0 - r) * sheen
            g = g + (255.0 - g) * sheen
            b = b + (255.0 - b) * sheen

        # Composite the 3 rising bars
        for bx, bh, b_opacity in BARS:
            bcy = BASE_Y - bh / 2.0
            d_bar = rounded_rect_sdf(px, py, bx, bcy, BAR_W, bh / 2.0, BAR_R)
            cov = clamp(0.5 - d_bar) * b_opacity
            if cov > 0.0:
                r = r * (1.0 - cov) + 255.0 * cov
                g = g * (1.0 - cov) + 255.0 * cov
                b = b * (1.0 - cov) + 255.0 * cov

        idx = x * 4
        row[idx] = int(clamp(r / 255.0) * 255.0 + 0.5)
        row[idx + 1] = int(clamp(g / 255.0) * 255.0 + 0.5)
        row[idx + 2] = int(clamp(b / 255.0) * 255.0 + 0.5)
        row[idx + 3] = int(alpha_bg * 255.0 + 0.5)
    rows.append(b"\x00" + bytes(row))

def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

raw = b"".join(rows)
ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
with open(out_path, "wb") as f:
    f.write(png)
PYEOF

for sz in 16 32 128 256 512; do
  sips -z "$sz" "$sz" "$ICON_TMP/icon_1024.png" --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  sz2=$((sz * 2))
  sips -z "$sz2" "$sz2" "$ICON_TMP/icon_1024.png" --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns"

# 4. Write Info.plist
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>融侨学迹</string>
  <key>CFBundleExecutable</key>
  <string>融侨学迹</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.rongqiao.xueji</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>融侨学迹</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.1.0</string>
  <key>CFBundleVersion</key>
  <string>1.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

# 5. Write self-contained launcher executable
cat > "$MACOS/融侨学迹" <<'LAUNCHER'
#!/bin/zsh
set -u
SCRIPT_DIR="${0:A:h}"
APP_DIR="$(cd "$SCRIPT_DIR/../Resources/app" && pwd)"

is_gui_launch() {
  [[ -z "${NO_GUI_DIALOG:-}" && ! -t 1 && "${*:-}" != *"--no-open"* ]]
}

alert_error() {
  local message="$1"
  shift
  print -r -- "$message" >&2
  if is_gui_launch "$@"; then
    /usr/bin/osascript -e "display dialog \"${message//\"/\\\"}\" buttons {\"确定\"} default button 1 with icon stop with title \"融侨学迹\"" >/dev/null 2>&1 || true
  fi
}

if [[ ! -f "$APP_DIR/server.py" ]]; then
  alert_error "应用包内容不完整（缺少 server.py），请重新构建或拷贝完整的「融侨学迹.app」。" "$@"
  exit 1
fi

export ZHIXU_DATA_DIR="${ZHIXU_DATA_DIR:-$HOME/Library/Application Support/融侨学迹/data}"
mkdir -p "$ZHIXU_DATA_DIR"
export PYTHONPATH="$APP_DIR/.runtime${PYTHONPATH:+:$PYTHONPATH}"

find_python() {
  local candidate
  for candidate in \
    "${RONGQIAO_PYTHON:-}" \
    "/opt/homebrew/bin/python3" \
    "/usr/local/bin/python3" \
    "/usr/bin/python3" \
    "$(command -v python3 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      if "$candidate" -c 'import sys; assert sys.version_info >= (3,9); import openpyxl' 2>/dev/null; then
        print -r -- "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

runtime_python="$(find_python || true)"
if [[ -z "$runtime_python" ]]; then
  alert_error "当前 Mac 未检测到 Python 3.9 或更新版本，请先安装 Python 3 后重试。" "$@"
  exit 1
fi

cd "$APP_DIR" || exit 1
if is_gui_launch "$@"; then
  err_file="$(mktemp /tmp/rongqiao-app.XXXXXX)"
  "$runtime_python" "$APP_DIR/server.py" "$@" 2>"$err_file"
  status=$?
  if [[ $status -ne 0 ]]; then
    err_msg="$(<"$err_file")"
    rm -f "$err_file"
    alert_error "${err_msg:-融侨学迹启动未完成，请检查端口 8877 是否被其他程序占用。}" "$@"
    exit $status
  fi
  rm -f "$err_file"
else
  exec "$runtime_python" "$APP_DIR/server.py" "$@"
fi
LAUNCHER
chmod +x "$MACOS/融侨学迹"

# 6. Clear extended attributes and apply local ad-hoc signature
xattr -cr "$TARGET_APP" 2>/dev/null || true
codesign --force --deep --sign - "$TARGET_APP" >/dev/null 2>&1 || true

# Touch app bundle so Finder refreshes the custom icon immediately
touch "$TARGET_APP"

print -r -- "已成功构建独立 macOS 应用：$TARGET_APP"
print -r -- "数据保存目录：~/Library/Application Support/融侨学迹/data"
