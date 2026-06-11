# Winception Console — "Console v2" Design System

> 視覺規格 (從 Stitch 專案 16205288903656654918「Winception Console v2」提取)
> 原則：乾淨的 ops console —— 白色卡片、高對比墨色文字、翡翠綠 accent、底部深色 terminal

---

## Color Tokens

| Token      | Hex        | 用途                                  |
|------------|------------|--------------------------------------|
| `paper`    | `#F8F9FF`  | 主背景（冷調近白）                     |
| `ink`      | `#0B1C30`  | 主文字（深海軍墨）                     |
| `muted`    | `#6D7A72`  | 次要文字、標籤（outline）              |
| `hairline` | `#BCCAC0`  | 結構分隔線（sidebar/topbar 邊框）      |
| `clay`*    | `#059669`  | 主要 Accent（翡翠綠）、CTA、active nav |
| `surface`  | `#EFF4FF`  | 淺容器、hover、表頭底色                |
| `sage`     | `#059669`  | 完成/ok 狀態（同 accent）              |
| `ochre`    | `#B45309`  | 進行中/警告文字（琥珀深）              |
| `brick`    | `#BA1A1A`  | 錯誤/danger（紅）                      |

\* `--clay` 變數名稱保留以維持相容，值已改為翡翠綠。

次要 accent（attention 按鈕）：`--secondary-container: #FEA619`（琥珀實底，深棕文字 `#4A2D00`），
用於 `button.warning`（Sync endpoint / Prepare runtime / Add software 等）。

Terminal（console dock）專用：

```css
--term-bg:      #1E293B;   /* log 區背景（slate）*/
--term-surface: #213145;   /* dock header 背景 */
--term-text:    #C7D3E4;   /* log 文字 */
--term-muted:   #7C8BA3;   /* header 次要文字 */
--term-ok:      #68DBA9;   /* terminal 圖示/成功 */
--term-err:     #FFB3AD;   /* 錯誤訊息 */
```

CSS variables mapping (`:root`)：card 背景 `--surface-bright: #FFFFFF`，卡片邊框
`--outline-variant: #D5DEDA`，sidebar 底 `--sidebar-bg: #F2F5F3`。

---

## Typography

| Role        | Font              | Size / Weight                |
|-------------|-------------------|------------------------------|
| `headline`  | Space Grotesk     | 500–700, 標題/數字           |
| `body`      | Inter             | 400/500, 12–14px             |
| `mono`      | JetBrains Mono    | 400/500, 11–13px（資料/log） |
| Section labels | Inter          | 10–11px, 600–700, tracking 0.05–0.14em, UPPERCASE |

Google Fonts:
```
Inter:wght@400;500;600;700
Space+Grotesk:wght@500;600;700
JetBrains+Mono:wght@400;500
```

---

## Layout（單欄、無 sidebar）

```
┌───────────────────────────────────────────────────────┐
│ Topbar h-16：brand + tabs ─── setup chip + 狀態 chips │
├───────────────────────────────────────────────────────┤
│ Main content（scroll，max-width 1360 置中）            │
├───────────────────────────────────────────────────────┤
│ Console dock（深色 terminal，全 view 共用）            │
└───────────────────────────────────────────────────────┘
```

### Topbar（`.v3-topbar`）

- 左：30px 綠色方塊 `W`（`.v3-logo-block`）+ WINCEPTION + 版本號，
  之後是水平 tabs（Deploy / Setup / Activity）— active = 綠字 + 2px 底線
- 右：`#setup-progress-chip`（「Setup n/10」，未完成=琥珀、完成=綠，點擊進 Setup）、
  endpoint chip（mono）、operation badge、updated 時間（tabular-nums）、refresh、admin chip
- Setup 進度只在這個 chip 與 Setup 頁呈現，**不重複列出步驟清單**

### Console Dock（底部深色 terminal，全 view 共用）

- header：`--term-surface`，terminal 圖示（綠）、CONSOLE 標籤、operation 名稱（mono）、
  狀態 pill、copy 按鈕、收合 chevron
- log 區：`--term-bg`，淺色 mono 文字，`clamp(160px, 28vh, 320px)` 高
- operation 開始時自動展開一次；手動收合在該次 operation 內被尊重

---

## Components

### Buttons

```css
/* Primary CTA（Run preflight / Start services）*/
.v3-primary { background: var(--accent); color: #fff; border-radius: 4px; }

/* Attention / secondary action（Sync endpoint 等）*/
button.warning { background: #FEA619; color: #4A2D00; font-weight: 600; }

/* Destructive */
button.danger { color: var(--tertiary); }
```

### Cards

白底（`--surface-bright`）、`1px solid var(--outline-variant)`、圓角 4–8px、無陰影。

### Status pills

ok=綠 / working·warn=琥珀 / fail=紅，淺色 tint 背景，UPPERCASE 10px。

---

## Design Rules

1. **白卡片 + 細邊框** — 無陰影或極輕，靠邊框與留白分層
2. **翡翠綠是唯一主 accent** — CTA、active nav、完成狀態、進度
3. **琥珀為 attention** — 警示按鈕、進行中狀態；紅只給錯誤
4. **底部 terminal 永遠深色** — 與淺色 app 形成明確的「console」對比
5. **Space Grotesk 標題/數字，Inter 內文，JetBrains Mono 資料與 log**
6. **Section labels** — 小號大寫、寬字距、`muted` 色
