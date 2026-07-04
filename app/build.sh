#!/bin/bash
# AgentOps.app をプロジェクトルートにビルドする
set -euo pipefail
cd "$(dirname "$0")"

APP="../AgentOps.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O main.swift -o "$APP/Contents/MacOS/AgentOps" \
  -framework Cocoa -framework WebKit

cp Info.plist "$APP/Contents/Info.plist"

# icon.png (1024x1024) があれば .icns に変換して組み込む
if [ -f icon.png ]; then
  ICONSET=$(mktemp -d)/AppIcon.iconset
  mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
  echo "icon: AppIcon.icns embedded"
fi

echo "built: $(cd .. && pwd)/AgentOps.app"
