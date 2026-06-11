# Winception Console — 暖紙墨 Design System (Warm Paper + Ink)

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
| `--paper` | `#FAF7F2` | — | 暖紙底色(頁面背景) |
| `--ink` | `#332E29` | 12.6:1 | 主文字(暖墨,非純黑) |
| `--muted` | `#6E655B` | 5.3:1 | 次要文字 |
| `--hairline` | `#E8E0D3` | — | 分隔線、卡片邊框 |
| `--clay` / `--accent` | `#9C4221` | 6.1:1 | 陶土紅 — 唯一強調色(CTA、選取、進度) |
| `--surface-bright` | `#FFFDF8` | — | 卡片底(暖白) |
| `--surface-container-low` | `#F6F1E8` | — | 側欄、嵌入面板底 |
| `--ok` / `--sage` | `#38684A` | 5.6:1 | 完成/運行(鼠尾草綠) |
| `--warn` / `--ochre` | `#8F5A1F` | 5.5:1 | 進行中/提醒(赭黃) |
| `--error` / `--brick` | `#9E3B32` | 6.3:1 | 錯誤/破壞性(茜紅) |
| `--secondary-container` | `#E8A93B` | (text `#4A2D00` 6:1) | 注意型按鈕(`button.warning`)琥珀底 |

### Terminal 終端機(console dock)

The only dark element. Warm charcoal, cream text — like ink on a chalkboard,
not a blue IDE panel.

| Token | Hex | 用途 |
|---|---|---|
| `--term-bg` | `#2A2520` | 日誌底(暖炭) |
| `--term-surface` | `#353028` | dock 標頭底 |
| `--term-text` | `#EFE7D8` | 日誌文字(米色,11.9:1) |
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
┌──────────────┬──────────────────────────────────────────┐
│ .shell-sidebar │  .shell-main(scroll)                   │
│ 240px 整高     │  內容限寬 var(--content-max)=1100px 置中  │
│  brand        │  #view-dashboard / #initialization-dialog │
│  3 nav links  │  / #view-fleet                           │
│  setup chip   ├──────────────────────────────────────────┤
│  ── 釘底 ──    │  #console-dock(只佔內容欄,可收合)        │
│  endpoint 等   │                                          │
└──────────────┴──────────────────────────────────────────┘
```

- `.shell`: grid `var(--sidebar-w) minmax(0,1fr)` × `minmax(0,1fr) auto`,100vh。
- 1100px 的閱讀 measure 讓行長落在舒適範圍;側欄底色 `--surface-container-low`
  與紙面區隔,右側 hairline。
- Active nav: 亮底 + 左側 3px 陶土紅 inset bar。
- `@media (max-width: 1024px)`: 側欄縮為 `--rail-w`=64px icon rail(文字隱藏,
  nav 按鈕靠 `title` 提示)。
- z-index: sidebar 20 / dock 25 / `.fleet-backdrop` 40 / `.client-fleet-panel` 45 /
  fallback dialog 60。

## Components 元件

- **Cards**: `--surface-bright` 底 + 1px `--hairline` 邊 + 6px 圓角,無陰影、無
  hover 浮起。`--card-shadow` 恆為 none。
- **Buttons**: 基礎中性;`.btn-primary` 陶土紅實底(CTA);`button.warning` 琥珀底
  (注意型動作:sync/prepare);`button.danger`/紅只用於破壞性與錯誤。
- **Status pills**: 999px 膠囊,tint 底 + 同色深字(`.ok`/`.working`/`.fail`)。
- **Focus ring**: `0 0 0 3px rgba(156,66,33,.18)`(陶土紅 18%)。
- **Dialog backdrop**: `rgba(43,38,33,.45)` 暖色遮罩。

## Rules 設計規則

1. 陶土紅是唯一強調色 — CTA、active nav、選取框、進度條。不得引入藍/紫/青。
2. 琥珀 = 提醒(需要使用者注意的次要動作);紅 = 僅錯誤與破壞性動作。
3. 終端機永遠是暖炭色,是頁面上唯一的深色塊。
4. serif 只用於標題與數字;小字級大寫標籤一律 Inter。
5. 層次 = 邊線 + 留白;禁止陰影與漸層。
6. 文字對比 ≥ WCAG AA(內文 ≥ 4.5:1)。

## Compatibility notes 相容性附註

These legacy class names are intentionally kept because app.js references them
(query or template-emit) — restyle them, never rename:

- `.guided-v3-main`(app.js querySelector)與整組 `guided-v3-*` 結構類別。
- `.v3-svc on|off`(app.js 動態輸出的服務小點)。
- `.v3-summary-status warn|ok`(app.js 直接覆寫 `#summary-status` 的 className)。
- `body.fleet-expanded .client-fleet-panel` 規則為測試釘死的遺留契約,勿清除。

Chrome/structural classes use the `.shell-*` prefix; the Deploy summary bar uses
`.deploy-*`; the primary CTA is `.btn-primary`.
