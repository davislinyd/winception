# Changelog

## v0.5.17 — 2026-06-16

### 新功能：DHCP Proxy 模式（ProxyDHCP）

**問題**：當部署環境的內網已有一台 DHCP 伺服器（如家用路由器或公司 DHCP），啟動 winception 原有的 DHCP 服務會造成雙 DHCP 衝突，Client 無法預測從哪一台取得 IP，PXE 開機資訊也可能遺失。

**解決方案**：新增 `dhcp.dhcpMode` 設定欄位，支援 **`proxy`** 模式（ProxyDHCP）。

#### 運作原理

Proxy 模式下，winception 繼續監聽 UDP 67 埠，但僅回應帶有 `Option 60 = "PXEClient"` 的封包，對一般 DHCP 流量完全靜默。回覆的 OFFER 中 `yiaddr = 0.0.0.0`（不分配 IP），只注入 PXE 開機選項（Option 60、66、67）：

```
Client DISCOVER → 路由器 DHCP：OFFER 含真實 IP
               → winception：  OFFER yiaddr=0.0.0.0，含 Option 66/67
Client 依 PXE Spec 2.1 Collection Phase 等待所有 OFFER 後合併使用
→ 以路由器 IP 上網，以 winception boot file 開機
```

PXE Spec 2.1 Section 2.2.1 Collection Phase 保證 Client 等待所有 OFFER 後才繼續，因此不存在「先拿到 IP 就開機」的 race condition。

#### 設定方式

| 模式 | `dhcp.dhcpMode` | 說明 |
|------|-----------------|------|
| DHCP 伺服器（預設） | `"server"` 或省略 | 完整 DHCP，自行分配 IP（隔離網路） |
| PXE Proxy 中繼 | `"proxy"` | 只注入 PXE 選項，不分配 IP（共用內網） |

proxy 模式下，`leaseStartIp`/`leaseEndIp`/`subnetMask`/`router` 欄位為選填。

#### 使用方式

**Web UI**：Endpoint Settings → DHCP Mode → 選擇 **PXE Proxy (relay)**

**config.json 手動設定**：
```json
{
  "dhcp": {
    "dhcpMode": "proxy"
  }
}
```

#### 注意事項

- Proxy 模式適用現代 UEFI 機器（Hyper-V Gen2、Dell 等）；部分舊款韌體 PXE 實作不完整可能無法識別 ProxyDHCP OFFER。
- 切換模式前，服務會自動停止並重新啟動。

### 其他變更

- **Web UI**：DHCP 服務卡標籤於 proxy 模式顯示「DHCP Proxy」而非「DHCP Server」
- **Web UI**：DHCP Pool 欄位於 proxy 模式顯示「PXE proxy (no IP allocation)」
- **Preflight**：proxy 模式跳過 DHCP subnet 範圍驗證
- **README**：第一次部署步驟 8 新增 DHCP 模式選擇說明

---

## v0.5.16 及之前

請參閱 git log。
