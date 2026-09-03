#!/bin/bash
# 游戏与编辑器分开端口，互不影响。
#   ./dev.sh           游戏 :5173 + 角色 :5174 + 场景 :5175
#   ./dev.sh game      只开游戏（手机调试加 --host 已默认）
#   ./dev.sh editor    只开角色编辑器
#   ./dev.sh scene     只开场景编辑器
cd "$(dirname "$0")"
export PATH="$PWD/.tools/node/bin:$PATH"

mode="${1:-all}"
if [ "$mode" = "game" ] || [ "$mode" = "editor" ] || [ "$mode" = "scene" ] || [ "$mode" = "all" ]; then
  shift
fi

start_game() {
  echo "游戏        http://localhost:5173/   （9:16 竖屏舞台）"
  npx vite --host --port 5173 --strictPort "$@"
}

start_editor() {
  echo "角色编辑器  http://localhost:5174/   （本地资产工具，不进发布包）"
  npx vite --config vite.editor.config.ts --port 5174 --strictPort "$@"
}

start_scene() {
  echo "场景编辑器  http://localhost:5175/   （布局+氛围，不进发布包）"
  npx vite --config vite.scene.config.ts --port 5175 --strictPort "$@"
}

if [ "$mode" = "game" ]; then
  start_game "$@"
  exit
fi
if [ "$mode" = "editor" ]; then
  start_editor "$@"
  exit
fi
if [ "$mode" = "scene" ]; then
  start_scene "$@"
  exit
fi

start_game "$@" &
GAME_PID=$!
start_editor "$@" &
ED_PID=$!
trap 'kill "$GAME_PID" "$ED_PID" 2>/dev/null' EXIT INT TERM
start_scene "$@"
