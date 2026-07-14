# Winception

Winception 是給內部 IT 技師使用的 Windows 11 單機部署產品。它以 OSDCloud 為執行基礎，從本機管理介面準備 WinPE/PXE runtime、OS image、deployment profile、software/scripts，並追蹤到 `windows-desktop-ready`。

目前穩定版為 `v0.6.7`，永久保留於 tag `v0.6.7` 與 `release/v1`。v2 在 `codex/v2-rewrite` 開發，版本為 `2.0.0-alpha.5`；完成 MSI、migration、VM、實機與 release-readiness matrix 前不可取代 `master`。

## v2 產品架構

- Node.js 24、TypeScript、Fastify、React/Vite；request/response/IPC 使用版本化 JSON Schema。
- `Winception.Web` 以低權限提供 loopback 管理介面、authentication、OpenAPI、SSE 與 read model。
- `Winception.Agent` 以高權限執行固定 allow-list Windows/PowerShell/Hyper-V/network 動作。
- Web 與 Agent 只經 ACL 保護的本機 named pipe 通訊；Web 不接受任意 PowerShell、command line 或 filesystem path。
- `OperationCoordinator` 依 `config`、`deployment-ingress`、`runtime`、`os-cache`、`profile-payload`、`software-test-vm`、`evidence`、`runtime-control` 鎖定 mutation，衝突回傳 `409 OPERATION_CONFLICT`。
- SQLite 保存設定、operations、profiles 與 evidence index；大型 image/log 留在 filesystem。Secrets 使用 Windows DPAPI。
- 管理介面預設只綁 `127.0.0.1`。LAN 管理必須明確設定 certificate-store 憑證並使用 HTTPS；憑證無效時不啟動。

目前 alpha 的本機產品核心已完成：SQLite 是結構化設定與 catalog 的 source of truth，legacy JSON 僅為受控 compatibility projection；service-SID pipe DACL 會在 Agent listen 後套用並讀回驗證，retention/evidence 已接到 production roots。既有 OSDCloud 能力由受協調的 compatibility adapter 執行，所有 v2 mutation 仍受 resource locks 與 schema 邊界控制。

完整依賴方向與 ownership 見 [v2 architecture](docs/agent-reference/v2-architecture.md)。v2 正式文件以 [Docusaurus MDX](apps/docs/docs/getting-started.mdx) 為唯一來源，同時產生 GitHub Pages `/winception/` 與 MSI 離線 `/manual/`；既有 HTML 只保留為 v1 歷史相容文件。

## 授權

Winception v2 採用 [GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）。散布修改版本或透過網路提供修改版本時，必須依授權條款向使用者提供對應原始碼的取得機會；實際義務以 `LICENSE` 為準。第三方元件仍各自適用其原授權，詳見 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 技師操作摘要

1. 安裝簽章 MSI；以 installer 產生的 setup code 登入 loopback Web。
2. 在 **Deploy** 設定 deployment root、DPAPI secrets、endpoint、DHCP/boot mode。
3. Prepare runtime、準備 OS image、建立並 publish profile。
4. Run preflight。非阻擋 warning 可保留；任何 blocking failure 必須修正後重跑。
5. 確認 LAN DHCP 安排安全，再啟動 deployment ingress。
6. Client 從 UEFI IPv4 PXE 開機；在 **Deploy / Monitor** 追蹤 Fleet、logs 與 evidence，直到 `windows-desktop-ready`。
7. 完成後停止 DHCP/TFTP/HTTP。Software Test VM 必須在 ingress stopped 且 Fleet empty 的同一 resource lock 內開始。

不要把 committed endpoint、VM regression 或歷史 evidence 當作目前實機 readiness。詳細 no-AI runbook 與版本化證據見 [TEST-RESULT.md](TEST-RESULT.md)。

## 開發與驗證

需要 Node.js 24.x：

```powershell
npm ci
npm run check
npm test
npm run v2:test:coverage
npm run v2:test:critical-coverage
npm run v2:openapi:check
npm run v2:secrets
npm run v2:e2e
npm run docs:check
npm run docs:e2e
./tools/v2/Test-PowerShellSyntax.ps1
```

v2 本機開發：

```powershell
npm run v2:dev:agent
npm run v2:dev:server
npm run v2:dev:web
```

產生自簽內部測試 package／MSI：

```powershell
.\tools\v2\Build-WinceptionV2Package.ps1 -BuildMsi
```

未指定 `-CodeSigningThumbprint` 時會建立並使用本機自簽 code-signing certificate。`installer/output` 會輸出 MSI、CER、互動安裝工具、release manifest、`SHA256SUMS`、SBOM 與 LICENSE；在測試主機核對 thumbprint 後，只有明確加入 `-TrustSelfSignedCertificate` 才會信任該 CER。未來換公開／組織憑證時傳入 thumbprint 與 timestamp server，不需修改產品程式碼。

全新 VM 先執行唯讀檢查，再安裝：

```powershell
.\Install-Winception.ps1 -Action Check -MsiPath .\Winception-v2.msi -CertificatePath .\Winception-Local-CodeSigning.cer -ReportPath .\check.json
.\Install-Winception.ps1 -Action Install -MsiPath .\Winception-v2.msi -CertificatePath .\Winception-Local-CodeSigning.cer -TrustSelfSignedCertificate -ShowSetupCode -OpenBrowser -ReportPath .\install.json
```

安裝工具不使用 `irm | iex`、不修改 NIC、不啟動 DHCP，且不把 setup code 或 secret 寫入 report。

安裝後請在 elevated PowerShell 只顯示一次 setup code，不要寫入 log：

```powershell
& "$env:ProgramFiles\Winception\app\tools\v2\Get-WinceptionSetupCode.ps1"
```

管理面預設為 loopback HTTP。要明確啟用 LAN HTTPS，使用 DNS 名稱執行下列交易式命令；未指定 certificate 時先建立自簽 TLS 憑證，並將輸出的 `management-tls.cer` 匯入管理工作站信任存放區：

```powershell
& "$env:ProgramFiles\Winception\app\tools\v2\Set-WinceptionManagementEndpoint.ps1" -ManagementHost winception.example.internal
```

v1 migration CLI 支援 dry-run、備份、重跑與 migration report，不會匯入 running operation、service PID、lease 或 transient lock：

```powershell
npm run v2:build
npm run v2:migrate:v1 -- --app-root C:\OSDCloud\HostTools\App --state-root C:\OSDCloud\HostTools\State --v2-state-root C:\ProgramData\Winception\State --dry-run
```

## 文件

- [v2 正式雙語文件來源](apps/docs/docs/getting-started.mdx)（Pages 在 VM acceptance 後手動發布；MSI 內建 `/manual/`）
- [v1 歷史 HTML 手冊](docs/winception-operations-manual.html)
- [Release evidence 與 no-AI runbook](TEST-RESULT.md)
- [v2 架構與 module boundaries](docs/agent-reference/v2-architecture.md)
- [Runtime 安全規則](docs/agent-reference/runtime-web-console.md)
- [驗證情境](docs/agent-reference/validation-scenarios.md)
- [Security policy](SECURITY.md) / [Support matrix](SUPPORT.md)

---

Winception is a single-host Windows 11 deployment product for internal IT technicians. It uses OSDCloud to prepare WinPE/PXE runtime, images, profiles, software and scripts, then tracks clients through `windows-desktop-ready`.

The stable line is `v0.6.7`, preserved by tag `v0.6.7` and branch `release/v1`. v2 (`2.0.0-alpha.5`) is developed on `codex/v2-rewrite` and must not replace `master` until signed MSI, migration, VM, physical-laptop and release-readiness acceptance are complete.

v2 separates a low-privilege Fastify/React Web service from a privileged allow-list Agent over an ACL-protected named pipe. Mutations use schema contracts and resource-aware locks; SQLite stores structured state, DPAPI protects secrets, and large deployment artifacts remain on the filesystem. Management is loopback-only by default; LAN access is explicit HTTPS and fails closed.

The local alpha product core is implemented: SQLite is authoritative for structured configuration and catalogs, legacy JSON is a controlled compatibility projection, the service-SID pipe DACL is applied and read back after Agent listen, and production evidence roots use retention/index maintenance. Existing OSDCloud behavior runs through a coordinated compatibility adapter; every v2 mutation remains inside schema and resource-lock boundaries.

## License

Winception v2 is licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). Distribution of modified copies and network use of modified versions must preserve the opportunity to obtain Corresponding Source as required by the license; `LICENSE` controls. Third-party components retain their own licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

The operator path is: configure Deploy, prepare runtime, prepare an image, publish a profile, clear blocking preflight failures, confirm DHCP safety, start ingress, PXE boot clients, monitor in Deploy/Monitor, and stop services after `windows-desktop-ready`. Warnings do not block service start. Historical or VM evidence never proves current physical readiness.

Use the bilingual [v2 Docusaurus source](apps/docs/i18n/en/docusaurus-plugin-content-docs/current/getting-started.mdx), [release evidence matrix](TEST-RESULT.md), [v2 architecture reference](docs/agent-reference/v2-architecture.md), and [support policy](SUPPORT.md) as the authoritative product documentation. The same MDX builds GitHub Pages under `/winception/` and the MSI offline manual under `/manual/`; the former HTML manual is v1 history only.

Local test packages and MSIs are Authenticode-signed with a generated self-signed certificate when no thumbprint is supplied. `installer/output` includes the MSI, CER, interactive installer, release manifest, checksums, SBOM and license. Trust the emitted CER only on approved test hosts and only through explicit `-TrustSelfSignedCertificate`. The installer defaults to read-only `Check`, never changes NICs or starts DHCP, and never records the setup code. LAN management remains an explicit transaction through `Set-WinceptionManagementEndpoint.ps1`; it creates self-signed TLS by default for now and can later use a supplied public/organization certificate thumbprint.
