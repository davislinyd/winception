# Winception Console — MUJI Design System

> 視覺規格 (從 Stitch 專案 16537016219383076988 提取)
> 原則：無印良品式「空」—— 克制、暖紙色、無陰影、近方角、細線分隔

---

## Color Tokens

| Token      | Hex        | 用途                           |
|------------|------------|-------------------------------|
| `paper`    | `#F4F1EA`  | 主背景（暖米色）               |
| `ink`      | `#33312C`  | 主文字（深暖棕）               |
| `muted`    | `#8A857B`  | 次要文字、非啟用狀態           |
| `hairline` | `#DAD4C8`  | 分隔線、邊框                   |
| `clay`     | `#8C6A52`  | 主要 Accent（陶土棕）、CTA 按鈕、active nav |
| `surface`  | `#FBF9F4`  | 卡片底色、hover 背景           |
| `sage`     | `#6E7B5B`  | 完成/done 狀態（墨綠）         |
| `ochre`    | `#B08A3E`  | 進行中/working（琥珀）         |
| `brick`    | `#A2554A`  | 錯誤/danger（磚紅）            |

CSS variables mapping (`:root`):

```css
--paper: #F4F1EA       /* background */
--ink: #33312C         /* primary text */
--muted: #8A857B       /* secondary text */
--hairline: #DAD4C8    /* borders */
--clay: #8C6A52        /* accent / CTA */
--surface: #FBF9F4     /* card surface */
--sage: #6E7B5B        /* ok/done */
--ochre: #B08A3E       /* working/warn */
--brick: #A2554A       /* error/danger */
```

---

## Typography

| Role        | Font              | Size / Weight             |
|-------------|-------------------|---------------------------|
| `headline`  | Arimo             | Bold, tracking-tight      |
| `body`      | Noto Sans         | 400/500, 13–14px          |
| `mono`      | JetBrains Mono    | 400/500, 11–12px          |
| Section labels | Arimo          | 10px, 700, tracking-[0.2em], UPPERCASE |

Google Fonts:
```
Arimo:wght@400;700
Noto+Sans:wght@300;400;500
JetBrains+Mono:wght@400;500
```

---

## Layout

```
┌───────────────────────────────────────────────────────────┐
│  Sidebar 240px   │  Main column (flex-1)      │  Rail 40px │
│  sticky h-screen │  ┌──────────────────────┐  │  collapsed │
│  bg-paper        │  │ Topbar h-16          │  │            │
│  border-r        │  ├──────────────────────┤  │            │
│                  │  │ Main content (scroll)│  │            │
│                  │  │ px-8 py-8           │  │            │
│                  │  └──────────────────────┘  │            │
└───────────────────────────────────────────────────────────┘
```

### Sidebar (`#sidebar`)

```
┌────────────────────────┐
│ Brand (logo + name)    │  h-auto px-6 py-8
├────────────────────────┤
│ Deploy  ← active nav   │  border-l-2 border-clay
│ Setup                  │
│ Activity               │
├────────────────────────┤
│ SETUP  (label)         │  10px uppercase tracking
│ 01 Project root     ●  │  done dot: bg-sage
│ 02 Web service IP   ●  │  active dot: bg-ochre
│ 03 Deployment sec.  ●  │  pending dot: bg-hairline
│ ...                    │
├────────────────────────┤
│ ● Elevated · admin     │  sidebar-foot
└────────────────────────┘
```

### Topbar (inside main column)

```
h-16 border-b border-hairline bg-paper sticky top-0
Left: (empty or view title)
Right: endpoint-chip | operation-badge | updated-at | refresh | avatar
```

### Right Rail (`#log-rail`)

```
w-10 → expands to w-80 on click
border-l border-hairline
Contains rotated "Console log" label
```

---

## Components

### Buttons

```css
/* Primary CTA */
.v3-primary {
  background: var(--clay);
  color: #fff;
  border: 1px solid var(--clay);
  border-radius: 2px;
  padding: 9px 18px;
  font: 600 13px "Arimo";
}

/* Secondary action (was .warning) */
button.warning {
  background: transparent;
  border: 1px solid var(--clay);
  color: var(--clay);
  border-radius: 2px;
}

/* Destructive (was .danger) */
button.danger {
  border: 1px solid var(--hairline);
  color: var(--brick);
  border-radius: 2px;
}
```

### Cards

```css
.dash-card, .v3-summary, .v3-more {
  border: 1px solid var(--hairline);
  border-radius: 2px;        /* near-square, MUJI */
  background: #fff;
  box-shadow: none;          /* NO shadow */
}
```

### Status dots (sidebar steps)

```css
.sidebar-step-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.sidebar-step-dot.done    { background: var(--sage); }
.sidebar-step-dot.active  { background: var(--ochre); }
.sidebar-step-dot.pending { background: var(--hairline); }
.sidebar-step-dot.required { background: var(--muted); }
```

### Nav items (sidebar)

```css
.v3-navlink {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 24px;
  border-left: 2px solid transparent;
  font: normal 12px "Arimo", tracking-wider, uppercase;
  color: var(--muted);
  transition: all 0.12s;
}

.v3-navlink:hover { color: var(--ink); }

.v3-navlink.active {
  border-left-color: var(--clay);
  font-weight: 700;
  color: var(--ink);
}
```

### Status pills

```css
.status-pill.ok      { background: #EFF3EC; color: var(--sage); }
.status-pill.working { background: #FAF4E8; color: var(--ochre); }
.status-pill.warn    { background: #FAF4E8; color: var(--ochre); }
.status-pill.fail    { background: #FAF0EE; color: var(--brick); }
.status-pill.neutral { background: var(--surface); color: var(--muted); border: 1px solid var(--hairline); }
```

---

## Border Radius

```js
borderRadius: {
  DEFAULT: "0.125rem",  // 2px
  lg:      "0.25rem",   // 4px
  xl:      "0.5rem",    // 8px
  full:    "9999px"
}
```

---

## Spacing System

`px-8 py-8` for main content padding (32px)
`gap-4` for component gaps
`border border-hairline` for all card/section borders

---

## Design Rules

1. **No shadows** — borders only, hair-thin
2. **Near-square radius** — 2px default, never pill shapes except badges/avatars
3. **Warm tones throughout** — paper (#F4F1EA) not cold white
4. **Clay as the only accent** — no blue, no purple
5. **Sage for success, ochre for progress, brick for errors**
6. **Section labels** — 10px, uppercase, tracked, in `muted`
7. **Arimo for all labels/headers, Noto Sans for body text**
