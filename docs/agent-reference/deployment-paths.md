# Agent Reference: Deployment Paths

Layered acceptance: docs/acceptance.md. Router Default Switch attachment is upstream only; AutoLab PXE/client traffic stays Internal Winception-AutoLab. Physical uses ignored onsite config and explicit disposable MAC/UUID, never VM results as physical evidence.

Read this file when a task mentions deployment paths, physical laptop, VM regression, timing runs, USB/ISO, or evidence separation.

## Live Endpoint Rule

Do not assume committed endpoint settings are current. Before physical-laptop validation, read the active service interface/IP, DHCP lease range, router, HTTP base, SMB share, client boot mode (`dhcp.bootMode`), live `boot.ipxe`, host adapter state, and Web/API state immediately before acting.

If the live endpoint is on a non-production subnet, switch deliberately before physical-laptop validation. The service IP and adapter are path-specific values, not universal truth.

## Physical-Laptop Path

This is the active production-like validation path.

- Use the Web-console-selected service interface and service IP.
- Use `npm run web` as the host console.
- Do not use VM-based (VMConnect, PowerShell Direct) evidence for this path.
- A valid physical-laptop PXE test must use UEFI IPv4 PXE with no USB media, no attached ISO, and no manual OOBE clicks on the laptop.
- The client boot chain is selected by `dhcp.bootMode`: `secureboot` (default; Microsoft-signed `bootmgfw.efi` over TFTP, client Secure Boot may stay ON) or `ipxe` (unsigned `snponly.efi` + HTTP wimboot, client Secure Boot must be OFF). Confirm the live mode before validation; evidence is mode-specific.

Physical validation checklist:

1. Confirm the intended service endpoint from live Web/config/runtime state.
2. For `shared-lan`, choose PXE Proxy when the real LAN DHCP server remains active; choose DHCP Server only after it is disabled. For `dual-nic-nat`, confirm the client-only PXE switch has no other DHCP responder and that the PXE client gateway is the Winception vNIC.
3. Confirm the selected service IP exists on an enabled IPv4 adapter with the intended prefix.
4. Run endpoint sync through Web or the explicit endpoint script with WinPE commit and asset sync.
5. Confirm HTTP root includes `boot.ipxe`, `wimboot`, `bootmgr`, `bootx64.efi`, `BCD`, `boot.sdi`, and `boot.wim`. In `secureboot` mode also confirm the TFTP root includes `bootmgfw.efi`, `Boot\BCD`, `Boot\boot.sdi`, `Boot\Fonts`, and `sources\boot.wim` (hardlinked to the published boot.wim).
6. Run preflight and resolve blocked items before starting services.
7. Start HTTP/TFTP/DHCP from the Web console service controls.
8. Boot the physical laptop from UEFI IPv4 PXE with no USB or ISO media. In `secureboot` mode leave Secure Boot enabled (Dell F2: Secure Boot Enabled, Integrated NIC Enabled w/PXE, UEFI-only boot); in `ipxe` mode Secure Boot must be disabled first.
9. Confirm DHCP returns the intended lease range, router, DNS, and the mode-specific boot file: `bootmgfw.efi` (`secureboot`) or `snponly.efi` plus the iPXE boot URL (`ipxe`). In `dual-nic-nat`, router must equal the Winception PXE vNIC and Windows post-logon must resolve DNS and reach HTTPS through WinNAT.
10. Confirm WinPE maps the SMB share, reads `selected-os.json`, applies the selected exported WIM from SMB, posts progress, and reboots.
11. Confirm Windows SetupComplete, app/custom script phases if selected, logon reporting, and final `windows-desktop-ready`.
12. Inspect OSDCloud logs for empty `ImageFileUrl`, `ImageFileDestination` on `Z:\OSDCloud\OS\...`, `ImageFileDestination.PSDrive.DisplayRoot` pointing to `\\<service-ip>\OSDCloudiPXE`, and `OSImageIndex = 1`.
13. Inspect the boot transfer logs for the active mode: in `ipxe` mode the HTTP log must show `boot.ipxe`, `wimboot`, and `boot.wim`; in `secureboot` mode the TFTP log (`pxe-tftp.log`) must show `SENT bootmgfw.efi`, `BCD`, `boot.sdi`, and `boot.wim` (windowed), and `MISS` lines for optional probes such as `SiPolicy.p7b`, `boot.stl`, or locale fonts are normal. In both modes no OS WIM `HEAD` or `GET` should occur in the no-redownload path.

Final physical validation should include:

```text
User             : <computer>\<username>
ExplorerRunning  : True
DesktopReadyFile : True
DesktopReadyPath : C:\Users\<username>\Desktop\OSDCloud-Desktop-Ready.txt
OobeProcesses    : <empty>
LaunchUserOOBE   : 0
SkipUserOOBE     : 1
NoAutoUpdate     : 1
DisplayVersion   : 25H2
CurrentBuild     : 26200
windowsFamily    : Windows 11
ProductName      : may still read Windows 10 Pro
EditionID        : Professional
Culture          : zh-TW
TimeZone         : Taipei Standard Time
FinalStatusStage : windows-desktop-ready
```

**Validated hardware (2026-06-12)**: Dell physical laptop (Latitude series), `secureboot` mode, Secure Boot ON — deployed to `windows-desktop-ready`, `Confirm-SecureBootUEFI` returned `True`. See `TEST-RESULT.md` for the no-AI operator runbook and full evidence record.

## VM Regression Path

Use VM regression only when the user explicitly asks for VM or regression validation.

- Use `tools\Restart-HyperVms.ps1` to prepare `winception-client-01..04` for concurrent PXE validation. It turns each VM off, enforces at least 4 GB fixed startup memory, selects its Generation 2 network adapter as the first boot device, and starts it. Do not lower the memory floor or re-enable Dynamic Memory for concurrent WinPE image application; Hyper-V ballooning below this floor can cause `System.OutOfMemoryException` during module loading or DISM `Expand-WindowsImage`.
- `tools\osdcloud-console\src\headless.js` is allowed only for VM regression automation and must be stopped after the test so DHCP does not keep responding.
- VM success proves the WinPE/OOBE/status workflow still works in a VM. It does not prove the physical-laptop path is ready.
- VM evidence must not overwrite or replace physical-laptop evidence.
- Keep VM names, VM-specific IPs, VHDX details, VMConnect screenshots, and PowerShell Direct results out of physical-laptop evidence.
- Keep detailed VM history and timing evidence in history docs, not in `AGENTS.md`.

### Isolated GitHub Actions Lab Path

- The unattended merge path is a separate acceptance lane from both the physical-laptop path and the historical VM path. It uses only the dedicated Winception-AutoLab Internal switch on 192.168.177.0/24, service 192.168.177.1, and five dedicated Gen2 VMs: `winception-autolab-01..04` plus `winception-autolab-ipxe-01`. These names must not reuse the historical `winception-client-01..04` vSwitch regression VMs. Default resting firmware is Secure Boot On + TPM On (`MicrosoftWindows`) for `01..04` and Secure Boot Off + TPM Off for iPXE. `Winception-Clean` restore drops Hyper-V TPM; Lab restore applies Secure Boot and TPM independently. `Mode All` also proves Secure Boot On + TPM Off and iPXE Secure Boot Off + TPM On. Host `dhcp.bootMode` remains `secureboot` or `ipxe`; `ipxe` still requires client Secure Boot Off.
- The Lab runner guard must reject any external switch, WAN/daily LAN adapter, foreign DHCP binding, non-target VM attached to the Lab switch, running target VM, missing Winception-Clean checkpoint, or a Lab service port already bound on the Lab service IP or `0.0.0.0`. ICS or other DHCP on a different adapter (for example Hyper-V Default Switch UDP/67) is not a Lab occupancy. It must stop before starting a deployment service when a guard fails. The guard must not stop ICS or repair a foreign network.
- The Lab path creates a commit-specific HostTools bundle and does not patch the live runtime directly. Runtime preparation and Endpoint Sync use the existing installed helpers; evidence is copied out only after redaction.
- The merge matrix covers four Secure Boot + TPM On clients in parallel, a Secure Boot-off iPXE TPM Off client, then firmware corners (Secure Boot On + TPM Off and iPXE Secure Boot Off + TPM On). Fleet status and PowerShell Direct guest evidence are both required, including `windowsFamily=Windows 11` from `CurrentBuild` >= 22000 and a separate round `hostFirmware` object. 2026-09-14 local `Mode All` e is AutoLab green. A Lab result does not prove production DHCP, a physical laptop, or a WAN/LAN endpoint is ready.
- On success, failure, Ctrl+C, or job cancellation, cleanup must attempt service stop, VM stop, checkpoint restore, original profile/endpoint restore with the preflight timeout, wait for the console operation to go idle, then restore `secureboot`, clear temporary status, and preserve evidence. No automatic retry or production release is part of this path.

## Retired ISO Path

- `C:\OSDCloud\Win11-Lab` and `OSDCloud_NoPrompt.iso` are retired historical evidence.
- Do not require or restore the retired ISO path for fresh-host setup, endpoint sync, asset sync, physical deployment, or bundle restore.
- `New-WinceptionUsbInstaller.cmd -Iso` is a separate immutable snapshot export and must not reuse or restore `Win11-Lab`.

## USB/ISO Offline Add-On Path

- Run `New-WinceptionUsbInstaller.cmd` only from elevated PowerShell. Use `-CheckOnly` before destructive USB work.
- Read merged installed config and active deployment manifests immediately before export. The snapshot owns selected WIM, active profile Apps/Scripts, current driver pack payloads with sanitized matching metadata, boot files, SetupComplete/Shutdown sources, and local deployment secrets. Do not carry driver run/client/download history into the media.
- Staging belongs under installed HostTools State `.staging\winception-usb`; do not patch or copy directly into the live runtime `Media` tree.
- USB output is GPT/UEFI x64 with FAT32 `WinPE` and NTFS `OSDCloudUSB`. Reject boot/system/non-USB disks and require exact `ERASE DISK <number>` confirmation after displaying model, serial, and size.
- ISO output is no-prompt UDF and defaults to `<project-root>\Exports`. Generated ISO files remain ignored sensitive artifacts.
- `-OpenInRufus` may pass only the ISO and NTFS preference. It must not download Rufus, select a target disk, simulate UI, or start writing.
- Offline boot requires exactly one eligible internal target disk. The client validates the media manifest before disk changes and refuses a second wipe only after deployed Windows contains the same media ID plus completed `appliedAt` marker. Offline Windows progress is read from `DeploymentStatus.json.localStatus`.
- USB/ISO evidence is media-specific and does not prove physical PXE readiness. PXE regression evidence does not prove offline media readiness.
