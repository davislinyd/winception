# Winception Console — 暖紙墨 Design System (Warm Paper + Ink)

<!-- V6.4 暖紙墨: restored from design bundle hfB5_hjSCFwgKT3JqzmC3g (terracotta #9C4221) -->

A reading-first ops console. The entire UI sits on a warm paper field with warm
soot ink; a single terracotta accent does all the pointing. Hierarchy comes from
borders and spacing — never shadows, never extra hues.

整體是「暖紙墨」閱讀優先設計:暖米白紙面 + 暖墨文字,唯一的陶土紅強調色如紙上朱印。
層次靠邊線與留白,不靠陰影、不加多餘色相。

## Color tokens 色彩

All neutrals share one warm hue band (~35–45°, very low chroma) so paper, ink and
borders harmonize (analogous scheme). Status colors are desaturated and warm-shifted.
60-30-10: ~60% paper surfaces / ~30% ink & borders / ~10% terracotta + status tints.

| Token | Hex | Contrast vs paper | 用途 |
|---|---|---|---|
| `--paper` | `#FAF7F2` | — | 暖紙底色(暖奶油 off-white,頁面背景) |
| `--ink` | `#332E29` | ~12.6:1 | 主文字(暖墨,非純黑) |
| `--muted` | `#6E655B` | ~5.3:1 | 次要文字(暖棕) |
| `--hairline` | `#E8E0D3` | — | 分隔線、卡片邊框(暖砂) |
| `--clay` / `--accent` | `#9C4221` | ~4.9:1 | 陶土紅 — 唯一強調色(CTA、選取、進度) |
| `--surface-bright` | `#FFFDF8` | — | 卡片底(暖白) |
| `--surface-container-low` | `#F6F1E8` | — | 嵌入面板底、頂部列底色 |
| `--ok` / `--sage` | `#38684A` | 5.6:1 | 完成/運行(鼠尾草綠) |
| `--warn` / `--ochre` | `#8F5A1F` | 5.5:1 | 進行中/提醒(赭黃) |
| `--error` / `--brick` | `#9E3B32` | 6.3:1 | 錯誤/破壞性(茜紅) |
| `--secondary-container` | `#E8A93B` | (text `#4A2D00` 6:1) | 注意型按鈕(`button.warning`)琥珀底 |

### Terminal 終端機(console dock)

The only dark element. Warm charcoal, cream text — ink on a chalkboard.

| Token | Hex | 用途 |
|---|---|---|
| `--term-bg` | `#2A2520` | 日誌底(暖炭) |
| `--term-surface` | `#353028` | dock 標頭底 |
| `--term-text` | `#EFE7D8` | 日誌文字(暖米色) |
| `--term-ok` / `--term-err` | `#9CBF93` / `#E5A294` | 成功/錯誤行 |

## Typography 字型

Google Fonts: `Inter:wght@400;500;600;700`,
`Source+Serif+4:opsz,wght@8..60,500..700`, `JetBrains+Mono:wght@400;500`.

- **Source Serif 4**(serif): 標題 ≥14px 與大數字(頁標 22px、對話框標題 17px、
  tile/統計數字 24–26px)。紙感編輯排版的關鍵。
- **Inter**: 內文 13px/1.5、UI 標籤、按鈕(基礎 `button` 規則 `500 12px/16px Inter`)、
  9–11px 大寫小標(serif 在小字級不可讀,一律 Inter 600 + 字距)。
- **JetBrains Mono**: 技術字串(IP、路徑、run ID)與日誌(11px)。

Fallback `Georgia, serif` keeps headings legible if the CDN is unreachable.

## Layout 版面

```
┌────────────────────────────────────────────────────────────┐
│ .topbar 56px  狂草「W」+ Winception · Deploy/Monitor · 狀態 │
├────────────────────────────────────────────────────────────┤
│ .shell-main(scroll)  內容滿版,左右 5% gutters             │
│   #view-dashboard = 兩欄: dashboard(左) + 導引設定軌(右40%)│
│   #view-fleet                                              │
├────────────────────────────────────────────────────────────┤
│ #console-dock(橫跨內容欄底,可收合)                         │
└────────────────────────────────────────────────────────────┘
```

- `.shell`: grid `minmax(0,1fr)` × `var(--topbar-h)=56px minmax(0,1fr) auto`,
  100vh。頂部列 / 內容欄 / 主控台 dock 垂直堆疊。
- 頂部列 `--surface-container-low` 底 + 底部 hairline;品牌為 狂草毛筆「W」墨色
  SVG(`feTurbulence`+位移濾鏡)+ Source Serif「Winception」字標;nav 僅
  Deploy / Monitor(active = 亮底 + 底部 2px 陶土紅 inset)。
- 內容滿版、左右 5% gutters,不再限寬置中(`--content-max` 已停用)。
- Deploy = 兩欄:左為 dashboard,右為可收合的「導引設定」軌
  (`.deploy-grid` = `minmax(0,1fr) 40%`)。收合後軌縮為 48px 直條、dashboard
  最大化。導引設定不再是獨立 nav 目的地。
- `@media (max-width: 1024px)`: 兩欄堆疊為單欄,頂部列縮邊距。
- z-index: topbar 20 / dock 25 / `.fleet-backdrop` 40 / `.client-fleet-panel` 45 /
  fallback dialog 60。

## Components 元件

- **Cards**: `--surface-bright` 底 + 1px `--hairline` 邊 + 6px 圓角,無陰影、無
  hover 浮起。`--card-shadow` 恆為 none。
- **Buttons**: 基礎中性;`.btn-primary` 陶土紅實底(CTA);`button.warning` 琥珀底
  (注意型動作:sync/prepare);`button.danger`/紅只用於破壞性與錯誤。
- **Status pills**: 999px 膠囊,tint 底 + 同色深字(`.ok`/`.working`/`.fail`)。
- **Focus ring**: `0 0 0 3px rgba(156,66,33,.18)`(陶土紅 18%)。
- **Dialog backdrop**: `rgba(44,33,19,.45)` 暖色遮罩。

## Guided setup rail 導引設定軌

位於 Deploy 右側 40% 欄,可收合為 48px 直條(點擊 chevron 或 strip 展開)。

### 步驟圖示(per-state icons)

步驟列 `.initialization-step` 的 `::before` 偽元素表示狀態:

| 狀態 class | 圖示外觀 |
|---|---|
| 無(pending) | 灰色空心圓 |
| `.done` | 實心 `var(--ok)` 綠圓 + `::after` 白色 check 符號 |
| `.done.active` | 同上 + 淡綠暈 halo |
| `.active:not(.done)` | 陶土紅同心圓(bullseye) — `radial-gradient` |
| `.needs-update:not(.done)` | 琥珀同心圓(bullseye) |
| `.working` | 琥珀邊框 + 脈衝暈 |

### 步驟展開/收合

- 點擊步驟標題 → 展開:步驟內容 `.guided-v3-detail` 嵌入該步驟 DOM 節點內(行內顯示,非底部)。
- 再次點擊已展開的步驟 → 收合(toggle);狀態 flag = `state.guidedStepCollapsed`。

### 進度條顏色

`#init-progress-fill` 依完成百分比動態設定 `background`:
- 0–33%: `var(--error)`(紅)
- 34–66%: `var(--warn)`(琥珀)
- 67–100%: `var(--ok)`(綠)

## Deploy summary bar 部署摘要列

位於 dashboard 左欄頂端。三個區段(Profile / OS Image / Endpoint)各含一個
`.deploy-seg` 按鈕。

- **`.profile-name`**(卡片標題,Profile name & OS image name): 顏色 `var(--ink)`,
  與 guided setup「Set up deployment」標題同色。截斷以 `text-overflow: ellipsis`
  防止溢出。
- **`.profile-meta`**: `font-size: 11px`,同樣截斷。
- **Service card hover**: `border-color: var(--outline)`(暖灰),非陶土紅。
- **Runtime ready 按鈕**: 當 `data-icon="check_circle"` 時顯示綠色樣式
  (`var(--ok-bg)` 底 + `var(--ok)` 字/邊框),不使用 `.warning` 橙色。
- **Config panel 關閉**: 點擊 Profile/OS Image/Endpoint panel 外的空白區域,或按
  Escape,均可關閉面板(使用 `mousedown` capture phase 監聽)。

## Activity 頁搜尋框

`.fleet-search`: `display:flex; flex-direction:row; height:30px`,放大鏡圖示
(`material-symbols-outlined`)在輸入框左側行內排列,非堆疊。

## Rules 設計規則

1. 陶土紅是唯一強調色 — CTA、active nav、選取框、進度條。不得引入藍/紫/青。
2. 琥珀 = 提醒(需要使用者注意的次要動作);紅 = 僅錯誤與破壞性動作。
3. 終端機永遠是暖炭色,是頁面上唯一的深色塊。
4. serif 只用於標題與數字;小字級大寫標籤一律 Inter。
5. 層次 = 邊線 + 留白;禁止陰影與漸層(gradients)。
6. 文字對比 ≥ WCAG AA(內文 ≥ 4.5:1)。

## Compatibility notes 相容性附註

These legacy class names are intentionally kept because the `web/js/` modules
reference them (query or template-emit) — restyle them, never rename:

- `.guided-v3-main`(`web/js/setup.js` querySelector)與整組 `guided-v3-*` 結構類別。
- `.v3-svc on|off`(`web/js/deploy.js` 動態輸出的服務小點)。
- `.v3-summary-status warn|ok`(`web/js/deploy.js` 直接覆寫 `#summary-status` 的 className)。
- `body.fleet-expanded .client-fleet-panel` 規則為測試釘死的遺留契約,勿清除。

Chrome/structural classes use the `.shell-*` prefix; the Deploy summary bar uses
`.deploy-*`; the primary CTA is `.btn-primary`.
