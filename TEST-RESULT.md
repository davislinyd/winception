# Deployment Test Result

Authoritative evidence and no-AI operator runbook for a completed from-zero deployment setup test.

**Date validated**: 2026-06-12
**Boot mode**: `secureboot` (default) — Microsoft-signed `bootmgfw.efi` → network BCD → TFTP windowed `boot.wim` → WinPE
**Hardware validated**: Dell physical laptop (Latitude series); Hyper-V Gen2 with Secure Boot ON

## Validated Paths

| Path | Result | Date |
| --- | --- | --- |
| secureboot mode — Dell physical laptop (Latitude), Secure Boot ON | ✔ Deployed to `windows-desktop-ready` | 2026-06-12 |
| secureboot mode — Hyper-V Gen2 (`MicrosoftWindows` SB template, `winception-client-sb-01`), Secure Boot ON | ✔ Deployed to `windows-desktop-ready` | 2026-06-12 |
| secureboot mode — SB OFF (fallback; boot chain still MS-signed, boots without SB enforcement) | ✔ Reached WinPE and apply-image | 2026-06-12 |
| ipxe mode regression — `snponly.efi` → `boot.ipxe` → wimboot → WinPE | ✔ WinPE callback confirmed | 2026-06-12 |

## Rebuild From Zero (No-AI Runbook)

Steps to bring a fresh Windows host from a clean clone to PXE-ready state.

### 1. Clone and run setup wizard

```powershell
git clone <repo-url> <repo-root>
cd '<repo-root>'
.\Setup-DeploymentServer.cmd
```

Setup installs Node.js LTS if missing, installs the host management bundle to `C:\OSDCloud\HostTools`, runs `npm install` and smoke tests, and starts the Web console at `http://127.0.0.1:8080`.

### 2. Guided Setup in Web console

Open `http://127.0.0.1:8080` and run **Guided Setup** (Initialization Wizard):

1. **Project root** — confirm `C:\OSDCloud` (or choose a different root)
2. **Deployment secrets** — set `windowsUsername`, `windowsPassword`, `pxeinstallPassword` via Web form; written to ignored `config\osdcloud-secrets.json`
3. **Prepare runtime** — downloads and verifies all `config\runtime-artifacts.json` entries, builds WinPE `boot.wim`, stages the Secure Boot TFTP tree (`PXE-TFTP\bootmgfw.efi`, `Boot\BCD`, `Boot\boot.sdi`, `Boot\Fonts`, `sources\boot.wim` hardlink)
4. **Select endpoint** — choose service NIC (e.g., `LAN 192.168.88.1/24`); syncs `boot.ipxe`, WinPE endpoint, SMB firewall, and publishes `boot.wim`
5. **OS Image Cache** — download or import Windows ISO/ESD; select DISM index; export deployable WIM
6. **Publish profile** — set active profile (`Default` / `All in One` / `Minimal`) to bind OS image and publish `selected-os.json`
7. **Run preflight** — all checks must pass before starting services

### 3. Confirm boot mode

Default boot mode is `secureboot`. Check in Web console under **Endpoint Settings → Client Boot Mode** or read `config\osdcloud-console.json` → `dhcp.bootMode`.

- **secureboot**: leave client Secure Boot ON (Dell: F2 → Secure Boot Enabled, Microsoft Windows mode; UEFI-only boot; Integrated NIC with PXE). No BIOS changes needed for Dell Latitude or Dell Pro 14.
- **ipxe**: client Secure Boot must be disabled (BIOS F2 → Secure Boot = Disabled) before PXE boot.

### 4. Pre-deployment checks

- Confirm `PXE-TFTP\bootmgfw.efi`, `Boot\BCD`, `Boot\boot.sdi`, `sources\boot.wim` exist (secureboot mode)
- Confirm real LAN DHCP server is disabled
- Run preflight — all items green before starting services

### 5. Start services and boot

```text
Web console → Start all services
Client → F12 → UEFI IPv4 PXE (no USB, no ISO)
```

### 6. Expected deployment evidence

TFTP log (`pxe-tftp.log`) must show:

```text
RRQ bootmgfw.efi
SENT bootmgfw.efi
RRQ Boot/BCD
SENT Boot/BCD
RRQ Boot/boot.sdi
SENT Boot/boot.sdi
RRQ sources/boot.wim
SENT sources/boot.wim  windowSize=16
```

`MISS` lines for `SiPolicy.p7b`, `SecureBootPolicy.p7b`, `boot.stl`, locale fonts are normal — bootmgr probes these as optional.

Web console `Client Fleet` must reach `windows-desktop-ready`. Final state on deployed Windows:

```text
User             : <computer>\<windowsUsername>
ExplorerRunning  : True
DesktopReadyFile : True
DesktopReadyPath : C:\Users\<windowsUsername>\Desktop\OSDCloud-Desktop-Ready.txt
OobeProcesses    :
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

Run on deployed client to confirm Secure Boot state:

```powershell
Confirm-SecureBootUEFI   # should return True
```

### 7. Post-deployment

- Stop DHCP/TFTP/HTTP in Web console
- Restore real LAN DHCP server if it was disabled for testing
- Run `.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts` and commit if any tracked files changed

## Configuration at Time of Validation

```json
{
  "dhcp": {
    "bootMode": "secureboot",
    "secureBootFile": "bootmgfw.efi",
    "bootFile": "ipxeboot/x86_64-sb/snponly.efi",
    "ipxeBootUrl": "http://<service-ip>/osdcloud/boot.ipxe"
  }
}
```

TFTP BCD parameters (in `PXE-TFTP\Boot\BCD`):

```text
ramdisktftpblocksize : 1456
ramdisktftpwindowsize: 16
```

boot.wim transfer time at windowsize=16: ~11–15 seconds (~39 MB/s for 577 MB).
