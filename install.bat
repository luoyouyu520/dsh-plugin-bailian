@echo off
REM ===========================================================================
REM  dsh-plugin-bailian 一键安装 (Windows)
REM
REM  双击本文件即可安装。它会自动绕过 PowerShell 执行策略限制，
REM  运行同目录下的 install.ps1。
REM
REM  命令行用法:
REM    install.bat              安装
REM    install.bat -Uninstall   卸载
REM    install.bat -DryRun      只预览，不落盘
REM ===========================================================================
setlocal
chcp 65001 >nul 2>&1

set "PS1=%~dp0install.ps1"

if not exist "%PS1%" (
  echo [X] 找不到 install.ps1
  echo     请确认整个 dsh-plugin-bailian 文件夹都被完整解压。
  echo     当前目录: %~dp0
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo 安装脚本执行完毕。按任意键关闭窗口。
) else (
  echo [X] 安装脚本以错误码 %RC% 结束，请把上面的输出发给技术支持。
)
pause
exit /b %RC%