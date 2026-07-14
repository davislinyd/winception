# Deployment Test Result

Authoritative versioned evidence and no-AI operator runbook. Evidence proves only the exact version, layer, path and date shown; historical v1 evidence does not constitute v2 release acceptance.

## Release-readiness matrix

| Version | Source/CI | Installed bundle/MSI | VM deployment | Physical laptop | Decision |
|---|---|---|---|---|---|
| `2.0.0-alpha.4` / `codex/v2-rewrite` | Local gates verified 2026-07-14: v1 405/405 including 3 real aria2 integrations; v2 41/41; 0 skipped. Global coverage 93.88% line/84.77% branch; critical coverage 99.28%/92.23%. Typecheck, lint, zero-cycle, docs/diagram/OpenAPI drift, 38-file PowerShell parse, Web E2E 3/3, Docs E2E 2/2, Gitleaks and production audit passed; remote CI intentionally not run. Regression gates cover the WiX directory argument and optional loopback TLS settings in provisioning and health probe | MSI SHA-256 `9A288103053F2ED56F912473906B08B0E3E0E570DADB4912CBECA552E9ACB509`; bootstrap SHA-256 `103C9D5774C06635CE42C40D4D7DA573A92203BAF28C16D68894EECD98D9234B`; expected signer thumbprint `80A4429C308A3BFF0A12107DA8F1C5AB21DE4733`. Administrative extraction matched 6,842/6,842 manifest files and 68/68 applicable signatures | Fresh Windows 11 Pro VM `OSD Server`: `Check` 20/20; fresh install, repair and reinstall each 34/34; Agent LocalSystem and Web LocalService Running; protected State ACL, unrestricted Web service SID, restricted pipe DACL, SQLite, health, login, profile read and `/manual/` passed. Uninstall removed binaries/services and preserved State/SQLite; profile `3SBXNSOP` persisted after reinstall. PXE client and Software Test remain open | Not run | Approved for internal test prerelease distribution and installed-host testing only; deployment acceptance remains open |
| `2.0.0-alpha.3` / `codex/v2-rewrite` | Local gates verified 2026-07-14: v1 405/405 including 3 real aria2 integrations; v2 41/41; 0 skipped. Global coverage 93.88% line/84.77% branch; critical coverage 99.28%/92.23%. Typecheck, lint, zero-cycle, docs/diagram/OpenAPI drift, 37-file PowerShell parse and build passed. The bootstrap regression creates a missing registry store key, verifies repeated initialization, accepts only the expected untrusted self-signed chain, and rejects `HashMismatch`. Chromium Web E2E 3/3 and bilingual Docs E2E 2/2 passed; production audit reported 0 vulnerabilities; remote CI intentionally not run | Candidate MSI SHA-256 `50D14CE030760CBA269E74BF74E3BA2C81A058766C2EB319D570063E994F6DEB`; bootstrap SHA-256 `DCEFDED110B9D1339CBE1CD2D65354F2BDB0855506F31EEFA5A12A386F09AD09`. MSI/bootstrap signatures use the expected thumbprint `80A4429C308A3BFF0A12107DA8F1C5AB21DE4733`. Administrative extraction matched 6,842/6,842 manifest files and 68/68 applicable signatures; packaged version is `2.0.0-alpha.3`, and the bootstrap/offline manual contain the store-key fix | Fresh VM `Check` passed and both certificate stores were populated. MSI then failed at `ProvisionServiceSettings` because WiX emitted a quote-adjacent trailing directory separator; rollback left no installed product or services | Not run | Superseded by alpha.4; assets remain immutable |
| `2.0.0-alpha.2` / `codex/v2-rewrite` | Local gates verified 2026-07-14: v1 405/405 including 3 real aria2 integrations; v2 41/41; 0 skipped. Global coverage 93.88% line/84.77% branch; critical coverage 99.28%/92.23%. Typecheck, lint, zero-cycle, docs/diagram/OpenAPI drift, 37-file PowerShell parse and build passed. A temporary untrusted code-signing cert reproduced clean-host `UnknownError`; the expected self-signed chain passed, while a modified signed payload returned and was blocked as `HashMismatch`. Chromium Web E2E 3/3 and bilingual Docs E2E 2/2 passed; audit and Gitleaks reported 0 findings; remote CI intentionally not run | Candidate MSI SHA-256 `1E37967389D92771596C004306851AB268388B93B56C776D29D9C2AC872CCD57`; bootstrap SHA-256 `E97A35B2831FA63546C395678A8141A713B593449F4B75702D6C53C693F93D03`. MSI/bootstrap signatures use the expected thumbprint `80A4429C308A3BFF0A12107DA8F1C5AB21DE4733`. Administrative extraction matched 6,842/6,842 manifest files and 68/68 applicable signatures. Packaged Agent/Web passed version `2.0.0-alpha.2`, Agent ready, health 200, login 200, profile read 200, `/manual/` 200 and SQLite creation | Fresh VM `Check` passed. `Install` imported the expected certificate into Root, then failed before MSI start because the machine-level TrustedPublisher registry store key did not exist; `RootTrusted=True`, `PublisherTrusted=False` | Not run | Superseded by alpha.3; assets remain immutable |
| `2.0.0-alpha.1` / `codex/v2-rewrite` | Local gates verified 2026-07-14: v1 405/405 including 3 real aria2 integrations; v2 41/41; 0 skipped. Global coverage 93.88% line/84.77% branch; critical contracts/coordinator/persistence/migration/IPC 99.28%/92.23%. Typecheck, lint, zero-cycle, docs/diagram/OpenAPI drift, 36-file PowerShell parse and build passed. Chromium Web E2E 3/3 and bilingual Docs E2E 2/2 passed; 11 zh-TW/English doc IDs are in parity. Production audit: 0 vulnerabilities. Pinned Gitleaks scanned 373 commits plus working tree with 0 findings. Remote CI intentionally not run | Candidate MSI SHA-256 `E2EFCEE6EE3E9B1191C27E5DDA814EE7B714B59F7D316BA7432FECCE527D0E27`; bootstrap SHA-256 `0D19F91B3DADA25DC1698A36D42F84D269FC74D10B1374BC6C382828B0FD2A69`. MSI/bootstrap Authenticode and exported self-signed CER are valid. Administrative extraction matched all 6,842 manifest files; all 68 EXE/DLL/PS1 payloads had valid signatures. Complete `AGPL-3.0-only` license, SBOM, Node/WinSW licenses and offline `/manual/` CSP manifest are present. Extracted Node 24.15.0 Agent/Web passed Agent ready, health 200, login 200, profile read 200, `/manual/` 200 and SQLite creation. Bootstrap `Check` passed 20/20 without secret-named report fields. Current shell is not elevated, so actual per-machine service install/repair/uninstall and installed service-SID access proof remain unrecorded | Not run | Not run | Approved for internal test prerelease distribution only; elevated VM acceptance remains open |
| `v0.6.7` / `08be089` | Frozen Git restore point created 2026-07-13 | No new installed-bundle acceptance recorded for this exact commit in this document | Earlier-version evidence below | Earlier-version evidence below | Stable v1 source line; historical deployment evidence must not be relabelled as v0.6.7 acceptance |

`v2.0.0-alpha.1` is superseded because it rejected the expected untrusted self-signed root. `v2.0.0-alpha.2` is superseded because a fresh Windows host could lack the machine-level TrustedPublisher registry store key. `v2.0.0-alpha.3` is superseded because its WiX provisioning argument was invalid on a fresh install. Do not replace immutable releases; use `v2.0.0-alpha.4`.

The signed-MSI fresh install/repair/uninstall/reinstall and State-persistence lifecycle gate is complete for the exact alpha.4 MSI. Internal deployment acceptance still requires one Generation 2 Secure Boot client and one isolated Software Test VM restore. Final production acceptance additionally requires installed v1 migration, upgrade rollback, two consecutive four-VM rounds, physical-laptop PXE, torrent, Offline ISO, diagnostics/evidence export and HTTPS LAN opt-in. Current self-signed certificates are for approved internal test hosts; public/organization certificates are a later release input. Skipped tests are not accepted.

## v2 alpha.4 installed VM lifecycle evidence — 2026-07-14

- Exact source candidate: `b1b9974ff799961cb31a187395993d21afbeb9c9`; exact MSI and bootstrap hashes are recorded in the matrix.
- Package: Authenticode valid with the expected self-signed thumbprint; administrative extraction matched 6,842/6,842 payload records and 68/68 applicable signatures.
- Fresh install: `Check` 20/20 and install 34/34. Agent ran as LocalSystem, Web as LocalService; protected State ACL, unrestricted Web service SID, restricted named-pipe DACL, SQLite, loopback health/login/profile read, Web assets and offline manual passed.
- Lifecycle: created non-release profile `3SBXNSOP`; repair passed 34/34; uninstall removed App and both services while preserving State/SQLite; reinstall passed 34/34 without re-importing the already trusted certificate; the same profile remained present.
- Boundary: no NIC settings were changed and no DHCP/TFTP/PXE service was started. Secure Boot PXE client, Software Test VM and physical-laptop evidence remain separate and open.

## v2 alpha.3 local candidate evidence — 2026-07-14

- Source: v1 405/405, v2 41/41, Web E2E 3/3, Docs E2E 2/2, zero production cycles, 37 PowerShell files parsed and no remote product CI run.
- Documentation: 11 canonical zh-TW MDX pages and 11 English mirrors; local search, schema-validated install plan import/export, keyboard flow controls, reduced-motion behavior and generated CSP hashes passed local checks.
- Package: exact alpha.3 MSI and bootstrap hashes are recorded in the matrix. Extraction matched 6,842/6,842 payload records and 68/68 applicable signatures. The packaged bootstrap and bilingual offline manual contain the missing-store initialization behavior.
- Not evidence: no elevated per-machine install, repair, uninstall, State-persistence lifecycle, PXE client or Software Test was executed in this shell. This record permits internal test prerelease distribution only; it does not authorize Pages publication or a production-ready claim.

## Historical v1 evidence

The following records predate v0.6.7 and are retained for audit and regression planning.

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
2. **Deployment secrets** — set `windowsUsername`, `windowsPassword`, `pxeinstallPassword` via Web form. v1 writes the ignored `config\osdcloud-secrets.json`; v2 stores DPAPI ciphertext in SQLite and creates the privileged compatibility file only for the locked action, then scrubs it
3. **Prepare runtime** — downloads and verifies all `config\runtime-artifacts.json` entries, builds WinPE `boot.wim`, stages the Secure Boot TFTP tree (`PXE-TFTP\bootmgfw.efi`, `Boot\BCD`, `Boot\boot.sdi`, `Boot\Fonts`, `sources\boot.wim` hardlink)
4. **Select endpoint** — choose service NIC (e.g., `LAN 192.168.88.1/24`); syncs `boot.ipxe`, WinPE endpoint, SMB firewall, and publishes `boot.wim`
5. **OS Image Cache** — download or import Windows ISO/ESD; select DISM index; export deployable WIM
6. **Publish profile** — set active profile (`Default` / `All in One` / `Minimal`) to bind OS image and publish `selected-os.json`
7. **Run preflight** — clear every blocking failure before starting services; non-blocking warnings may remain

### 3. Confirm boot mode

Default boot mode is `secureboot`. Check in Web console under **Endpoint Settings → Client Boot Mode** or read `config\osdcloud-console.json` → `dhcp.bootMode`.

- **secureboot**: leave client Secure Boot ON (Dell: F2 → Secure Boot Enabled, Microsoft Windows mode; UEFI-only boot; Integrated NIC with PXE). No BIOS changes needed for Dell Latitude or Dell Pro 14.
- **ipxe**: client Secure Boot must be disabled (BIOS F2 → Secure Boot = Disabled) before PXE boot.

### 4. Pre-deployment checks

- Confirm `PXE-TFTP\bootmgfw.efi`, `Boot\BCD`, `Boot\boot.sdi`, `sources\boot.wim` exist (secureboot mode)
- Confirm real LAN DHCP server is disabled
- Run preflight — resolve all blocking failures before starting services; review and record any remaining warnings

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
