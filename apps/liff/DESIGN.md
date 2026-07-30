---
name: MyDietitian
description: Premium, encouraging nutrition-coaching surfaces for LINE — customer dashboard, goal setup, and the owner's admin panel.
colors:
  vital-green: "#1F8A43"
  vital-green-deep: "#146E33"
  brand-orange: "#E5861C"
  brand-orange-deep: "#C76A12"
  admin-teal: "#0D9488"
  admin-teal-deep: "#0F766E"
  ink: "#1F2937"
  muted: "#7A8088"
  bg: "#F4F6F5"
  surface: "#FFFFFF"
  line: "#EEF0EF"
  danger: "#E0533F"
  warn: "#B9770F"
  data-protein: "#2F6DB5"
  data-carb: "#F2A93B"
  data-fat: "#845EF7"
  data-fiber: "#149E8E"
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

**Creative North Star: "The Trusted Guide"**

MyDietitian is a paid nutrition-coaching service that lives inside LINE. Its surfaces — the customer's progress dashboard, the goal-setup form, and the owner's admin panel — should feel like a trusted guide who already knows you: warm and encouraging when it matters (a streak earned, a goal hit), quietly precise the rest of the time, never clinical and never shouting. Premium quality is carried by space, restraint, and the logo's two brand colors — a confident green that leads, warmed by an orange accent reserved for delight bursts that earn retention, not decoration.

Density is low for customer surfaces (one clear focal point per screen, read in a single glance on a phone inside the LINE webview) and earns the right to be denser only in admin, where the owner scans the business. Across customer surfaces the visual vocabulary is one family: soft-cornered white cards on the cool off-white field `#F4F6F5`, Brand Green `#1F8A43` for identity and primary action, Brand Orange `#E5861C` as the earned-moment accent, and a small set of muted data colors reserved strictly for macros and charts. Admin uses a deep teal (`#0D9488`) as its owner-console accent — distinct from the customer green so the owner tool never reads as a reskinned dashboard.

This system explicitly rejects the **generic SaaS dashboard** (walls of identical icon-heading-number cards), **clinical/hospital coldness** (sterile blue-white grids), **cluttered number-walls** (dense data with no hierarchy), and **generic LINE chatbot / food-logging app** aesthetics (bubble UI clichés, calorie-counter neon, free-tracker visual language).

**The logo-duotone decision (2026-07):** the palette is anchored to the actual MyDietitian logo — a green→orange gradient mark with the tagline *กินถูก = ลดจริง* (eat right = real results). Two brand colors, not one:

- **Brand Green** `#1F8A43` (deep `#146E33`) — a logo-matched forest/kelly green (yellow-green, *not* the old teal). Carries identity and every primary action. This supersedes **both** prior greens: the documented teal `#18B98C` (off-logo, too blue) and the grass `#1DB446`/`#12743A` that had spread across Flex and `settings` (closer to the logo but too neon/LINE-chrome). One green now, drawn from the mark.
- **Brand Orange** `#E5861C` (deep `#C76A12` for white text) — the logo's warmth and "result" color, elevated from a lone streak-chip tint to an official **accent**: earned moments (streak, goal-hit, program milestone) and small energetic highlights. Green leads; orange accents. Warmth finally has a home in a color, matching the *warm, encouraging* personality — it is no longer forbidden to non-neutral.

The green→orange **gradient is the logo's alone** — never rebuilt as UI chrome (no gradient text, no gradient fills); the duotone lives in the app as two solid roles. The field stays the cool-neutral `#F4F6F5` (not the logo's cream badge): warmth is carried by the orange accent, not a warm-tinted background. Two reconcile fronts remain: (1) `settings` (Kanit font, `#1db446`, warm paper `#fffdf5`, glass hero → the tokens here), now also carrying the new weekly CUT/Bulk program controls; (2) the backend-built **LINE Flex** cards (meal card, daily-summary hub, help/onboarding, settings-link, program notifications), whose `#1DB446`/`#12743A` move to Brand Green.

**Key Characteristics:**
- Brand Green leads customer identity and primary action; Brand Orange accents earned moments; admin teal is owner-only; everything else is neutral or reserved data color.
- Soft 14–18px corners, near-flat surfaces, whisper-light shadows.
- Phone-first, Thai-first; glanceable before detailed.
- Warmth from the orange accent, encouraging copy, and roundness — never from a warm-tinted background or chatbot chrome.
- Delight bursts (streak pill, goal-hit badge, progress fill) are earned moments — not ambient decoration.
- Restraint as the premium signal: space over decoration; orange stays a spark, never a flood.

## 2. Colors

A cool, calm neutral field carrying the logo's two brand colors — a forest-kelly green that leads and a warm orange that accents — with a deep teal for the owner admin console, plus a tightly-scoped set of macro-data hues that appear only in charts and nutrient rows.

### Primary (brand green — identity & action)
- **Brand Green** (`#1F8A43`): The customer brand, drawn from the logo wordmark. Primary buttons, active tab indicators, positive/"ok" metrics, progress fills, selection and focus accents. The one color a subscriber should associate with MyDietitian. Clears 3:1 with white for bold button/label text (the old teal `#18B98C` did not).
- **Brand Green Deep** (`#146E33`): Pressed/hover and on-light-text shade — active tab label, link-like emphasis, button hover, macro values in meal rows, and any small green text on white.

### Accent (brand orange — warmth & results)
- **Brand Orange** (`#E5861C`): The logo's warmth, mapped to the *ลดจริง* / "real result" idea. Reserved for **earned moments and energetic highlights**: streak and goal-hit chips, program-milestone markers, a single "celebrate" emphasis. Fill with dark text, or use the deep shade for white text. Never a second primary — green owns primary action; orange sparks.
- **Brand Orange Deep** (`#C76A12`): Orange text on light fills and white text on an orange fill (clears 3:1). Emphasis numerals in an earned-moment chip.
- **Guard:** orange stays clear of the reserved **Carb Amber** `#F2A93B` (lighter, data-only) and **Warn** `#B9770F` (darker ochre, caution-only). If an orange isn't a brand accent moment, it's one of those two — not this.

### Secondary (owner console only)
- **Admin Teal** (`#0D9488`): Owner admin primary accent — buttons, active tabs, positive metrics. Distinct from the customer brand green so the owner console reads as a separate tool, not a reskinned dashboard.
- **Admin Teal Deep** (`#0F766E`): Admin hover/pressed and emphasized values.

### Tertiary (macro & chart data — reserved)
Macro hues follow tracker convention (protein→blue, carb→amber, fat→violet) and stay clear of the two system-owned hues: **green is reserved for calories/brand** and **red for danger/over-target**. This keeps four macro bars from reading as a "rainbow tracker" and stops fat from colliding with the danger red.
- **Protein Blue** (`#2F6DB5`): Protein series. Follows the protein=blue convention; avoids reusing calorie/brand green.
- **Carb Amber** (`#F2A93B`): Carbohydrate / energy series in gauges and charts.
- **Fat Violet** (`#845EF7`): Fat series. Violet (not coral/red) — matches modern trackers and avoids clashing with danger red.
- **Fiber Teal** (`#149E8E`): Fiber series. Reads as "vegetable" while staying distinct from brand green.
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
**The One Green Rule.** Every customer surface — web *and* LINE Flex — has exactly one brand green: Brand Green `#1F8A43`, deepening to `#146E33` for pressed states, on-light text, and any fill that carries white text (a Flex header bar or primary button). The prior greens are retired drift — the teal `#18B98C` (off-logo) and the grass `#1DB446`/`#12743A` — reconcile them wherever they appear (the `settings` surface and all backend-built Flex cards). Do not add a LINE-specific green "to match the chat UI"; the brand keeps its own logo green inside LINE.

**The Green-Leads Rule.** Green and orange are not interchangeable. **Green** owns identity and every primary action (the button you most want pressed, the active state, on-track). **Orange** is the accent for earned/energetic moments only — never a primary button, tab, link, or section field. If two things both shout, orange loses. A screen with orange and no green has the hierarchy backwards.

**The Reserved-Data Rule.** Protein-blue, amber, fat-violet, fiber-teal, and calorie-blue are data colors only — macros, gauges, charts. They are forbidden as decoration, button color, or section accent. If it's not a nutrient or a chart series, it's neutral, green, or (for an earned moment) orange.

**The Encouragement-Tint Rule.** Warm tinted fills for earned-moment chips and badges only, never page backgrounds or card fields: the orange family `#FFF3E0`/`#C76A12` for streak/result chips, `#E7F7F0`/`#146E33` for green progress badges. Orange as a solid accent (a milestone marker, a celebrate emphasis) is allowed on chips and small marks — still never as a page or card field.

## 3. Typography

**Display / Body / Label Font:** the native system sans stack — `-apple-system, "Segoe UI", "Noto Sans Thai", sans-serif`. One family, every weight. Settings must drop Kanit and return to this stack.

**Character:** Familiar, legible, invisible — the type disappears into the task. Thai and Latin share the stack so the two scripts sit at one optical weight. No display face; product UI earns trust through familiarity, not personality fonts. Encouraging voice lives in copy weight and word choice, not decorative type.

### Hierarchy
- **Headline** (700, 20px, 1.3): Page/surface title (e.g. "MyDietitian Admin", dashboard header).
- **Title** (600, 15px, 1.4): Section headings (`h3`), card titles.
- **Metric** (700, 25px, 1.1): The single big number on a stat card — the glanceable value. Dashboard hero calories may scale to 40px for the one focal number only.
- **Body** (400, 14px, 1.5): Default text, list rows, controls. Cap prose at 65–75ch.
- **Label** (400, 12px, 1.4): Captions, stat labels, badges, timestamps — in Muted.

### Named Rules
**The Fixed-Scale Rule.** Sizes are fixed px, never fluid `clamp()` on product UI headings. Users view at consistent DPI; a heading that shrinks inside a panel looks worse, not designed. (Settings' `clamp(30px, 8vw, 48px)` hero is drift.)

**The Thai-Headroom Rule.** Thai glyphs carry tall tone marks and deep descenders. Never set line-height below 1.3 on Thai headings, and test real Thai copy (and long member names) for overflow at 360px width before shipping.

## 4. Elevation

Near-flat by default. Depth comes from tonal layering (white cards on the cool `#F4F6F5` field, inset `#F4F6F5` tiles inside cards) and from hairline `#EEF0EF` borders — not from heavy shadow or glassmorphism. The only resting shadow is a whisper; shadow intensifies only as a response to state. Settings' glass hero (`backdrop-filter`, heavy `0 18px 50px` shadow) is drift — forbidden on customer surfaces.

### Shadow Vocabulary
- **Resting card** (`box-shadow: 0 1px 3px rgba(0,0,0,0.05)`): The default lift under every card and stat tile. Barely there.
- **Hover lift** (`box-shadow: 0 2px 10px rgba(0,0,0,0.10)`): Interactive cards (clickable stats) on hover only.
- **Tooltip / drawer float** (`box-shadow: 0 4px 14px rgba(0,0,0,0.18)`): Floating tooltips and the bottom-sheet drawer above the dim backdrop.

### Named Rules
**The Whisper Shadow Rule.** Surfaces are flat at rest (`0 1px 3px / 0.05`). A heavier shadow is a response to state (hover, float), never decoration. If a static card has a drop shadow you can clearly see, it's too dark.

**The No-Glass Rule.** `backdrop-filter`, frosted overlays, and gradient page backgrounds are forbidden on customer surfaces. Depth is tonal, not optical.

## 5. Components

### Buttons
- **Shape:** Soft (10px radius), compact (`8px 14px`).
- **Primary:** Brand Green fill (`#1F8A43`), white text, weight 600 — for the single most important action (sign in, save, send). Hover deepens toward Brand Green Deep (`#146E33`). Orange is never a primary button (Green-Leads Rule).
- **Secondary:** White fill, Ink text, 1px `#EEF0EF` border — the default for most controls (tab actions, flips, day-grants).
- **States:** Every button needs hover, `:focus-visible` (2px green ring), active, and disabled (reduced opacity, no pointer). Don't ship default-only.

### Tabs (admin)
- **Style:** Horizontal, scrollable on overflow, label-only with a 2px bottom border. Active = accent underline + deep accent label, weight 600. Inactive = Muted label, transparent border. No pill backgrounds.

### Stat cards & hero metrics
- **Corner:** 14px (`{rounded.md}`). **Background:** white. **Shadow:** resting whisper.
- **Layout:** Each tab gets ONE hero metric (44px on admin) as the focal point; secondary stats demote to a compact hairline-joined strip — not a uniform grid of equal cards.
- **Standard stat:** Muted 12px label (optional ⓘ tip affordance) above a 25px Ink/green metric.
- **Don't** wrap a stat card inside another card. Nested cards are always wrong.

### Encouragement chips (dashboard)
- **Streak / result pill (orange):** `#FFF3E0` fill, `#C76A12` text, pill radius, 13px weight 600 — the earned-moment delight burst for streaks and result milestones. This is Brand Orange's home turf.
- **Progress badge (green):** `#E7F7F0` fill, `#146E33` text, 1px `#C7ECDE` border — on-track / goal-progress acknowledgment.

### Metric tiles (drawer / dashboard)
- Inset tiles on the `#F4F6F5` field inside a card: 10px corner, 12px padding, 11px Muted label over a 16px value. Used in 3-up grids for at-a-glance facts.

### Badges / Chips
- **Style:** Pill (`999px`), 11px, tinted-fill + same-hue dark text — never gray on color. Provider badges (anthropic = `#EDE9FE`/`#6D28D9`, gemini = `#E0EDFF`/`#1D4ED8`); status badges (expiring = `#FEF3C7`/`#92400E`).

### Inputs / Fields
- **Style:** White fill, 1px `#EEF0EF` border, 10px corner, inherits the body font.
- **Focus:** Border shifts to Brand Green. Placeholder text must still hit 4.5:1 — not the default light gray.

### List rows
- Flush rows separated by a single `#EEF0EF` top border (no per-row cards). Clickable rows get a subtle `#FAFBFB` hover wash and a trailing chevron. The primary value sits right-aligned and bold.

### Drawer (bottom sheet)
- The deep-detail affordance instead of a centered modal: slides up from the bottom, 18px top corners, dim `rgba(15,23,42,.45)` backdrop, tap-outside or ✕ to close, `max-height: 86vh` scroll. Phone-first.

### LINE Flex messages (in-chat surface)
The primary customer surface is not a web page — it's the bot's replies inside the LINE chat, built server-side as Flex bubbles (`services/backend/src/index.ts`). This is where subscribers spend most of their attention, so it carries the same system as the web: Brand Green identity, orange earned-moment accents, white cards, tonal depth, glanceable-first. Treat it as a first-class surface, not an afterthought.

- **Bubble frame:** `mega` size, white body, `16px` padding. Optional colored **header bar** in Brand Green Deep `#146E33` with white bold title (deep shade so white text clears contrast). Footer holds the action buttons.
- **Focal number:** the day's calories as an `xxl` baseline figure with a small `kcal` / `/ target` suffix — the one glanceable value, mirroring the web hero metric. Turns Danger `#E0533F` when over target.
- **Progress bars:** a thin rounded track (`#EEF0EF`) with a Brand Green (or Calorie-Blue `#185FA5`) fill for the day, and the reserved macro hues (protein `#2F6DB5`, carb `#BA7517`/`#F2A93B`, fat `#845EF7`, fiber `#149E8E`) for macro rows. Reserved-Data Rule still applies: macro colors only on macro rows, never on buttons or chrome.
- **Buttons:** primary = Brand Green Deep `#146E33` fill, white label, for the one main action (open dashboard). Secondary = LINE's default light button for everything else. In a hub card, lay 4–6 quick actions as a full-width primary plus 2-column secondary rows (message-actions that send a command back, e.g. `กินไรดี`, `เติมวัน`, or URI-actions to a web surface). Keep labels short — Thai + emoji overflow a 2-column cell fast.
- **Program badge:** when a weekly CUT/Bulk program is active, a small header line `CUT · สัปดาห์ 3/8 · ปรับคาร์บ` — the in-chat echo of the dashboard's progress-badge chip. A crossed milestone (new week, program complete) is a legitimate orange accent moment.
- **Earned-moment copy:** streak / goal-hit acknowledgments live here as warm one-liners (`🔥 บันทึกต่อเนื่อง 5 วัน`), not extra chrome.

### Named Rules
**The Flex-Is-A-Surface Rule.** LINE Flex cards obey the full system — Brand Green (`#1F8A43`/`#146E33`) for identity and action, orange only for earned moments, reserved data colors, flat white bodies, one focal number, glanceable-first. They are not exempt because they're "just chat"; they are the surface customers see most.

**The Flush-List Rule.** Repeated records (at-risk, errors, payments) are flush rows divided by hairlines — never a grid of identical cards. The card grid is reserved for the small set of headline stats, not for lists.

**The One-Hero Rule.** Each admin tab and the customer dashboard lead with exactly one focal metric. Secondary numbers demote to a strip or recede in size — never six equal cards competing for attention.

## 6. Do's and Don'ts

### Do:
- **Do** keep one Brand Green (`#1F8A43`, deep `#146E33`) as the only customer identity + primary-action color across web *and* LINE Flex; use Brand Orange (`#E5861C`) only to accent earned moments; admin teal is owner-only.
- **Do** lead each surface with a single glanceable focal point and let the rest recede.
- **Do** use encouragement chips (streak pill, progress badge) as earned delight bursts — warm copy + tinted pill, not more UI chrome.
- **Do** use flush hairline-divided rows for lists; reserve the card grid for a handful of headline stats.
- **Do** keep surfaces flat at rest (`0 1px 3px / 0.05`); let shadow appear only on hover/float.
- **Do** put `:hover`, `:focus-visible`, `:active`, and `:disabled` on every interactive element.
- **Do** test real Thai copy and long member names at 360px before shipping.
- **Do** unify `settings.html` to dashboard tokens (system sans, Brand Green `#1F8A43`, cool `#F4F6F5` field).

### Don't:
- **Don't** build a **generic SaaS dashboard** — endless identical icon-heading-number cards in a uniform grid. Edit down; give the important metric more room than the rest.
- **Don't** drift toward **clinical / hospital coldness** — sterile blue-white, sharp grids, lab-report sterility. This is a coach, not a clinic.
- **Don't** ship **cluttered number-walls** — dense data with no hierarchy where everything is the same weight. One thing is biggest per screen.
- **Don't** look like a **generic LINE chatbot or food-logging app** — bubble UI clichés, neon fitness tropes, calorie-counter aesthetics, or free-tracker visual language.
- **Don't** use a warm cream/paper/parchment background (the `settings` `#fffdf5` is drift). The field is the cool off-white `#F4F6F5`.
- **Don't** introduce a second customer green (`#1db446`/`#12743A`) on any surface — web or LINE Flex — nor Kanit as a second font or glassmorphism on customer surfaces.
- **Don't** use data colors (amber/coral/violet/blue) as decoration or buttons.
- **Don't** reach for a centered modal when a bottom-sheet drawer or inline expansion will do.
- **Don't** set muted gray (`#7A8088`) as body text on a tinted fill without checking 4.5:1; bump toward Ink when close.
