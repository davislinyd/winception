@echo off
setlocal

set "SCRIPT=%~dp0tools\New-WinceptionUsbInstaller.ps1"

if not exist "%SCRIPT%" (
  echo Missing USB installer script: %SCRIPT%
  exit /b 1
)

%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
exit /b %ERRORLEVEL%
