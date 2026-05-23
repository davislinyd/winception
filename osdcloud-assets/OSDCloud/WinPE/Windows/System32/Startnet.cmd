@ECHO OFF
wpeinit
cd\
title OSD 26.4.23.1
PowerShell -Nol -C Initialize-OSDCloudStartnet
@ECHO OFF
ECHO Start-OSDCloud
PowerShell -NoL -NoP -ExecutionPolicy Bypass -File X:\OSDCloud\Start-OSDCloud-iPXE.ps1
@ECHO ON
