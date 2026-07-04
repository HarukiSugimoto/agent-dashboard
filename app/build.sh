#!/bin/bash
# AgentOps.app をプロジェクトルートにビルドする
set -euo pipefail
cd "$(dirname "$0")"

APP="../AgentOps.app"
mkdir -p "$APP/Contents/MacOS"

swiftc -O main.swift -o "$APP/Contents/MacOS/AgentOps" \
  -framework Cocoa -framework WebKit

cp Info.plist "$APP/Contents/Info.plist"
echo "built: $(cd .. && pwd)/AgentOps.app"
