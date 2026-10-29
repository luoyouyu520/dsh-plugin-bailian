#!/bin/bash
# macOS 安装器，兼容系统 Bash 3.2。密钥仅写入本机凭据库。
set -euo pipefail
umask 077

BUNDLE_NAME="dsh-plugin-bailian"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MODE=install
DRY_RUN=0
NON_INTERACTIVE=0
SKIP_VERIFY=0
LOCK_HELD=0
TRANSACTION=0
PLUGIN_MOVED=0
PLUGIN_INSTALLED=0
CREDENTIALS_TOUCHED=0
HAD_CREDENTIALS=0
HAD_NODE_MODULES=0

info() { printf '%s\n' "$*"; }
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'HELP'
用法：./install.sh [--uninstall] [--dry-run] [--non-interactive] [--skip-verify]
  默认安装或升级；--uninstall 卸载并保留凭据。
  --dry-run 只校验和预览，不写文件、不联网。
  --non-interactive 不提示输入密钥；仍读取环境变量或 Key 文件。
  --skip-verify 跳过新密钥的在线认证校验。
环境变量：DSH_HOME、DSH_PROFILE（默认 desktop）、DSH_NODE、DASHSCOPE_API_KEY。
HELP
}

find_node() {
  local candidate app
  local candidates=("${DSH_NODE:-}" "$(command -v node 2>/dev/null || true)")
  local apps=("/Applications/DeepSeek Harness.app" "$HOME/Applications/DeepSeek Harness.app")
  if command -v mdfind >/dev/null 2>&1; then
    while IFS= read -r app; do
      [ -n "$app" ] && apps+=("$app")
    done < <(mdfind 'kMDItemCFBundleIdentifier == "com.deepseek.dsh"' 2>/dev/null || true)
  fi
  for app in "${apps[@]}"; do
    candidates+=("$app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node")
  done
  for candidate in "${candidates[@]}"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    if "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; then
      NODE_BIN="$candidate"
      return
    fi
  done
  fail '找不到 Node 18+。请先安装 Harness，或将 DSH_NODE 设为应用自带 node 的完整路径。'
}

bundle() {
  PKG_JSON="$PKG_JSON" BUNDLE_NAME="$BUNDLE_NAME" "$NODE_BIN" "$SCRIPT_DIR/bundle-register.mjs" "$1"
}

credential() {
  printf '%s' "$API_KEY" | DSH_PROFILES="$PROFILE_DIR" "$NODE_BIN" "$SCRIPT_DIR/write-credential.mjs" "$CREDS_FILE" "$@"
}

assert_no_link() {
  [ ! -L "$1" ] || fail "拒绝修改符号链接：$1"
}

on_exit() {
  local status=$?
  trap - EXIT
  if [ "$TRANSACTION" = 1 ]; then
    info '安装未完成，正在恢复原配置、凭据和插件。' >&2
    cp -p "$BACKUP_DIR/package.json.bak" "$PKG_JSON" || info "恢复 package.json 失败，请从 $BACKUP_DIR 手动恢复。" >&2
    if [ "$CREDENTIALS_TOUCHED" = 1 ]; then
      if [ "$HAD_CREDENTIALS" = 1 ]; then
        cp -p "$BACKUP_DIR/credentials.yaml.bak" "$CREDS_FILE" && chmod 600 "$CREDS_FILE" || info "恢复凭据失败，请从 $BACKUP_DIR 手动恢复。" >&2
      else
        rm -f "$CREDS_FILE" || info '清理新凭据失败。' >&2
      fi
    fi
    if [ "$PLUGIN_INSTALLED" = 1 ]; then
      rm -rf "$DEST" || info '清理新插件失败。' >&2
    fi
    if [ "$PLUGIN_MOVED" = 1 ]; then
      cp -pR "$BACKUP_DIR/plugin" "$DEST" || info "恢复旧插件失败，请从 $BACKUP_DIR 手动恢复。" >&2
    fi
    if [ "$HAD_NODE_MODULES" = 0 ]; then
      rmdir "$PROFILE_DIR/node_modules" 2>/dev/null || true
    fi
    info "备份位于：${BACKUP_DIR}（可能包含私人凭据，请勿分享）" >&2
  fi
  if [ "$LOCK_HELD" = 1 ]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" || true
  fi
  exit "$status"
}

main() {
  local arg file app_version
  for arg in "$@"; do
    case "$arg" in
      --uninstall) MODE=uninstall ;;
      --dry-run) DRY_RUN=1 ;;
      --non-interactive) NON_INTERACTIVE=1 ;;
      --skip-verify) SKIP_VERIFY=1 ;;
      -h|--help) usage; return ;;
      *) usage >&2; fail "未知参数：$arg" ;;
    esac
  done
  PROFILE_NAME="${DSH_PROFILE:-desktop}"
  case "$PROFILE_NAME" in
    ''|[!a-zA-Z0-9]*|*[!a-zA-Z0-9._-]*|*.) fail 'Profile 必须是简单名称，例如 desktop 或 web。' ;;
  esac
  DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
  PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE_NAME"
  PKG_JSON="$PROFILE_DIR/package.json"
  PATCH_YML="$PROFILE_DIR/cordis.patch.yml"
  CREDS_FILE="$DSH_HOME_DIR/.credentials.yaml"
  DEST="$PROFILE_DIR/node_modules/$BUNDLE_NAME"
  LOCK_DIR="$PROFILE_DIR/.bailian-install.lock"

  for file in "$PROFILE_DIR" "$PKG_JSON" "$PATCH_YML" "$PROFILE_DIR/node_modules" "$DEST" "$CREDS_FILE"; do
    assert_no_link "$file"
  done
  [ -d "$PROFILE_DIR" ] || fail "找不到 DSH profile：${PROFILE_DIR}。请先启动过一次 Harness。"
  for file in "$PKG_JSON" "$PATCH_YML"; do
    [ -f "$file" ] || fail "缺少 profile 文件：$file"
  done
  for file in package.json cordis.patch.yml install.sh write-credential.mjs bundle-register.mjs; do
    [ -f "$SCRIPT_DIR/$file" ] && [ -s "$SCRIPT_DIR/$file" ] || fail "安装包不完整：$file"
  done
  find_node
  app_version="$("$NODE_BIN" -e '
    try {
      const fs = require("node:fs");
      const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (p.name !== "dsh-plugin-bailian" || p.dsh?.bundle?.patch !== "./cordis.patch.yml") throw 0;
      process.stdout.write(String(p.version));
    } catch { console.error("无效的插件 package.json。"); process.exit(1); }
  ' "$SCRIPT_DIR/package.json")"
  bundle validate
  info "DSH profile：$PROFILE_DIR"
  info "插件：$BUNDLE_NAME $app_version"
  info "Node：$NODE_BIN"
  if [ "$DRY_RUN" = 1 ]; then
    info "[dry-run] 校验通过，将执行 ${MODE}；未写文件、未联网。"
    return
  fi

  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    fail 'Another installer is using this profile. 等待安装完成；若上次被强制终止，请确认 pid 进程已退出后移除 .bailian-install.lock。'
  fi
  LOCK_HELD=1
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
  bundle validate

  API_KEY=''
  if [ "$MODE" = install ]; then
    if [ -n "${DASHSCOPE_API_KEY:-}" ]; then
      API_KEY="$DASHSCOPE_API_KEY"
    elif [ -f "$SCRIPT_DIR/dashscope.key" ]; then
      API_KEY="$(cat "$SCRIPT_DIR/dashscope.key")"
    elif [ "$NON_INTERACTIVE" = 0 ]; then
      info '输入你自己的百炼 API Key；留空保留已有凭据。'
      if [ -t 0 ]; then
        IFS= read -r -s -p 'API Key: ' API_KEY || true
        printf '\n'
      else
        IFS= read -r API_KEY || true
      fi
    fi
    API_KEY="$(printf '%s' "$API_KEY" | "$NODE_BIN" -e 'process.stdout.write(require("node:fs").readFileSync(0, "utf8").trim())')"
    if [ -n "$API_KEY" ]; then
      credential --check
      if [ "$SKIP_VERIFY" = 0 ]; then
        printf '%s' "$API_KEY" | "$NODE_BIN" -e '
          const key = require("node:fs").readFileSync(0, "utf8");
          (async () => {
            try {
              const r = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/models", {
                headers: { Authorization: "Bearer " + key }, signal: AbortSignal.timeout(20000),
              });
              if ([401, 403].includes(r.status)) {
                console.error("百炼拒绝此密钥（401/403），未修改文件。"); process.exitCode = 1;
              } else if (!r.ok) console.error("无法完成在线认证，将保存密钥以供稍后使用。");
              else console.log("API Key 认证通过（不代表逐个模型均有权限）。");
              await r.body?.cancel();
            } catch { console.error("百炼暂时无法连接，将保存密钥以供稍后使用。"); }
          })();
        '
      fi
    else
      info '保留已有凭据；首次使用前需配置 API Key。'
    fi
  fi

  BACKUP_DIR="$(mktemp -d "$PROFILE_DIR/.bailian-backup-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
  chmod 700 "$BACKUP_DIR"
  cp -p "$PKG_JSON" "$BACKUP_DIR/package.json.bak"
  cp -p "$PATCH_YML" "$BACKUP_DIR/cordis.patch.yml.bak"
  if [ -f "$CREDS_FILE" ]; then
    HAD_CREDENTIALS=1
    if [ -n "$API_KEY" ]; then
      cp -p "$CREDS_FILE" "$BACKUP_DIR/credentials.yaml.bak"
      chmod 600 "$BACKUP_DIR/credentials.yaml.bak"
    fi
  fi
  [ ! -d "$PROFILE_DIR/node_modules" ] || HAD_NODE_MODULES=1

  # 先暂存全部源文件，支持从安装目录重跑，也清理旧版本遗留文件。
  if [ "$MODE" = install ]; then
    mkdir "$BACKUP_DIR/new-plugin"
    for file in package.json cordis.patch.yml README.md README-macos.md LICENSE CHANGELOG.md TEST-REPORT.txt TEST-REPORT-macos.txt install.sh install.command write-credential.mjs bundle-register.mjs; do
      if [ -f "$SCRIPT_DIR/$file" ]; then
        cp -p "$SCRIPT_DIR/$file" "$BACKUP_DIR/new-plugin/$file"
      fi
    done
    chmod 755 "$BACKUP_DIR/new-plugin/install.sh"
    if [ -f "$BACKUP_DIR/new-plugin/install.command" ]; then chmod 755 "$BACKUP_DIR/new-plugin/install.command"; fi
  fi

  TRANSACTION=1
  if [ "$MODE" = uninstall ]; then
    bundle unregister
    if [ -d "$DEST" ]; then
      mv "$DEST" "$BACKUP_DIR/plugin"
      PLUGIN_MOVED=1
    fi
    info '卸载完成，已有凭据已保留。'
  else
    mkdir -p "$PROFILE_DIR/node_modules"
    if [ -d "$DEST" ]; then
      mv "$DEST" "$BACKUP_DIR/plugin"
      PLUGIN_MOVED=1
    fi
    mv "$BACKUP_DIR/new-plugin" "$DEST"
    PLUGIN_INSTALLED=1
    if [ -n "$API_KEY" ]; then
      CREDENTIALS_TOUCHED=1
      credential
    fi
    bundle register
    info '安装完成：14 个模型配置，其中 7 个声明支持图片输入。'
  fi
  TRANSACTION=0
  info '完全退出 Harness（Cmd+Q）再重新打开后生效。'
  info "备份：${BACKUP_DIR}（可能包含私人凭据，请勿分享）"
}

# 先解析完整脚本，再执行，支持从即将替换或卸载的安装目录运行。
main "$@"
