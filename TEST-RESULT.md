# Deployment Test Result

## v1.1.0 候選修補（2026-09-11 source-only）

在 2026-08-18 候選之上補了出貨前該修的 source/docs，沒有建立 AutoLab、沒有停現有 vSwitch VM、沒有啟動 DHCP/TFTP/HTTP/Torrent：

- Desktop-ready reporter 的 `Clear-AutoLogonSecrets` 改與 SetupComplete 相同的 `{ ok, failures }` 結果，並在 cleanup 失敗時扣住 `windows-desktop-ready`。
- AutoLab example VM 改為 `winception-autolab-01..04` 與 `winception-autolab-ipxe-01`，不再徵用歷史 `winception-client-01..04`。
- `Initialize-WinceptionLab.ps1` 建立 Internal switch 時不再帶 `-AllowManagementOS`（該參數只適用於 external switch）。
- CHANGELOG 把已在候選內的 beginner 工作台、AutoLab CI、project-root validation 從 Unreleased 移入 v1.1.0；`debugging-todo.md` 改寫為「首次登入不要自動登入」仍屬 v1.1.0 之後。

2026-09-11 本機已建立空白 Dynamic base VHDX，並完成一次 AutoLab bootstrap（Internal `Winception-AutoLab` / `192.168.177.1/24`、五台 `winception-autolab-*` Off、`Winception-Clean`）。`Initialize-WinceptionLab.ps1 -ValidateOnly` 通過。Lab 服務 port 檢查改為只把 Lab service IP 與 `0.0.0.0` 視為佔用；Default Switch ICS 的 UDP/67 不再阻擋。沒有啟動 DHCP/TFTP/HTTP/Torrent，也沒有改接歷史 `winception-client-01..04`。尚未跑 `Invoke-WinceptionLabRegression.ps1` 或實體 UEFI IPv4 PXE，因此尚未達正式 Release gate。

## v1.1.0 商品化候選驗證（2026-08-18 current run）

本次候選已實作 Release 零預載／Development fixture 雙軌、State-preserving upgrade/migration、短效 boot-session credential envelope 與 auto-logon cleanup gate。另修正 HostTools 安裝器誤排除產品手冊 PNG、兩份 PXE SetupComplete 換行不一致問題，以及 Development bundle verifier 誤拒合法 fixture tree 的 channel 判斷。

最後一輪 clean checkout 使用本地候選 commit `2d18561889c6de1257f2ccc5ce0b4df6347a25c4`：`node --check`、PowerShell parser、`npm ci --no-audit --no-fund`、`npm run check`、完整測試、`npm run smoke` 與 `git diff --check` 全部通過；完整 `npm test` 為 439 PASS、3 SKIP、0 FAIL，並新增 Release 空白狀態不可啟動服務的回歸測試。

Release bundle 驗證通過 145 個 manifest artifacts，`channel=Release`、`dataPolicy=zero-preload`、`fixturePresence=false`；unsigned RC 的 ZIP、SHA-256 checksum 與 metadata 均在 Git 外部產生，並以該 clean checkout 的 commit/version 寫入 manifest。Development bundle 驗證通過 153 個 artifacts，`dataPolicy=development-fixture`、`fixturePresence=true`，且 fixture 只能由明確 seed 指令載入。Release ZIP 解壓、fresh App/State install 與 fresh-state `serverPreflight` 均通過：`unconfigured`、active profile/image 為 null、profiles 為空，preflight 以 exit code 1 阻擋未設定 endpoint。

完整 `npm test` 在排除目前 Codex runtime 注入的不完整 PackageManagement 路徑後通過：439 PASS、3 SKIP、0 FAIL。可重複的 runner 前置設定如下：

```powershell
$env:PSModulePath = (($env:PSModulePath -split ';') | Where-Object { $_ -and ($_ -notmatch 'codex-primary-runtime') }) -join ';'
npm test
```

這是目前執行環境的 runner 隔離條件，不是產品 runtime 修補。Hyper-V 商品化驗收在 Computer Use 觀察 Hyper-V Manager 後，因目前 PowerShell 未提升權限而停止於 `Initialize-WinceptionLab.ps1 -ValidateOnly` 前；本輪沒有建立 AutoLab、修改 VM/switch、停止 ICS/Docker 或啟動 DHCP/TFTP/HTTP/Torrent。2026-08-18 尚未重新執行隔離 AutoLab 或實體 UEFI IPv4 PXE，因此本候選尚未達正式 Release gate；下方既有部署紀錄均為歷史 evidence。

Authoritative evidence and no-AI operator runbook for a completed from-zero deployment setup test.

**Date validated**: 2026-06-24
**Boot mode**: `secureboot` (default) — Microsoft-signed `bootmgfw.efi` → network BCD → TFTP windowed `boot.wim` → WinPE
**Hardware validated**: Dell physical laptop (Latitude series); Hyper-V Gen2 with Secure Boot ON

## Validated Paths

| Path | Result | Date |
| --- | --- | --- |
| secureboot mode — Dell physical laptop (Latitude), Secure Boot ON | ✔ Deployed to `windows-desktop-ready` | 2026-06-12 |
| secureboot mode — Hyper-V Gen2 (`MicrosoftWindows` SB template, `winception-client-sb-01`), Secure Boot ON | ✔ Deployed to `windows-desktop-ready` | 2026-06-12 |
| secureboot mode — two concurrent Hyper-V clients, striped Torrent P2P offload | ✔ Both clients uploaded while incomplete and reached `windows-desktop-ready` | 2026-06-19 |
| secureboot mode — four concurrent Hyper-V clients, two consecutive rounds | ✔ 8/8 reached `windows-desktop-ready`; every app/script sequence completed 4/4 with exit code 0 | 2026-06-20 |
| USB/ISO offline installer — Hyper-V Gen2 ISO boot, Secure Boot ON, no NIC | ✔ Rebuilt ISO deployed offline to `windows-desktop-ready` | 2026-06-24 |
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

## USB/ISO Offline ISO Validation Evidence — 2026-06-24

The rebuilt offline ISO was validated with a fresh Hyper-V Generation 2 VM and no network adapter:

- ISO: `C:\OSDCloud\Exports\Winception-USB-20260623-143046.iso`
- ISO SHA-256: `B9C0F461CFA51C5823A2D922C8122DA154B24658D70D4B0D3E7F3EC8DE0F2EE8`
- VM: `winception-usb-iso-final-01`
- Firmware: Generation 2, Secure Boot `On`, template `MicrosoftWindows`
- Network: `0` VM network adapters
- Boot order: empty dynamic VHDX first, rebuilt ISO second; first boot fell through to ISO, post-install reboot used the installed Windows disk

PowerShell Direct evidence from the deployed Windows guest:

```text
Computer             : DESKTOP-8PMJK68
User                 : LabAdmin
ExplorerRunning      : True
DesktopReadyFile     : True
DesktopReadyPath     : C:\Users\LabAdmin\Desktop\OSDCloud-Desktop-Ready.txt
ProgressStatus       : succeeded
DeploymentStatusFile : True
SecureBoot           : True
OobeProcesses        : <empty>
```

The run reached `windows-desktop-ready` without a NIC, SMB, torrent, DHCP lease, or host telemetry.

## Unattended PR And Isolated Hyper-V Lab Contract

The source automation added on 2026-08-08 defines the repeatable validation lane; this source-only change did not execute the dedicated runner, create/restore its VMs, start services, run Endpoint Sync, or enable DHCP.

PR pull requests run only in an isolated checkout with Node 24.x, npm ci, JavaScript syntax checks, Windows PowerShell parser checks, npm run check, npm test, npm run smoke, and targeted Web/Lab contract tests. The PR workflow has no service, endpoint, profile publish, or DHCP step.

After a master push, the dedicated Windows self-hosted Hyper-V runner:

1. Acquires the Winception-AutoLab concurrency lock and validates the exact Internal switch, vEthernet adapter, isolated subnet, DHCP binding, five powered-off Gen2 VMs, Secure Boot roles, fixed memory, and Winception-Clean checkpoints.
2. Exports a commit/versioned tracked HostTools bundle with per-file length and SHA-256 manifest; secrets, runtime state, generated media, logs, screenshots, .ai, and untracked files are excluded.
3. Installs the bundle in HostTools App, runs npm ci, restores/prepares the product-managed runtime through existing helpers, synchronizes endpoint/profile/OS image through existing APIs, and runs server:preflight.
4. Runs four Secure Boot VMs in parallel, then one dedicated Secure Boot-off iPXE VM. Each run needs Fleet status completed at windows-desktop-ready plus PowerShell Direct evidence for desktop marker, Explorer, OOBE, Windows version, profile, and app/script sequence. iPXE also needs snponly.efi, boot.ipxe, wimboot, and callback evidence.
5. Stops known Lab services, powers off VMs, restores checkpoints, clears temporary status/operation state, and uploads only redacted evidence on both success and failure. There is no automatic retry.

Required failure tests include preflight blocking without DHCP start, stale/running VM, missing checkpoint, foreign switch/adapter/DHCP binding, occupied port, invalid cache hash, PowerShell Direct timeout, cleanup failure, Ctrl+C, job cancellation, and concurrency collision. A passing isolated Lab run is not production/WAN/LAN DHCP or physical-laptop evidence.

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
