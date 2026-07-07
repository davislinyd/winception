@ECHO OFF
wpeinit
cd\
title OSD 26.4.23.1
PowerShell -NoL -NoP -ExecutionPolicy Bypass -File X:\OSDCloud\Maximize-Console.ps1
@ECHO OFF
ECHO Start-OSDCloud
PowerShell -NoL -NoP -ExecutionPolicy Bypass -File X:\OSDCloud\Start-OSDCloud-iPXE.ps1
@ECHO ON
