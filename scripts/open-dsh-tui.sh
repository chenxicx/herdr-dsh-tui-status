#!/usr/bin/env sh
# 在 HerdR 创建的独立 Pane 中运行 dsh-TUI；Pane 环境变量会随 exec 传给 DSH 状态桥接插件。
#
# 必须通过 dsh profile 启动。直接执行全局 dsh-tui 会绕开 profile，导致
# @xichen/herdr-dsh-status 虽已安装却不会被加载。
set -eu

if ! command -v dsh >/dev/null 2>&1; then
    echo "未找到 dsh。请先安装 @deepseek-ai/dsh。" >&2
    exit 127
fi

exec dsh --profile dsh-tui "$@"
