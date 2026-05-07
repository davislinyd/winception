@echo off
set LOGDIR=C:\Windows\Temp\osdcloud-logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
%windir%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0SetupComplete.ps1" >> "%LOGDIR%\davis-oobe.log" 2>&1
exit /b 0
