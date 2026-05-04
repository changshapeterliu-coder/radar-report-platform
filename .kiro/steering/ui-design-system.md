# UI Design System — Radar Report Platform

The platform's visual & interaction language. Applies to every user-facing
page, component, form, notification, and email template. This document is
the single source of truth; when in doubt, follow what's here, not what an
adjacent file happens to be doing.

**Status**: Always included. Re-read before designing or modifying any UI.

---

## Design philosophy

Modern SaaS with a single Amazon-orange accent. Visual lineage:

- **Skeleton**: Linear.app / Vercel Dashboard / Supabase Studio — heavy
  neutral grays, generous whitespace, subtle borders, minimal shadows,
  rounded corners.
- **Soul**: a single pop of `#ff9900` (Amazon orange) reserved for CTAs,
  selection states, trend-chart primary lines, and the "Hot" flag. Keeps
  the Amazon-Seller-Central brand association without looking like Seller
  Central from 2012.

**Mood words**: clean, calm, intelligent, trustworthy, AI-native.  
**Anti-mood**: bouncy, gamified, gradient-heavy, emoji-driven, corporate 2010s.

---

## 1. Color palette

All colors are Tailwind v4 compatible. Define as CSS variables in
`src/app/globals.css` and surface them via Tailwind's theme so every
component uses tokens, never raw hex values.

### 1.1 Neutrals (foundation — 90% of the UI)

| Token                  | Hex       | Usage                                     |
|------------------------|-----------|-------------------------------------------|
| `--background`         | `#fafafa` | Page body background                      |
| `--card`               | `#ffffff` | Cards, modals, nav, any container        |
| `--border`             | `#e5e7eb` | Default border on cards/inputs            |
| `--border-strong`      | `#d1d5db` | Emphasized dividers, focused input border |
| `--muted`              | `#f3f4f6` | Hover states, subtle banding              |
| `--foreground`         | `#0a0a0a` | Primary text (headings, body)             |
| `--foreground-muted`   | `#6b7280` | Secondary text (dates, metadata, captions)|
| `--foreground-subtle`  | `#9ca3af` | Disabled text, placeholder                |

Rule: 90% of a page should be grayscale. Color is a signal, not decoration.

### 1.2 Accent (brand signal)

| Token                  | Hex       | Usage                                        |
|------------------------|-----------|----------------------------------------------|
| `--primary`            | `#ff9900` | Primary CTA bg, selection ring, active tab   |
| `--primary-foreground` | `#ffffff` | Text on `--primary` bg                       |
| `--primary-soft`       | `#fff4e5` | `--primary/10`-equivalent — hover/focus tint |

Restricted to: primary CTA buttons, the currently selected nav item, active
tab underline, trend chart #1 line, "Hot" tag. **Do not** use orange for
body text, section dividers, hover states, gradients, or icons without a
specific design justification. If in doubt, use gray.

### 1.3 Semantic (severity/status)

Aligned with the `severity` field in reports (high/medium/low) and with
daily-alert run states (succeeded/failed). All semantic colors use the same
visual grammar: border + subtle tinted bg + darker text.

| Token              | Hex       | Pairs with bg/text            | Meaning                   |
|--------------------|-----------|-------------------------------|---------------------------|
| `--info`           | `#146eb4` | `#eff6ff` / `#1e40af`         | Info, inline links        |
| `--success`        | `#10b981` | `#ecfdf5` / `#047857`         | Succeeded runs, OK        |
| `--warning`        | `#f59e0b` | `#fffbeb` / `#b45309`         | Medium severity, needs-check |
| `--danger`         | `#dc2626` | `#fef2f2` / `#991b1b`         | High severity, failed runs |

Severity tag component must use these exact pairings — no invention per
page. Build once in `src/components/ui/severity-tag.tsx` and use everywhere.

### 1.4 Chart palette

Recharts / Line charts: `--primary` (`#ff9900`) for the #1 / highlighted
series. All other lines use cool grays or `--info` variants — never fight
with the primary color. Full palette order:

```
#ff9900 → #146eb4 → #374151 → #10b981 → #8b5cf6 → #06b6d4 → #d97706
```

First 3 are high-contrast essentials; items 4-7 only appear when there are
>3 series. Dashboard's current `COLORS` array in `dashboard/page.tsx`
violates this (has `#e74c3c` red which clashes with `--danger`) — fix when
refactoring that page.

---

## 2. Typography

### 2.1 Font stack

```css
font-family:
  'Inter',                    /* Western UI text */
  'PingFang SC',              /* macOS / iOS Chinese */
  'Microsoft YaHei',          /* Windows Chinese */
  '微软雅黑',
  sans-serif;                 /* fallback */
```

Zero network cost, cross-platform, bilingual-consistent. Do **not** add
Google Fonts or Vercel Font Optimization — not worth the extra request.

### 2.2 Scale

Stick to a 4-step scale. Anything outside this scale needs a design review.

| Class       | Size  | Line-height | Usage                               |
|-------------|-------|-------------|-------------------------------------|
| `text-xs`   | 12px  | 1.5         | Tags, timestamps, metadata only     |
| `text-sm`   | 14px  | 1.6         | Body text, default — most things    |
| `text-base` | 16px  | 1.65        | Report article body, comfortable reading |
| `text-lg`   | 18px  | 1.5         | Section titles (`h2`)               |
| `text-xl`   | 20px  | 1.45        | Page subtitles                      |
| `text-2xl`  | 24px  | 1.4         | Page titles (`h1`)                  |

Important for bilingual: Chinese + `text-sm` + default Tailwind
`leading-normal` (1.5) is too tight. Always use `leading-relaxed` (1.625)
or `leading-7` for any Chinese paragraph longer than one line. This is
non-negotiable for report bodies.

### 2.3 Weights

Only three: `font-normal` (400), `font-medium` (500), `font-semibold` (600).
Never `font-bold` (700) — it's too heavy for modern SaaS especially with
Chinese characters which already look bold at 600.

---

## 3. Spacing & layout

### 3.1 Scale

Tailwind's default 4px base is fine. Standard rhythm:

| Step | px  | Usage                                                  |
|------|-----|--------------------------------------------------------|
| 2    | 8   | Icon-to-text gap, inline tag padding                   |
| 3    | 12  | Default gap inside a component                         |
| 4    | 16  | Card padding (`p-4`), form field gap                   |
| 6    | 24  | Section-to-section gap, card stack gap                 |
| 8    | 32  | Page section margin                                    |
| 12   | 48  | Hero margin, top-of-page breathing room                |

### 3.2 Container

```tsx
<main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
```

- `max-w-7xl` (1280px) on desktop — current `main` layout already uses this
- `py-8` on desktop (was `py-6`), `py-6` on mobile — more breathing room
- Every page content wrapper follows this exact pattern

### 3.3 Card conventions

```tsx
// Standard card (reports list item, dashboard sections)
<div className="rounded-lg border border-border bg-card p-4 shadow-sm">

// Interactive card (clickable list item)
<button className="rounded-lg border border-border bg-card p-4 shadow-sm
                   transition-all hover:border-border-strong hover:shadow
                   focus-visible:ring-2 focus-visible:ring-primary">

// Emphasized card (hot news, current selection)
<div className="rounded-lg border border-primary bg-primary-soft p-4 shadow-sm">
```

- Always `rounded-lg` (8px) — not `rounded` (4px), not `rounded-xl` (12px).
  Consistency wins over micro-variation.
- Default shadow = `shadow-sm`. Elevated states (modals, dropdowns) = `shadow-md`.
  Never `shadow-lg` or `shadow-xl` — too much in flat SaaS.
- Hover: change **border color**, not background color (background changes
  are noisy and feel 2012).

---

## 4. Component vocabulary

### 4.1 shadcn/ui is the source of truth

All primitive components come from shadcn/ui (to be installed). Project
policy:

- **Always prefer** shadcn/ui's Button, Card, Badge, Input, Select, Tabs,
  Dialog, DropdownMenu, Table over hand-rolled equivalents
- **Never** import from MUI, Chakra, Ant Design, or Radix directly — always
  go through shadcn/ui wrappers (they provide our theme)
- **Custom components** live in `src/components/ui/` if they're primitive
  building blocks, or `src/components/<domain>/` if they're app-specific
  (alerts, report, admin, etc.)

### 4.2 Button hierarchy

| Variant    | When                                            |
|------------|-------------------------------------------------|
| `primary`  | The ONE main action on a screen (Save, Submit, Trigger now) |
| `secondary`| Alternative actions (Cancel, Back, Reset)       |
| `outline`  | Tertiary actions (Export, Filter)               |
| `ghost`    | Icon buttons, nav items, row actions            |
| `destructive`| Delete, Remove, Revoke access                 |

Rule: every page has **at most one** `primary` button visible at once.
Multiple `primary` buttons on a screen = design error.

### 4.3 Badge / Tag

Use for: severity, status, type, channel source.

```tsx
<Badge variant="warning">medium</Badge>
<Badge variant="success">succeeded</Badge>
<Badge variant="outline">Regular Report</Badge>  // for type
```

Never reinvent tag styles inline. Build the Badge variants once; map every
display need onto a variant.

### 4.4 Icons

Use **lucide-react** (shadcn/ui's default). Default size `h-4 w-4`, stroke
`1.5`. Never emoji in UI chrome (page titles, section headers, buttons).
Emoji are only OK inside user-generated content (report body, news title).

Exception: current dashboard has 📈 📄 📊 🔥 📚 — these must be replaced
with lucide icons when the dashboard gets refactored (`TrendingUp`,
`FileText`, `Table`, `Flame`, `Archive`).

### 4.5 Form inputs

Inputs follow shadcn/ui style: `h-10`, `rounded-md`, border
`border-input`, focus ring in `--primary`. Chinese label text should be
`font-medium text-sm`, paired with the input on the same row on desktop
(`flex items-center gap-3`) and stacked on mobile.

---

## 5. Motion

Less is more.

- Hover transitions: `transition-colors duration-150`
- Menu / dropdown open: `transition-all duration-150`
- Loading spinners: Tailwind's `animate-spin` at `border-primary`
- Page transitions: **none** — Next.js router is fast enough
- "Skeleton" placeholders are acceptable but prefer a simple spinner for
  <500ms loads

Never bounce, never elastic, never "wobble in" on appear. Modern SaaS
motion is linear and fast.

---

## 6. Bilingual content (Principle 3 applied to UI)

- All UI strings go through `t()` from react-i18next — already the pattern
- When rendering user-facing DB content (report body, news title, alert
  topic), check `i18n.language` and prefer `content_translated` if
  available; fall back to original
- **Chinese readability**: min `leading-relaxed` (see §2.2); avoid
  `tracking-tight` on Chinese; don't put Chinese inside a colored
  background (e.g. orange badge) unless it's a single short word (≤4 chars)
- **English readability**: avoid long lines; use `max-w-prose` (65ch) for
  any English article-body text

---

## 7. Accessibility (baseline, not optional)

- Every interactive element has visible `focus-visible:ring-2
  focus-visible:ring-primary focus-visible:ring-offset-2`
- Color contrast WCAG AA minimum (4.5:1 for body, 3:1 for large text) —
  our neutral + `#ff9900` combo meets this at text sizes ≥ `text-sm`
- Every icon button has an `aria-label`
- Tables use `<th scope>` and never rely on color alone to convey state
- Form inputs have explicit `<label>` (not just placeholder)

---

## 8. Dark mode (deferred)

Current decision (2026-05): **not building dark mode yet**. shadcn/ui
supports it via CSS variables; when we add it later, it's a
globals.css-only change. Do not hand-code `dark:` variants now —
that's scope we're not paying for.

---

## 9. Page-level patterns

### 9.1 Page header

Every top-level page (`/dashboard`, `/reports`, `/alerts`, `/news`,
`/requests`, `/admin`) starts with:

```tsx
<div className="mb-8 flex items-start justify-between gap-4">
  <div>
    <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
    <p className="mt-1 text-sm text-foreground-muted">{t('subtitle')}</p>
  </div>
  <div className="flex items-center gap-2">
    {/* Page-level actions: export, filter, trigger, etc. */}
  </div>
</div>
```

- h1 is `text-2xl font-semibold`, NOT `text-2xl font-bold`
- Optional subtitle in `text-sm text-foreground-muted`
- Page-level actions (buttons, controls) live in the header's right slot —
  never at the bottom of the page

### 9.2 Section header (inside a page)

```tsx
<h2 className="text-lg font-semibold text-foreground">{t('section')}</h2>
```

No emoji. If the section needs a leading visual cue, use a lucide icon at
`h-5 w-5 text-foreground-muted`.

### 9.3 Nav bar (top)

- Background: white (`bg-card`)
- Bottom border: `border-b border-border`
- Height: `h-14`
- Text color: `text-foreground-muted` default, `text-foreground` on hover,
  `text-primary` on active route
- Active route indicator: **bottom underline** (2px `bg-primary`), NOT a
  filled pill

This is a structural change from the current dark navy `#232f3e` navbar.

---

## 10. Things that are OK to keep as-is

Not every existing pattern needs to change. Explicit keep-list (to avoid
scope creep):

- Domain switcher UX (dropdown in the nav) — restyle colors only
- Language switcher component — restyle colors only
- Notification bell — restyle colors only
- Table structure in `ReportRenderer` / `TopTopicsTable` — semantics are
  good; just restyle with tokens
- i18n key structure — don't rename keys in this refactor
- Supabase data fetching patterns — this is UI-only

---

## 11. Anti-patterns in current codebase

For reference when refactoring. Do not replicate these.

1. **Raw hex values scattered**: `dashboard/page.tsx` has `#232f3e`,
   `#ff9900`, `#146eb4`, `#fff9f0` hard-coded. Replace with tokens.
2. **Mixed emoji in section headers**: 📈 📄 📊 🔥 📚 each section a
   different emoji. Replace with lucide icons.
3. **Gradient backgrounds on Hot News cards**: `bg-gradient-to-br
   from-[#fff9f0] to-white` — modern SaaS does not use gradients on
   cards. Use a solid `bg-primary-soft` instead.
4. **Absolutely-positioned number badges** on hot news (the `-top-1 -left-1
   bg-[#ff9900] ... rounded-full` number circle). Drop it — rank is clear
   from list order.
5. **Two conflicting card styles in the same list** (hot vs recent news
   look like different worlds). Use ONE card style with a single boolean
   difference ("emphasis=true"  → primary-soft bg).
6. **`text-sm` Chinese paragraph without `leading-relaxed`** — cramped.
7. **Outline-heavy forms** — the current login page has heavy borders
   everywhere. Modern SaaS uses single-border inputs on a white card.
8. **`font-bold` on section headers** — use `font-semibold`.
9. **PageShiftControls sandwiched between table and detail pane** in
   `/alerts` — controls belong near the data they control; move to header.
10. **Mobile navbar hides domain switcher** — switcher needs to stay
    accessible on mobile (dropdown in header, not buried in hamburger).

---

## 12. When introducing new UI

Before writing any JSX:

1. Is this a pattern already covered by shadcn/ui? → use that
2. Does this exist in our `src/components/ui/`? → use that
3. Is this a new page? → copy the §9.1 page-header structure
4. Does this need a new color? → answer is no; find the closest semantic
   token in §1.3

If a design requires deviation from this document, flag it in the commit
message with `ui-deviation: …` and a one-line reason. The document is a
contract, not a suggestion.
