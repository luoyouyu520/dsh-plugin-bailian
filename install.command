#!/bin/bash
cd "$(dirname "$0")" || exit 1
./install.sh "$@"
status=$?
if [ -t 0 ]; then
  printf '\n按回车关闭窗口…'
  IFS= read -r _ || true
fi
exit "$status"
