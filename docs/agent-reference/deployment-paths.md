# Agent Reference: Deployment Paths

Read this file when a task mentions deployment paths, physical laptop, VM, VM regression, vSwitch, timing runs, ISO, or evidence separation.

## Live Endpoint Rule

Do not assume committed endpoint settings are current. Before physical-laptop validation, read the active service interface/IP, DHCP lease range, router, HTTP base, SMB share, live `boot.ipxe`, host adapter state, and Web/API state immediately before acting.

If the live endpoint is on a VM/vSwitch subnet, switch deliberately before physical-laptop validation. Values such as `LAN`, `192.168.88.1`, `Ethernet`, and `192.168.100.1` are examples or path-specific values, not universal truth.

## Physical-Laptop Path

This is the active production-like validation path.

- Use the Web-console-selected service interface and service IP.
- Use `npm run web` as the host console.
- Do not use VM, `vSwitch`, `192.168.100.1`, VMConnect, PowerShell Direct, or `tools\osdcloud-console\src\headless.js` as evidence for this path.
- A valid physical-laptop iPXE test must use UEFI IPv4 PXE with no USB media, no attached ISO, and no manual OOBE clicks on the laptop.

Physical validation checklist:

1. Confirm the intended service endpoint from live Web/config/runtime state.
2. Confirm the real network DHCP server is disabled for the test window.
3. Confirm the selected service IP exists on an enabled IPv4 adapter with the intended prefix.
4. Run endpoint sync through Web or the explicit endpoint script with WinPE commit and asset sync.
5. Confirm HTTP root includes `boot.ipxe`, `wimboot`, `bootmgr`, `bootx64.efi`, `BCD`, `boot.sdi`, and `boot.wim`.
6. Run preflight and resolve blocked items before starting services.
7. Start HTTP/TFTP/DHCP from the Web console service controls.
8. Boot the physical laptop from UEFI IPv4 PXE with no USB or ISO media.
9. Confirm DHCP returns the intended lease range, router, DNS, `snponly.efi`, and the iPXE boot URL for the selected endpoint.
10. Confirm WinPE maps the SMB share, reads `selected-os.json`, applies the selected exported WIM from SMB, posts progress, and reboots.
11. Confirm Windows SetupComplete, app/custom script phases if selected, logon reporting, and final `windows-desktop-ready`.
12. Inspect OSDCloud logs for empty `ImageFileUrl`, `ImageFileDestination` on `Z:\OSDCloud\OS\...`, `ImageFileDestination.PSDrive.DisplayRoot` pointing to `\\<service-ip>\OSDCloudiPXE`, and `OSImageIndex = 1`.
13. Inspect HTTP logs for `boot.ipxe`, `wimboot`, and `boot.wim`; no OS WIM `HEAD` or `GET` should occur in the no-redownload path.

Final physical validation should include:

```text
User             : <computer>\davis
ExplorerRunning  : True
DesktopReadyFile : True
DesktopReadyPath : C:\Users\davis\Desktop\OSDCloud-Desktop-Ready.txt
OobeProcesses    : <empty>
LaunchUserOOBE   : 0
SkipUserOOBE     : 1
NoAutoUpdate     : 1
DisplayVersion   : 25H2
CurrentBuild     : 26200
EditionID        : Professional
Culture          : zh-TW
TimeZone         : Taipei Standard Time
FinalStatusStage : windows-desktop-ready
```

## VM VM Regression Path

Use VM regression only when the user explicitly asks for VM, VM, vSwitch, timing, or regression validation.

- Use `Ethernet` / `192.168.100.1` only for VM regression.
- `tools\osdcloud-console\src\headless.js` is allowed only for VM regression automation and must be stopped after the test so DHCP does not keep responding.
- VM success proves the WinPE/OOBE/status workflow still works in VM. It does not prove the physical-laptop path is ready.
- VM evidence must not overwrite or replace physical-laptop evidence.
- Keep VM names, vSwitch IPs, VHDX details, VMConnect screenshots, and PowerShell Direct results out of physical-laptop evidence.
- Keep detailed VM history and timing evidence in the test report or history docs, not in `AGENTS.md`.

## Retired ISO Path

- `C:\OSDCloud\Win11-Lab` and `OSDCloud_NoPrompt.iso` are retired historical evidence.
- Do not require or restore the retired ISO path for fresh-host setup, endpoint sync, asset sync, physical deployment, or bundle restore.
- If an ISO path is needed again, create it as a separate new task.
