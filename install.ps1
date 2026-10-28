#requires -Version 5.1
# Windows installer. Keys belong in the local credential store, never this package.
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$DryRun,
    [string]$Profile,
    [string]$ApiKey,
    [switch]$NonInteractive,
    [switch]$SkipVerify
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$BundleName = 'dsh-plugin-bailian'
$ScriptDir = $PSScriptRoot
$ProfileName = if ($Profile) { $Profile } elseif ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }
if ($ProfileName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$' -or $ProfileName.EndsWith('.')) {
    Write-Error 'Profile must be a simple name, such as desktop or web.'
    exit 1
}
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$ProfileDir = Join-Path $DshHome "profiles\$ProfileName"
$PkgJson = Join-Path $ProfileDir 'package.json'
$PatchYml = Join-Path $ProfileDir 'cordis.patch.yml'
$CredsFile = Join-Path $DshHome '.credentials.yaml'
$Dest = Join-Path $ProfileDir "node_modules\$BundleName"

function Test-NodeCandidate {
    param([string]$Candidate)
    if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { return $false }
    try {
        $v = & $Candidate --version 2>$null
        return ($LASTEXITCODE -eq 0 -and "$v" -match '^v(1[89]|[2-9][0-9])\.')
    } catch { return $false }
}

function Find-Node {
    $candidates = @($env:DSH_NODE)
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $candidates += $nodeCommand.Source }
    $appRoots = @()
    foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432)) {
        if ($base) { $appRoots += (Join-Path $base 'DeepSeek Harness'), (Join-Path $base 'Programs\DeepSeek Harness') }
    }
    # Custom installation directories are recorded by the Windows uninstaller.
    foreach ($registry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        Get-ItemProperty -Path $registry -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^DeepSeek Harness(?:\s|$)' } | ForEach-Object {
            if ($_.InstallLocation) { $appRoots += $_.InstallLocation }
            elseif ($_.DisplayIcon) { $appRoots += Split-Path ($_.DisplayIcon -replace ',\d+$', '').Trim('"') -Parent }
        }
    }
    foreach ($root in ($appRoots | Select-Object -Unique)) {
        $candidates += Join-Path $root 'resources\runtime\primary-runtime\dependencies\node\node.exe'
        $candidates += Join-Path $root 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    }
    foreach ($candidate in $candidates) { if (Test-NodeCandidate $candidate) { return $candidate } }
    throw 'Node 18+ not found. Install Node, or set DSH_NODE to the bundled node.exe.'
}

function Invoke-Bundle {
    param([string]$Mode)
    $previousPkg = $env:PKG_JSON
    $previousName = $env:BUNDLE_NAME
    try {
        $env:PKG_JSON = $PkgJson
        $env:BUNDLE_NAME = $BundleName
        & $NodeBin (Join-Path $ScriptDir 'bundle-register.mjs') $Mode
        if ($LASTEXITCODE -ne 0) { throw 'Invalid profile package.json or bundle registration failed.' }
    } finally {
        $env:PKG_JSON = $previousPkg
        $env:BUNDLE_NAME = $previousName
    }
}

function Invoke-Credential {
    param([switch]$Check)
    $argsForNode = @((Join-Path $ScriptDir 'write-credential.mjs'), $CredsFile)
    if ($Check) { $argsForNode += '--check' }
    # stdin keeps the key out of process command lines.
    $RealKey | & $NodeBin @argsForNode
    if ($LASTEXITCODE -ne 0) { throw 'Credential update failed; original credentials were preserved.' }
}

function Assert-NoLink {
    param([string]$Target)
    if ((Test-Path -LiteralPath $Target) -and ((Get-Item -Force -LiteralPath $Target).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing to modify a linked directory: $Target"
    }
}

$InstallLock = $null
$LockHeld = $false
try {
    foreach ($file in @($PkgJson, $PatchYml)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "DSH profile file not found: $file. Start DSH once first." }
    }
    foreach ($file in @('cordis.patch.yml', 'package.json', 'write-credential.mjs', 'bundle-register.mjs')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ScriptDir $file) -PathType Leaf)) { throw "Incomplete package: $file" }
    }
    $sourcePackage = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $ScriptDir 'package.json') | ConvertFrom-Json
    if ($sourcePackage.name -ne $BundleName -or $sourcePackage.dsh.bundle.patch -ne './cordis.patch.yml') { throw 'Invalid source bundle manifest.' }
    $NodeBin = Find-Node
    Invoke-Bundle validate
    foreach ($directory in @($ProfileDir, (Join-Path $ProfileDir 'node_modules'), $Dest)) { Assert-NoLink $directory }
    Write-Host "DSH profile: $ProfileDir"
    Write-Host "Plugin: $BundleName $($sourcePackage.version)"
    if ($DryRun) {
        Write-Host '[dry-run] Validated; no files written and no network request made.'
        exit 0
    }

    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $lockId = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($ProfileDir).ToLowerInvariant()))).Replace('-', '') }
    finally { $hasher.Dispose() }
    $InstallLock = [Threading.Mutex]::new($false, "Local\bailian-$lockId")
    try { $LockHeld = $InstallLock.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $LockHeld = $true }
    if (-not $LockHeld) { throw 'Another installer is using this profile. Wait for it to finish.' }
    Invoke-Bundle validate

    $RealKey = ''
    if (-not $Uninstall) {
        $keyFile = Join-Path $ScriptDir 'dashscope.key'
        if ($ApiKey) { $RealKey = $ApiKey.Trim() }
        elseif ($env:DASHSCOPE_API_KEY) { $RealKey = $env:DASHSCOPE_API_KEY.Trim() }
        elseif (Test-Path -LiteralPath $keyFile) { $RealKey = (Get-Content -Raw -Encoding UTF8 -LiteralPath $keyFile).Trim() }
        elseif (-not $NonInteractive) {
            Write-Host 'Enter your own DashScope API key (blank = keep existing credentials).'
            if ([Console]::IsInputRedirected) { $RealKey = [Console]::ReadLine() }
            else {
                $secure = Read-Host 'API Key' -AsSecureString
                $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
                try { $RealKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
                finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
            }
            if ($RealKey) { $RealKey = $RealKey.Trim() }
        }
        if ($RealKey) {
            if ($RealKey -notmatch '^sk-[A-Za-z0-9_-]+$') { throw 'Invalid API key format; expected sk- followed by letters, numbers, underscores or hyphens.' }
            Invoke-Credential -Check
            if (-not $SkipVerify) {
                try {
                    Invoke-WebRequest -Uri 'https://dashscope.aliyuncs.com/compatible-mode/v1/models' -Headers @{ Authorization = "Bearer $RealKey" } -TimeoutSec 20 -UseBasicParsing | Out-Null
                    Write-Host '[OK] API key verified.'
                } catch {
                    $statusCode = 0
                    if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
                    if ($statusCode -eq 401 -or $statusCode -eq 403) { throw 'DashScope rejected this key (401/403); no files changed.' }
                    Write-Warning 'DashScope could not be reached; saving the key without online verification.'
                }
            }
        } else { Write-Host 'Existing credentials kept. If none exist, configure a key before using the models.' }
    }

    $BackupDir = Join-Path $ProfileDir ('.bailian-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
    Copy-Item -LiteralPath $PkgJson -Destination (Join-Path $BackupDir 'package.json.bak')
    Copy-Item -LiteralPath $PatchYml -Destination (Join-Path $BackupDir 'cordis.patch.yml.bak')
    $HadCredentials = Test-Path -LiteralPath $CredsFile
    if ($HadCredentials -and $RealKey) { Copy-Item -LiteralPath $CredsFile -Destination (Join-Path $BackupDir 'credentials.yaml.bak') }
    $HadPlugin = Test-Path -LiteralPath $Dest
    if ($HadPlugin) { Copy-Item -LiteralPath $Dest -Destination (Join-Path $BackupDir 'plugin') -Recurse }

    try {
        if ($Uninstall) {
            Invoke-Bundle unregister
            if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force }
            Write-Host '[OK] Uninstalled. Credentials kept.'
        } else {
            if ((Test-Path -LiteralPath $Dest) -and ([IO.Path]::GetFullPath($ScriptDir) -ne [IO.Path]::GetFullPath($Dest))) {
                Remove-Item -LiteralPath $Dest -Recurse -Force
            }
            New-Item -ItemType Directory -Path $Dest -Force | Out-Null
            foreach ($file in @('package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'CHANGELOG.md', 'TEST-REPORT.txt', 'install.ps1', 'install.bat', 'write-credential.mjs', 'bundle-register.mjs')) {
                $source = Join-Path $ScriptDir $file
                if ((Test-Path -LiteralPath $source) -and ([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath((Join-Path $Dest $file)))) {
                    Copy-Item -LiteralPath $source -Destination (Join-Path $Dest $file) -Force
                }
            }
            if ($RealKey) { Invoke-Credential }
            Invoke-Bundle register
            Write-Host '[OK] Installed. Fully exit and reopen DeepSeek Harness to load the models.'
        }
    } catch {
        $installFailure = $_
        $restoreSteps = @(
            @{ Label = 'package.json'; Action = { Copy-Item -LiteralPath (Join-Path $BackupDir 'package.json.bak') -Destination $PkgJson -Force } },
            @{ Label = 'credentials'; Action = {
                if ($RealKey -and $HadCredentials) { Copy-Item -LiteralPath (Join-Path $BackupDir 'credentials.yaml.bak') -Destination $CredsFile -Force }
                elseif ($RealKey -and (Test-Path -LiteralPath $CredsFile)) { Remove-Item -LiteralPath $CredsFile -Force }
            } },
            @{ Label = 'new plugin'; Action = { if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force } } },
            @{ Label = 'old plugin'; Action = {
                if ($HadPlugin) {
                    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
                    Get-ChildItem -Force -LiteralPath (Join-Path $BackupDir 'plugin') | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Dest -Recurse -Force }
                }
            } }
        )
        foreach ($step in $restoreSteps) {
            try { & $step.Action }
            catch { Write-Warning "Rollback failed for $($step.Label). Restore from $BackupDir manually." }
        }
        throw $installFailure
    }
    Write-Host "Backup (contains private credentials; do not share): $BackupDir"
    exit 0
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($LockHeld) { $InstallLock.ReleaseMutex() }
    if ($InstallLock) { $InstallLock.Dispose() }
}
