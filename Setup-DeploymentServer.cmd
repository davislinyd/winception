@echo off
setlocal

set "SCRIPT=%~dp0tools\Setup-DeploymentServer.ps1"

if not exist "%SCRIPT%" (
  echo Missing setup script: %SCRIPT%
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "%SCRIPT%" %*
