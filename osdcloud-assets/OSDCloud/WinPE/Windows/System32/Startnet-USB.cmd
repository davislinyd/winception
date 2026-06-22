@ECHO OFF
wpeinit
cd\
title Winception USB Zero-Touch Installer
PowerShell -NoL -NoP -ExecutionPolicy Bypass -File X:\OSDCloud\Maximize-Console.ps1
PowerShell -Nol -C Initialize-OSDCloudStartnet
@ECHO OFF
ECHO Start Winception USB zero-touch installation
PowerShell -NoL -NoP -ExecutionPolicy Bypass -File X:\OSDCloud\Start-OSDCloud-USB.ps1
@ECHO ON
