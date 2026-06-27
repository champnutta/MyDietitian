---
name: MyDietitian
description: Premium, warm nutrition-coaching surfaces for LINE — customer dashboard, goal setup, and the owner's admin panel.
colors:
  vital-green: "#18B98C"
  vital-green-deep: "#0E8A67"
  ink: "#1F2937"
  muted: "#7A8088"
  bg: "#F4F6F5"
  surface: "#FFFFFF"
  line: "#EEF0EF"
  danger: "#E0533F"
  warn: "#B9770F"
  data-carb: "#F2A93B"
  data-fat: "#F0705F"
  data-fiber: "#845EF7"
  data-calorie: "#185FA5"
typography:
  headline:
    fontFamily: "-apple-system, 'Segoe UI', 'Noto Sans Thai', sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "-apple-system, 'Segoe UI', 'Noto Sans Thai', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, 'Segoe UI', 'Noto Sans Thai', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  metric:
    fontFamily: "-apple-system, 'Segoe UI', 'Noto Sans Thai', sans-serif"
    fontSize: "25px"
    fontWeight: 700
    lineHeight: 1.1
  label:
    fontFamily: "-apple-system, 'Segoe UI', 'Noto Sans Thai', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "10px"
  md: "14px"
  lg: "18px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.vital-green}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  stat-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "15px"
  metric-tile:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 10px"
---

# Design System: MyDietitian

## 1. Overview

**Creative North Star: "The Calm Coach"**

MyDietitian is a paid nutrition-coaching service that lives inside LINE. Its surfaces — the customer's progress dashboard, the goal-setup form, and the owner's admin panel — should feel like a calm, expert coach who already knows you: warm and encouraging, quietly precise, never clinical and never shouting. The premium quality is carried by space, restraint, and a single confident green — not by more chrome, more cards, or more color.

Density is deliberately low for customer surfaces (one clear focal point per screen, read in a single glance on a phone inside the LINE webview) and earns the right to be denser only in admin, where the owner is scanning the business. Across all three surfaces the visual vocabulary is one family of soft-cornered white cards on a cool off-white field, a single vital green for identity and primary action, and a small set of muted data colors reserved strictly for macros and charts.

This system explicitly rejects the **generic SaaS dashboard** (walls of identical icon-heading-number cards, template-interchangeable), **clinical/hospital coldness** (sterile blue-white grids, lab-report sterility with no warmth), and **cluttered number-walls** (dense data with no hierarchy, everything the same weight). Where the current build leans SaaS-shaped, the direction is to edit down toward calm.

**Key Characteristics:**
- One vital green carries identity and primary action; everything else is neutral or reserved data color.
- Soft 14–18px corners, near-flat surfaces, whisper-light shadows.
- Phone-first, Thai-first; glanceable before detailed.
- Warmth from green, copy, and roundness — never from a warm-tinted background.
- Restraint as the premium signal: space over decoration.

## 2. Colors

A cool, calm neutral field with a single saturated vital green for life and action, plus a tightly-scoped set of macro-data hues that appear only in charts and nutrient rows.

### Primary
- **Vital Green** (`#18B98C`): The brand. Primary buttons, the active tab indicator, positive/"ok" metrics, progress fills, selection and focus accents. The one color a user should associate with MyDietitian.
- **Vital Green Deep** (`#0E8A67`): The pressed/hover and on-light-text shade of the brand — active tab label, link-like emphasis, button hover.

### Secondary (macro & chart data — reserved)
- **Carb Amber** (`#F2A93B`): Carbohydrate / energy series in gauges and charts.
- **Fat Coral** (`#F0705F`): Fat series.
- **Fiber Violet** (`#845EF7`): Fiber series.
- **Calorie Blue** (`#185FA5`): Daily-calorie gauge.

### Neutral
- **Ink** (`#1F2937`): Primary text and high-emphasis numbers.
- **Muted** (`#7A8088`): Secondary text, labels, captions. Verify ≥4.5:1 on white before using for body.
- **Field** (`#F4F6F5`): The page background — a cool off-white, never warm/cream.
- **Surface** (`#FFFFFF`): Cards, drawers, inputs.
- **Line** (`#EEF0EF`): Hairline borders and dividers.

### Semantic
- **Danger** (`#E0533F`): Errors, expiring/expired, destructive emphasis.
- **Warn** (`#B9770F`): Caution metrics (at-risk, high fallback). On amber-tinted fills use the deep amber for text, never gray.

### Named Rules
**The One Green Rule.** There is exactly one brand green: Vital Green `#18B98C`. The `settings` surface currently uses a second, brighter LINE-green (`#1db446`) on a warm paper background (`#fffdf5`); that is drift to reconcile to `#18B98C` on the cool `#F4F6F5` field — not a second sanctioned accent.

**The Reserved-Data Rule.** Amber, coral, violet, and calorie-blue are data colors only — macros, gauges, charts. They are forbidden as decoration, button color, or section accent. If it's not a nutrient or a chart series, it's neutral or green.

## 3. Typography

**Display / Body / Label Font:** the native system sans stack — `-apple-system, "Segoe UI", "Noto Sans Thai", sans-serif`. One family, every weight.

**Character:** Familiar, legible, invisible — the type disappears into the task. Thai and Latin share the stack so the two scripts sit at one optical weight. No display face; product UI earns trust through familiarity, not personality fonts.

### Hierarchy
- **Headline** (700, 20px, 1.3): Page/surface title (e.g. "MyDietitian Admin", dashboard header).
- **Title** (600, 15px, 1.4): Section headings (`h3`), card titles.
- **Metric** (700, 25px, 1.1): The single big number on a stat card — the glanceable value.
- **Body** (400, 14px, 1.5): Default text, list rows, controls. Cap prose at 65–75ch.
- **Label** (400, 12px, 1.4): Captions, stat labels, badges, timestamps — in Muted.

### Named Rules
**The Fixed-Scale Rule.** Sizes are fixed px, never fluid `clamp()`. Users view at consistent DPI; a heading that shrinks inside a panel looks worse, not designed.

**The Thai-Headroom Rule.** Thai glyphs carry tall tone marks and deep descenders. Never set line-height below 1.3 on Thai headings, and test real Thai copy (and long member names) for overflow at 360px width before shipping.

## 4. Elevation

Near-flat by default. Depth comes from tonal layering (white cards on the cool `#F4F6F5` field, inset `#F4F6F5` tiles inside cards) and from hairline `#EEF0EF` borders — not from heavy shadow. The only resting shadow is a whisper; shadow intensifies only as a response to state.

### Shadow Vocabulary
- **Resting card** (`box-shadow: 0 1px 3px rgba(0,0,0,0.05)`): The default lift under every card and stat tile. Barely there.
- **Hover lift** (`box-shadow: 0 2px 10px rgba(0,0,0,0.10)`): Interactive cards (clickable stats) on hover only.
- **Tooltip / drawer float** (`box-shadow: 0 4px 14px rgba(0,0,0,0.18)`): The one place a real shadow is allowed — floating tooltips and the bottom-sheet drawer above the dim backdrop.

### Named Rules
**The Whisper Shadow Rule.** Surfaces are flat at rest (`0 1px 3px / 0.05`). A heavier shadow is a response to state (hover, float), never decoration. If a static card has a drop shadow you can clearly see, it's too dark.

## 5. Components

### Buttons
- **Shape:** Soft (10px radius), compact (`8px 14px`).
- **Primary:** Vital Green fill, white text, weight 600 — for the single most important action (sign in, save, send). Hover deepens toward Vital Green Deep.
- **Secondary:** White fill, Ink text, 1px `#EEF0EF` border — the default for most controls (tab actions, flips, day-grants).
- **States:** Every button needs hover, `:focus-visible` (2px green ring), active, and disabled (reduced opacity, no pointer). Don't ship default-only.

### Tabs (admin)
- **Style:** Horizontal, scrollable on overflow, label-only with a 2px bottom border. Active = Vital Green underline + Vital Green Deep label, weight 600. Inactive = Muted label, transparent border. No pill backgrounds.

### Stat cards
- **Corner:** 14px (`{rounded.md}`). **Background:** white. **Shadow:** resting whisper.
- **Layout:** Muted 12px label (optional ⓘ tip affordance) above a 25px Ink/green metric. Clickable stats add a hover lift and route to a section; tip-bearing stats reveal a dark tooltip on hover.
- **Don't** wrap a stat card inside another card. Nested cards are always wrong.

### Metric tiles (drawer / dashboard)
- Inset tiles on the `#F4F6F5` field inside a card: 10px corner, 12px padding, 11px Muted label over a 16px value. Used in 3-up grids for at-a-glance facts.

### Badges / Chips
- **Style:** Pill (`999px`), 11px, tinted-fill + same-hue dark text — never gray on color. Provider badges (anthropic = `#EDE9FE`/`#6D28D9`, gemini = `#E0EDFF`/`#1D4ED8`); status badges (expiring = `#FEF3C7`/`#92400E`).

### Inputs / Fields
- **Style:** White fill, 1px `#EEF0EF` border, 10px corner, inherits the body font.
- **Focus:** Border shifts to Vital Green. Placeholder text must still hit 4.5:1 — not the default light gray.

### List rows
- Flush rows separated by a single `#EEF0EF` top border (no per-row cards). Clickable rows get a subtle `#FAFBFB` hover wash and a trailing chevron. The primary value sits right-aligned and bold.

### Drawer (bottom sheet)
- The deep-detail affordance instead of a centered modal: slides up from the bottom, 18px top corners, dim `rgba(15,23,42,.45)` backdrop, tap-outside or ✕ to close, `max-height: 86vh` scroll. Phone-first.

### Named Rules
**The Flush-List Rule.** Repeated records (at-risk, errors, payments) are flush rows divided by hairlines — never a grid of identical cards. The card grid is reserved for the small set of headline stats, not for lists.

## 6. Do's and Don'ts

### Do:
- **Do** keep one vital green (`#18B98C`) as the only identity + primary-action color; everything else neutral or reserved data hue.
- **Do** lead each surface with a single glanceable focal point (today's number, the one chart, the one list that needs attention) and let the rest recede.
- **Do** use flush hairline-divided rows for lists; reserve the card grid for a handful of headline stats.
- **Do** keep surfaces flat at rest (`0 1px 3px / 0.05`); let shadow appear only on hover/float.
- **Do** put `:hover`, `:focus-visible`, `:active`, and `:disabled` on every interactive element.
- **Do** test real Thai copy and long member names at 360px before shipping.

### Don't:
- **Don't** build a **generic SaaS dashboard** — endless identical icon-heading-number cards in a uniform grid. Edit down; give the important metric more room than the rest.
- **Don't** drift toward **clinical / hospital coldness** — sterile blue-white, sharp grids, lab-report sterility. This is a coach, not a clinic; warmth lives in the green, the roundness, and the copy.
- **Don't** ship **cluttered number-walls** — dense data with no hierarchy where everything is the same weight. One thing is biggest per screen.
- **Don't** use a warm cream/paper/parchment background (the `settings` `#fffdf5` is drift). The field is the cool off-white `#F4F6F5`.
- **Don't** introduce a second green (`#1db446`) or use data colors (amber/coral/violet/blue) as decoration or buttons.
- **Don't** reach for a centered modal when a bottom-sheet drawer or inline expansion will do.
- **Don't** set muted gray (`#7A8088`) as body text on a tinted fill without checking 4.5:1; bump toward Ink when close.
