# ============================================================================
# dsh-plugin-bailian 安装脚本 (Windows / PowerShell)
#
# 把阿里云百炼 (DashScope) 全模型接入安装到本机的 DSH Desktop profile。
# 幂等：重复运行安全，不会产生重复条目，不会覆盖你已改过的无关配置。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun
#
# 或者直接双击 install.bat（已自动带上 ExecutionPolicy Bypass）。
# ============================================================================

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$DryRun,
    [string]$Profile,
    [string]$ApiKey
)

$ErrorActionPreference = 'Stop'

# ---------- 控制台 UTF-8（避免中文乱码）----------
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

# ---------- 输出辅助 ----------
function Write-Ok   { param($m) Write-Host "[OK] $m"   -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "[!]  $m"   -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "[X]  $m"   -ForegroundColor Red }
function Write-Info { param($m) Write-Host "     $m"   -ForegroundColor Gray }
function Write-Step { param($m) Write-Host "`n-> $m"   -ForegroundColor Cyan }

# ---------- 常量 ----------
$BundleName   = 'dsh-plugin-bailian'
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProfileName  = if ($Profile) { $Profile } elseif ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }
$DshHome      = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$ProfileDir   = Join-Path $DshHome "profiles\$ProfileName"
$CredsFile    = Join-Path $DshHome '.credentials.yaml'

# ---------- 包完整性自检 ----------
$required = @('cordis.patch.yml', 'package.json', 'write-credential.mjs')
$missing = @($required | Where-Object { -not (Test-Path (Join-Path $ScriptDir $_)) })
if ($missing.Count -gt 0) {
    Write-Err "插件包不完整，缺少: $($missing -join ', ')"
    Write-Info "请确认整个 dsh-plugin-bailian 文件夹都被完整复制/解压。"
    Write-Info "当前脚本位置: $ScriptDir"
    exit 1
}

# ---------- 密钥来源：参数 > 环境变量 > 包内 key 文件 ----------
$KeyFile = Join-Path $ScriptDir 'dashscope.key'
$RealKey = ''
if ($ApiKey)                { $RealKey = $ApiKey.Trim() }
elseif ($env:DASHSCOPE_API_KEY) { $RealKey = $env:DASHSCOPE_API_KEY.Trim() }
elseif (Test-Path $KeyFile) { $RealKey = (Get-Content $KeyFile -Raw).Trim() }

Write-Host "=============================================="
Write-Host " dsh-plugin-bailian 安装程序 (Windows)"
Write-Host "=============================================="

# ---------- 前置检查 ----------
if (-not (Test-Path $ProfileDir)) {
    Write-Err "找不到 DSH profile 目录: $ProfileDir"
    Write-Info "请确认已至少启动过一次 DSH Desktop 应用。"
    Write-Info "若你的 DSH 装在别的 profile，可用 -Profile web 指定。"
    exit 1
}
Write-Ok "DSH profile: $ProfileDir"

$PkgJson  = Join-Path $ProfileDir 'package.json'
$PatchYml = Join-Path $ProfileDir 'cordis.patch.yml'
if (-not (Test-Path $PkgJson))  { Write-Err "缺少 $PkgJson";  exit 1 }
if (-not (Test-Path $PatchYml)) { Write-Err "缺少 $PatchYml"; exit 1 }

# ---------- 定位 Node ----------
# Windows 上通常是没装 Node 的，但 DSH Desktop 自带一份完整运行时。
$NodeBin = $null

function Test-NodeCandidate {
    param($Path)
    if (-not $Path) { return $false }
    if ($Path -isnot [string]) { return $false }
    if ($Path.Trim() -eq '') { return $false }
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $v = & $Path --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $v) { return $true }
    } catch { }
    return $false
}

# 1) 用户显式指定
if ($env:DSH_NODE -and (Test-NodeCandidate $env:DSH_NODE)) { $NodeBin = $env:DSH_NODE }

# 2) PATH 里的 node
if (-not $NodeBin) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and (Test-NodeCandidate $cmd.Source)) { $NodeBin = $cmd.Source }
}

# 3) DSH Desktop 自带运行时（多个可能的安装位置）
# 注意：Windows 上 ProgramFiles(x86) 等变量在某些系统上不存在，
# Join-Path 收到 $null 会直接抛错，所以先过滤掉空值再拼接。
if (-not $NodeBin) {
    $appRoots = @()
    $bases = @(
        $env:LOCALAPPDATA,
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)},
        $env:ProgramW6432
    ) | Where-Object { $_ -and $_.Trim() -ne '' }

    foreach ($b in $bases) {
        $appRoots += (Join-Path $b 'DeepSeek Harness')
        $appRoots += (Join-Path $b 'Programs\DeepSeek Harness')
    }
    $appRoots = $appRoots | Where-Object { $_ } | Select-Object -Unique

    foreach ($root in $appRoots) {
        $cands = @(
            (Join-Path $root 'resources\runtime\primary-runtime\dependencies\node\node.exe'),
            (Join-Path $root 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'),
            (Join-Path $root 'Contents\Resources\runtime\primary-runtime\dependencies\node\bin\node')
        )
        foreach ($c in $cands) {
            if (Test-NodeCandidate $c) { $NodeBin = $c; break }
        }
        if ($NodeBin) { break }
    }
}

if (-not $NodeBin) {
    Write-Err "找不到可用的 Node 运行时。"
    Write-Info "本脚本需要 Node 来安全地修改 JSON/YAML。请任选其一："
    Write-Info "  - 安装 Node (https://nodejs.org) 后重跑"
    Write-Info "  - 用 `$env:DSH_NODE='C:\path\to\node.exe' 指定后重跑"
    exit 1
}
$NodeVersion = (& $NodeBin --version 2>$null)
Write-Ok "node: $NodeVersion  ($NodeBin)"

$Stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir = Join-Path $ProfileDir ".bailian-backup-$Stamp"

# ============================================================================
# 卸载分支
# ============================================================================
if ($Uninstall) {
    Write-Step "卸载中..."
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    Copy-Item $PkgJson  (Join-Path $BackupDir 'package.json.bak')      -Force
    Copy-Item $PatchYml (Join-Path $BackupDir 'cordis.patch.yml.bak')  -Force
    Write-Ok "已备份到 $BackupDir"

    if (-not $DryRun) {
        $js = @'
const fs = require("fs");
const p = process.env.PKG_JSON;
const name = process.env.BUNDLE_NAME;
const j = JSON.parse(fs.readFileSync(p, "utf8"));
if (Array.isArray(j?.dsh?.profile?.bundles)) {
  j.dsh.profile.bundles = j.dsh.profile.bundles.filter((x) => x !== name);
}
if (j.dependencies && typeof j.dependencies === "object") { delete j.dependencies[name]; }
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
'@
        $env:PKG_JSON = $PkgJson; $env:BUNDLE_NAME = $BundleName
        & $NodeBin -e $js
        if ($LASTEXITCODE -ne 0) { Write-Err "修改 package.json 失败"; exit 1 }

        foreach ($cand in @(
            (Join-Path $ProfileDir "node_modules\$BundleName"),
            (Join-Path $ProfileDir "plugins\$BundleName")
        )) {
            if (Test-Path $cand) {
                Remove-Item -Recurse -Force $cand
                Write-Info "已删除 $cand"
            }
        }
    }
    Write-Ok "已从 dsh.profile.bundles 移除 $BundleName"
    Write-Warn "凭据 (refs.DASHSCOPE_API_KEY) 已保留，如需删除请手动编辑 $CredsFile"
    Write-Host "`n重启 DSH 后生效。备份位于: $BackupDir"
    exit 0
}

# ============================================================================
# 安装分支
# ============================================================================
Write-Step "1/5 备份现有配置"
if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    Copy-Item $PkgJson  (Join-Path $BackupDir 'package.json.bak')     -Force
    Copy-Item $PatchYml (Join-Path $BackupDir 'cordis.patch.yml.bak') -Force
    if (Test-Path $CredsFile) {
        Copy-Item $CredsFile (Join-Path $BackupDir 'credentials.yaml.bak') -Force
    }
}
Write-Ok "备份 -> $BackupDir"

Write-Step "2/5 安装插件包"
# 关键：DSH 从「profile 目录」和「profile 的 node_modules」解析 bundle 名，
# 放在 profile\plugins\ 下是解析不到的（实测报 cannot resolve profile bundle）。
$NmDir = Join-Path $ProfileDir 'node_modules'
$Dest  = Join-Path $NmDir $BundleName
if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    Copy-Item (Join-Path $ScriptDir 'cordis.patch.yml') (Join-Path $Dest 'cordis.patch.yml') -Force
    Copy-Item (Join-Path $ScriptDir 'package.json')     (Join-Path $Dest 'package.json')     -Force
    $rm = Join-Path $ScriptDir 'README.md'
    if (Test-Path $rm) { Copy-Item $rm (Join-Path $Dest 'README.md') -Force }
}
Write-Ok "插件已就位 -> $Dest"

Write-Step "3/5 写入 API 密钥到凭据库"
if (-not $RealKey) {
    Write-Warn "未找到密钥（dashscope.key / DASHSCOPE_API_KEY 均为空），跳过。"
    Write-Info "稍后可手动把密钥写入 $CredsFile 的 refs.DASHSCOPE_API_KEY。"
}
elseif ($DryRun) {
    Write-Info "[dry-run] 将写入 refs.DASHSCOPE_API_KEY"
}
else {
    $envObj = @{ DSH_PROFILES = (Join-Path $DshHome 'profiles') }
    $prev = @{}
    foreach ($k in $envObj.Keys) { $prev[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $envObj[$k]) }
    try {
        & $NodeBin (Join-Path $ScriptDir 'write-credential.mjs') $CredsFile $RealKey
        if ($LASTEXITCODE -ne 0) {
            Write-Err "写入凭据失败，已中止以免留下损坏的凭据库。"
            Write-Info "你的原始文件备份在: $BackupDir"
            exit 1
        }
    } finally {
        foreach ($k in $prev.Keys) { [Environment]::SetEnvironmentVariable($k, $prev[$k]) }
    }
    Write-Ok "密钥已写入 refs.DASHSCOPE_API_KEY（已回读校验）"
    $fp = if ($RealKey.Length -gt 12) { $RealKey.Substring(0,8) + '...' + $RealKey.Substring($RealKey.Length-4) } else { '(短)' }
    Write-Info "密钥指纹: $fp (长度 $($RealKey.Length))"
}

Write-Step "4/5 注册 bundle 到 profile"
if (-not $DryRun) {
    $js = @'
const fs = require("fs");
const p = process.env.PKG_JSON;
const name = process.env.BUNDLE_NAME;
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.dsh = j.dsh || {};
j.dsh.profile = j.dsh.profile || {};
const b = (j.dsh.profile.bundles = j.dsh.profile.bundles || []);
if (!b.includes(name)) b.push(name);
// 同时登记为本地依赖，避免后续 pnpm 把它当作多余内容清理掉
j.dependencies = j.dependencies || {};
if (!j.dependencies[name]) j.dependencies[name] = "file:./node_modules/" + name;
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
'@
    $env:PKG_JSON = $PkgJson; $env:BUNDLE_NAME = $BundleName
    & $NodeBin -e $js
    if ($LASTEXITCODE -ne 0) { Write-Err "注册 bundle 失败"; exit 1 }
}
Write-Ok "dsh.profile.bundles += `"$BundleName`" (并登记 dependencies)"

Write-Step "5/5 校验插件落盘"
if (-not $DryRun) {
    foreach ($f in @('package.json', 'cordis.patch.yml')) {
        if (-not (Test-Path (Join-Path $Dest $f))) { Write-Err "缺少 $Dest\$f"; exit 1 }
    }
    $ids = (Select-String -Path (Join-Path $Dest 'cordis.patch.yml') -Pattern '^\s*- id: ' -AllMatches).Count
    Write-Ok "插件文件完整（含 $ids 条 id 声明）"
}

Write-Host ""
Write-Host "=============================================="
Write-Ok "安装完成"
Write-Host "=============================================="
Write-Host ""
Write-Host "下一步:"
Write-Host "  1. 完全退出 DSH Desktop 应用（右下角托盘图标 -> Exit，或任务管理器结束进程）"
Write-Host "  2. 重新打开 DSH，在模型选择器中应能看到「阿里云百炼 (DashScope)」分组下的 14 个模型"
Write-Host "  3. 若未出现，检查 $ProfileDir 下的启动日志"
Write-Host ""
Write-Host "备份位于: $BackupDir"
Write-Host "回滚:    Copy-Item `"$BackupDir\package.json.bak`" `"$PkgJson`" -Force"
Write-Host "卸载:    powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall"