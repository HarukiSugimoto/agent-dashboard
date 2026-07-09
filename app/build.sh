#!/bin/bash
# AgentOps.app をプロジェクトルートにビルドする
set -euo pipefail
cd "$(dirname "$0")"

APP="../AgentOps.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O main.swift -o "$APP/Contents/MacOS/AgentOps" \
  -framework Cocoa -framework WebKit -framework UserNotifications

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

# バンドル全体に署名。通知権限・通知アイコンはアプリの署名と紐づく。
# Apple Development (Xcode + Apple ID で発行) > 自己署名 AgentOps Signing > ad-hoc の順。
# Apple 発行の証明書でないと UserNotifications は拒否され、通知アイコンも汎用になる。
IDENTITIES=$(security find-identity -p codesigning -v 2>/dev/null)
if echo "$IDENTITIES" | grep -q "Apple Development"; then
  codesign --force --deep -s "Apple Development" "$APP"
  echo "signed: Apple Development"
elif echo "$IDENTITIES" | grep -q "AgentOps Signing"; then
  codesign --force --deep -s "AgentOps Signing" "$APP"
  echo "signed: AgentOps Signing (自己署名: 通知アイコンは汎用になります)"
else
  codesign --force --deep -s - "$APP" 2>/dev/null || true
  echo "signed: ad-hoc (通知アイコンは汎用になります)"
fi

echo "built: $(cd .. && pwd)/AgentOps.app"
