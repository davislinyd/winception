@echo off
setlocal

set "SCRIPT=%~dp0tools\Initialize-DeploymentServer.ps1"

if not exist "%SCRIPT%" (
  echo Missing bootstrap script: %SCRIPT%
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','%SCRIPT%') -Verb RunAs"
