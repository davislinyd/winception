# Deployment Test Result

Authoritative evidence and no-AI operator runbook for a completed from-zero deployment setup test.

**Date validated**: 2026-06-20
**Boot mode**: `secureboot` (default) — Microsoft-signed `bootmgfw.efi` → network BCD → TFTP windowed `boot.wim` → WinPE
**Hardware validated**: Dell physical laptop (Latitude series); Hyper-V Gen2 with Secure Boot ON

## Validated Paths

| Path | Result | Date |
| --- | --- | --- |
| secureboot mode — Dell physical laptop (Latitude), Secure Boot ON | ✔ Deployed to `windows-desktop-ready` | 2026-06-12 |
| secureboot mode — Hyper-V Gen2 (`MicrosoftWindows` SB template, `winception-client-sb-01`), Secure Boot ON | ✔ Deployed to `windows-desktop-ready` | 2026-06-12 |
| secureboot mode — two concurrent Hyper-V clients, striped Torrent P2P offload | ✔ Both clients uploaded while incomplete and reached `windows-desktop-ready` | 2026-06-19 |
| secureboot mode — four concurrent Hyper-V clients, two consecutive rounds | ✔ 8/8 reached `windows-desktop-ready`; every app/script sequence completed 4/4 with exit code 0 | 2026-06-20 |
| secureboot mode — SB OFF (fallback; boot chain still MS-signed, boots without SB enforcement) | ✔ Reached WinPE and apply-image | 2026-06-12 |
| ipxe mode regression — `snponly.efi` → `boot.ipxe` → wimboot → WinPE | ✔ WinPE callback confirmed | 2026-06-12 |

## Torrent P2P Offload Evidence — 2026-06-19

Two concurrent Secure Boot clients downloaded the 6,368,481,430-byte WIM through one striped host batch:

- `192.168.77.202:7202` received host slot `0/2`; `192.168.77.201:7201` received slot `1/2`. Each host bitfield contained only its interleaved half of the pieces.
- Before completion, tracker counters increased on both clients. Final client uploads were 3,185,004,694 bytes (`.202`) and 3,183,476,736 bytes (`.201`). Each completion event identified the other client as both a Peer source and receiver.
- The active download batch served 3,185,004,694 bytes to `.202` and 3,183,476,736 bytes to `.201`: 6,368,481,430 bytes total, exactly `1.000x` WIM size rather than `2.000x`. Batch `0` did not enter `PEER-FALLBACK`.
- Both clients passed SHA-256 verification. Runs `20260619-221504-9139-9236-4890-0748-8921-6350-41` and `20260619-221511-3714-2415-4875-1592-7324-5531-21` finished at `windows-desktop-ready` 100%.
- Each run wrote two `torrent-download` events and one completion-only `torrent-peers` event; five-second RPC polling did not create periodic host status events.

## Four-Client Regression Evidence — 2026-06-20

Two consecutive Secure Boot rounds used four concurrent Hyper-V Gen2 clients with fixed 4 GiB startup memory:

- Round 1: runs `20260620-103733-3165-2914-1943-0908-5094-0852-36`, `20260620-103742-0885-8703-1155-6903-2654-8648-29`, `20260620-103745-3714-2415-4875-1592-7324-5531-21`, and `20260620-103747-9139-9236-4890-0748-8921-6350-41`.
- Round 2: runs `20260620-113452-0885-8703-1155-6903-2654-8648-29`, `20260620-113452-3165-2914-1943-0908-5094-0852-36`, `20260620-113455-3714-2415-4875-1592-7324-5531-21`, and `20260620-113457-9139-9236-4890-0748-8921-6350-41`.
- All 8 runs reached `windows-desktop-ready`. Each `windows-setupcomplete-finished` event reported app installer exit code `0`, empty stderr, and successful completion of Chrome, 7-Zip, custom script `SC-J5GF07Y2`, and Notepad++ (`SW-4UT7PDID`). No run contained an `error` or `timeout` terminal stage.
- The regression covers the Hyper-V WinPE memory reservation and monotonic client timers used across Hyper-V clock corrections.

## USB/ISO Add-On PXE Regression Evidence — 2026-06-23

After adding the independent USB/ISO offline installer, the existing Secure Boot PXE path was revalidated with four concurrent Hyper-V Gen2 clients on `vEthernet (vSwitch)` / `192.168.77.1/24`.

- Preflight passed 29/29 checks, including published `boot.wim` sync, Secure Boot TFTP tree, SMB image access, OS image, and active profile payload.
- Runs `20260623-090613-3165-2914-1943-0908-5094-0852-36`, `20260623-090613-9139-9236-4890-0748-8921-6350-41`, `20260623-090616-0885-8703-1155-6903-2654-8648-29`, and `20260623-090619-3714-2415-4875-1592-7324-5531-21` all reached `windows-desktop-ready` at 100%.
- The PXE no-redownload evidence remained unchanged: each `osdcloud-finished` event reported empty `ImageFileUrl`, `ImageFileDestination.PSDrive.DisplayRoot` as `\\192.168.77.1\OSDCloudiPXE`, and `OSImageIndex = 1`.
- Torrent seed wait was released manually through the Web API after image apply. Services were stopped after completion.

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
