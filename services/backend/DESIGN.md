---
name: MyDietitian — LINE Flex
description: The server-built LINE Flex message surface — meal card, daily-summary hub, คู่มือ guide, onboarding, BIA, support and program cards — expressed in the shared MyDietitian brand under LINE's Flex JSON constraints.
colors:
  brand-green: "#1F8A43"
  brand-green-deep: "#146E33"
  brand-orange: "#E5861C"
  brand-orange-deep: "#C76A12"
  ink: "#1F2937"
  human-ink: "#273039"
  muted: "#7A8088"
  surface: "#FFFFFF"
  tint-green: "#F4F8F5"
  chip-green-fill: "#E1F2E7"
  header-sub: "#D6F7EC"
  track: "#EDF1EF"
  danger: "#E0533F"
  streak-fill: "#FFF3E0"
  streak-text: "#C76A12"
  data-protein: "#2F6DB5"
  data-carb: "#F2A93B"
  data-fat: "#845EF7"
  data-fiber: "#149E8E"
  data-calorie: "#185FA5"
typography:
  card-title:
    note: "Flex text, size token xl, weight bold — the card's name in a header bar"
    size: "xl"
    weight: bold
  section-title:
    note: "Row/section heading inside the body"
    size: "sm"
    weight: bold
  focal-metric:
    note: "The one glanceable number (day calories) as a baseline figure"
    size: "xxl"
    weight: bold
  body:
    note: "Default row text, wrap:true when growable"
    size: "sm"
    weight: regular
  detail:
    note: "Supporting captions, guide-row detail, in muted"
    size: "xs"
    weight: regular
  eyebrow:
    note: "Header kicker / step marker, uppercase, on the green header bar"
    size: "xxs"
    weight: bold
rounded:
  chip: "12px"
  card-inset: "14px"
  avatar: "18px"
  pill: "999px"
spacing:
  note: "Flex spacing tokens, not px — used on box `spacing` and `paddingAll`"
  tight: "sm"
  default: "md"
  section: "lg"
  frame-pad: "16px"
  header-pad: "20px"
components:
  bubble-frame:
    size: "mega (hub/guide/support/meal), kilo (link cards), giga only if unavoidable"
    body-bg: "{colors.surface}"
    padding: "{spacing.frame-pad}"
  header-bar:
    note: "One treatment per card, chosen by the card's voice — see The Header-Voice Rule"
    brand-action:
      backgroundColor: "{colors.brand-green-deep}"
      titleColor: "{colors.surface}"
      subColor: "{colors.header-sub}"
    earned-moment:
      backgroundColor: "{colors.brand-orange-deep}"
      titleColor: "{colors.surface}"
      subColor: "#FFEBD1"
    human-voice:
      backgroundColor: "#273039"
      titleColor: "{colors.surface}"
      subColor: "#AEB8C2"
    light:
      backgroundColor: "{colors.surface}"
      titleColor: "{colors.brand-green-deep}"
      bottomRule: "2px {colors.brand-green}"
      subColor: "{colors.muted}"
    padding: "{spacing.header-pad}"
  guide-row:
    backgroundColor: "{colors.tint-green}"
    cornerRadius: "{rounded.chip}"
    padding: "12px"
    icon-chip: "36x36, {colors.chip-green-fill}, cornerRadius {rounded.avatar}"
  button-primary:
    style: primary
    color: "{colors.brand-green}"
    height: "sm"
  button-primary-deep:
    style: primary
    color: "{colors.brand-green-deep}"
    height: "sm"
  button-secondary:
    style: secondary
    height: "sm"
  progress-bar:
    track: "{colors.track}"
    fill: "{colors.brand-green} (day) / reserved macro hue (macro rows)"
  streak-chip:
    backgroundColor: "{colors.streak-fill}"
    textColor: "{colors.streak-text}"
    cornerRadius: "{rounded.pill}"
---

# Design System: MyDietitian — LINE Flex

## 1. Overview

**Creative North Star: "The coach in the chat feed."**

This document governs the **server-built LINE Flex messages** (`services/backend/src/index.ts`) — the bubbles and carousels the bot replies with inside the LINE chat. It is the chat-native expression of the master brand defined in [`apps/liff/DESIGN.md`](../../apps/liff/DESIGN.md), which remains canonical for anything shared (color intent, brand rules, the *One Green Rule*). Where the two documents ever disagree on a token value, the LIFF file wins; this file exists to say **how that brand survives LINE's Flex JSON constraints and the reality of a moving chat feed.**

Two forces shape every decision here:

1. **The feed.** A Flex card is not a page a user settles into — it drops into a live, scrolling conversation and gets a half-second glance. So every card leads with exactly one focal element (the day's calories, the meal name, the guide's next step) and lets everything else recede. Density that would be acceptable on the dashboard is fatal here.
2. **The medium.** LINE Flex is a constrained JSON box model: no arbitrary CSS, no motion, no true drop shadow, color applied only where the schema allows (`backgroundColor`, text `color`, button `color`), a fixed ladder of bubble sizes (`nano · micro · kilo · mega · giga`), and layout built only from vertical/horizontal `box`es, `text`, `button`, `image`, `filler`, and `separator`. The design language is therefore *flat by nature* — hierarchy comes from color, weight, spacing, one accent, and emoji-as-icon, never from effects the renderer will silently drop.

This surface explicitly rejects the **generic food-logging bot** (emoji spam, stat-row walls, calorie-counter neon), the **data-dump card** (everything crammed in because the room exists), **lab-report coldness**, and **LINE-chrome greens** borrowed to match the platform. It keeps the brand's own logo green inside LINE.

**Key characteristics:**
- One focal element per bubble; the rest recedes. A card that has two things shouting has none.
- Brand Green leads identity and the primary action; Brand Orange accents earned moments only; reserved data hues appear only on macro rows and gauges.
- **Feed rhythm comes from card *voice*, not a second green.** A card's header treatment encodes what kind of message it is — brand-green for action cards, orange for earned moments, deep-ink for the team's human replies, white-header for light reference cards (the คู่มือ guide, link cards). One green, four voices.
- Flat white bodies, header treatment by voice, `#F4F8F5` tint boxes for grouped content — depth is tonal, never shadow or glass.
- Emoji are the icon set (📷 ✏️ ⚖️ ◎ ⚙️), used sparingly and semantically, never as decoration.
- Copy carries the warmth: encouraging one-liners, short Thai labels, an `altText` that stands on its own.

## 2. Colors

Raw hex (Flex has no variables), matched to the master brand. Apply color only where Flex allows it: box `backgroundColor`, text `color`, button `color`.

### Brand green — identity & action
- **Brand Green** `#1F8A43` — primary buttons on white, progress-bar day fill, positive emphasis. The one color a subscriber associates with MyDietitian, identical to web.
- **Brand Green Deep** `#146E33` — **header bars** (white title text needs the deep shade to clear contrast), primary buttons that carry white labels, small green text on white, macro values in meal rows, pressed intent.

### Brand orange — earned moments only
- **Brand Orange** `#E5861C` / **Deep** `#C76A12` — streak and goal-hit chips, program-milestone markers, a single "celebrate" emphasis. Never a primary button, header bar, or section accent (**Green-Leads Rule**). In chat, orange almost always appears as the streak chip (`#FFF3E0` fill / `#C76A12` text) or a milestone line, not a fill.

### Reserved macro & gauge data
- **Protein** `#2F6DB5` · **Carb** `#F2A93B` · **Fat** `#845EF7` · **Fiber** `#149E8E` · **Calorie** `#185FA5`. Data-only — macro rows and gauges. Forbidden as button color, header, chip, or decoration (**Reserved-Data Rule**). Calorie/brand owns green; danger owns red — macros stay clear of both.

### Neutral & structural
- **Ink** `#1F2937` — primary text, high-emphasis numbers.
- **Human-Ink** `#273039` — the header-bar fill for human-voice cards (support/team reply). A deep neutral, distinct from brand chrome; white title clears contrast.
- **Muted** `#7A8088` — captions, guide-row detail, labels. Borderline for small body on white; bump toward Ink when close.
- **Surface** `#FFFFFF` — bubble body, card fields.
- **Green Tint** `#F4F8F5` — grouped-content inset boxes (guide rows, quoted support message). The chat-safe stand-in for the web's `#F4F6F5` field; used *inside* a white bubble, since the bubble itself sits on LINE's own chat background.
- **Icon-chip fill** `#E1F2E7` — the round 36px emoji-icon plate in guide rows.
- **Header sub** `#D6F7EC` — eyebrow/subtitle text on the green header bar.
- **Track** `#EDF1EF` — progress-bar track.

### Semantic
- **Danger** `#E0533F` — the focal calorie figure when over target; error/expiry emphasis.

### Named rules
**The One Green Rule (inherited).** Every customer Flex card has exactly one brand green — `#1F8A43`, deepening to `#146E33` for header bars, white-label buttons, and on-white green text. The retired LINE-grass `#1DB446` / `#12743A` is drift; reconcile it on sight. Do **not** introduce a LINE-specific green to "match the chat UI."

**The Header-Voice Rule.** A titled card's header encodes *what kind of message it is* — this is how the feed gets rhythm without ever adding a second green. The brand green still appears on exactly one thing per card (a bar, a title, or the primary button), and orange still obeys the Green-Leads Rule (never a primary button, never an everyday header). Four treatments:

- **Brand / action cards** (daily-summary hub, meal card, onboarding) → solid `#146E33` bar, white bold title. White text mandates the deep green (the mid green fails 3:1).
- **Earned-moment cards** (program complete / new week, streak or goal-hit celebration) → solid **Brand Orange Deep** `#C76A12` bar, white title (the mid orange `#E5861C` fails 3:1 for white — use the deep shade for a white-on-orange header, exactly as green uses its deep shade). Orange rises from chip to header *only* for genuinely celebratory cards.
- **Human-voice cards** (support / team reply) → a neutral deep-ink bar `#273039`, white title. When the team is speaking to a customer it is a *person*, not brand chrome — a green corporate bar makes a human reply feel automated.
- **Light cards** (คู่มือ guide, settings-link, dashboard-link) → **white header**, Brand Green title `#146E33`, a `2px` `#1F8A43` bottom rule; the green moves to the primary button. A lighter weight for reference and utility content that shouldn't shout as loud as a brand card.

One header treatment per card, and never a green bar *and* a green body fill together.

**The Feed-Rhythm Rule.** Variety in the chat feed comes from *card voice* (the four header treatments above) plus the orange accent and the reserved macro hues — **never** from a second or third green. If cards feel monotonous, the fix is a card whose voice is mis-assigned (a human reply wearing a brand bar, a milestone missing its orange), not a new green. Two greens on the surface is drift, not variety.

**The Feed-Contrast Rule.** The bubble body is always white so the card reads against any chat background (light or dark LINE themes). Never tint the whole bubble body; tint only inset boxes with `#F4F8F5`.

## 3. Typography

Flex exposes a **fixed size ladder** (`xxs · xs · sm · md · lg · xl · xxl · 3xl…`) and two weights (`regular`, `bold`) — not px. The font is LINE's own system stack (Thai + Latin); there is no custom face and none is possible. Hierarchy is built from this ladder plus weight and color.

### Roles (Flex size tokens)
- **Focal metric** (`xxl`, bold, Ink — Danger `#E0533F` when over target): the day's calories in the daily-summary hub, mirroring the web hero. Exactly one per card.
- **Card title** (`xl`, bold, white on the green header bar): the card's name.
- **Section title** (`sm`, bold, Ink): a row/group heading in the body.
- **Body** (`sm`, regular, Ink): default row text. `wrap: true` on anything that can grow.
- **Detail** (`xs`, regular, Muted): guide-row detail, captions, quiet notes.
- **Eyebrow / step** (`xxs`, bold, `#D6F7EC` on header): kicker or a step marker chip.

### Named rules
**The Wrap-Or-Truncate Rule.** Thai runs long and Flex boxes are ~300px. Any text that can grow (dish names, member names, coach copy, support messages) must set `wrap: true`; anything on a fixed row (a right-aligned kcal value) stays short by construction. Test real Thai copy before shipping — a title that fits in English overflows in Thai.

**The Two-Weight Rule.** With only regular/bold available, reserve **bold** for the one thing that matters in a box (the title, the focal number, a macro value). Bolding several items flattens the hierarchy the medium already struggles to express.

## 4. Layout & structure

Flex layout is nested vertical/horizontal `box`es. The vocabulary is deliberately small.

- **Bubble sizes:** `mega` for content cards (hub, guide, meal, BIA, support, onboarding); `kilo` for single-purpose link cards (settings-link, dashboard-link); avoid `giga` unless a card truly cannot be edited down — an over-large bubble in a feed reads as "too much."
- **Carousel** (`คู่มือ` guide): up to a short sequence of `mega` bubbles the user swipes. Legitimate when the content genuinely *is* an ordered walkthrough (record → body → progress → support). Keep it to ≤ ~5 cards; a carousel is a cost the reader pays in swipes.
- **The frame:** content card = optional green **header** (`paddingAll: 20px`) + white **body** (`paddingAll: 16px`, `spacing` between rows) + optional **footer** holding buttons (`paddingAll: 16px`, `paddingTop: 0px`).
- **Grouped content** sits in a `#F4F8F5` inset box with `cornerRadius: 12–14px` — the guide row, the quoted support message. This is how "cards inside the card" are done without real nesting or shadow.
- **Rows:** horizontal `box` with a `text` label (`flex: 1/2`) and a right-aligned value (`flex: 0`, `align: "end"`). Meal rows, macro rows, and label/value rows all follow this.
- **Progress bars:** a `track`-colored outer box with an inner filled box whose width encodes percent — thin, rounded, one per metric.

### Named rules
**The One-Focal Rule.** Each card leads with exactly one focal element and demotes the rest. The daily hub has one `xxl` calorie figure; the meal card has one dish name; the guide card has one titled step. Never two competing focal points in a bubble.

**The Filler-Not-Shadow Rule.** Depth and alignment come from `filler`, `separator`, `spacing`, and the `#F4F8F5` inset — never from shadow, gradient, or glass (Flex renders none of them). If a layout needs "lift," it needs better spacing, not a shadow that won't draw.

## 5. Iconography & motion

- **Icons are emoji**, chosen semantically and sparingly: 📷 record, ✏️ edit, ⚖️ weight, 🏃 activity, ◎ today, ⚙️ settings, 🥗 coach, 💬 support. One per row at most; emoji are the icon system, not decoration. Avoid stacking emoji in copy — it reads as the free-bot aesthetic the brand rejects.
- **No motion.** Flex cannot animate; nothing may depend on movement. This is the medium enforcing the brand's "restraint as premium" — lean into it.

## 6. Components (mapped to builders)

Every customer Flex builder in `services/backend/src/index.ts`:

- **Meal card** — `buildMealReplyMessage` / `buildMealCardMessage` ([~6647](src/index.ts:6647)). The reply after logging a meal: dish name (focal), kcal + macros, per-meal action buttons (edit / leftover / delete via LIFF URLs). The card most subscribers see most.
- **Daily-summary hub** — `buildDailySummaryFlexMessage` ([5773](src/index.ts:5773)). The day's calories as the `xxl` focal figure (Danger when over), macro progress rows in reserved hues, streak chip (orange), logged-meals list, and a quick-action grid (`DAILY_SUMMARY_HUB`: menu / exercise / coach / status / renew).
- **คู่มือ guide** — `buildHelpFlexMessage` ([6307](src/index.ts:6307)). A `mega` carousel walkthrough (record → body → progress → support), each card a green header + `#F4F8F5` guide rows + step-relevant buttons. See §7.
- **Onboarding** — `buildOnboardingMessages` ([6079](src/index.ts:6079)). First-run profile setup prompt.
- **BIA / InBody** — `buildBiaReplyMessage` ([6890](src/index.ts:6890)). Body-composition analysis reply from an uploaded InBody/BIA report.
- **Support reply** — `buildSupportReplyMessage` ([6206](src/index.ts:6206)). Team's answer to a support ticket: green header, quoted message in a tint box, one "ตอบแอดมิน" reply button.
- **Settings link** — `buildSettingsLinkMessage` ([6267](src/index.ts:6267)) · **Dashboard link** — `buildDashboardLinkMessage` ([6159](src/index.ts:6159)). `kilo` single-purpose cards: one line of copy + one primary URI button.
- **Operator slip-approval** ([~3584](src/index.ts:3584)) — secondary audience; approve/reject a new payment slip. Same tokens, operational focus.

### The `FLEX_CUSTOMER` token block
All customer cards draw color from the `FLEX_CUSTOMER` constant ([5697](src/index.ts:5697)), already annotated "aligned with apps/liff/DESIGN.md." **New cards must use these tokens, not fresh hex literals.** Two builders (`buildSettingsLinkMessage`, `buildDashboardLinkMessage`) still inline `#146E33` / `#647067` hex instead of the token — that is drift to fold back into `FLEX_CUSTOMER` when next touched.

## 7. `altText` discipline

Every `type: "flex"` message carries an `altText` shown in the notification, the chat list, and to screen readers — and it must stand alone when the bubble doesn't render.

- **Carry the one point in plain Thai.** `"📖 คู่มือการใช้งาน MyDietitian"`, `"ทีมงาน MyDietitian ตอบกลับเคสของคุณ"` — a real summary, never "flex message" or empty.
- **Reuse the card's own text summary** where one exists: several builders slice a `format…Reply(...)` string into `altText` (`.slice(0, 1500)` for the body summary, `400` for the slip). Keep that pattern.
- **Lead with the emoji + subject** so the notification preview is scannable.

## 8. Do's and Don'ts

### Do
- **Do** lead every card with one focal element and let the rest recede — the feed gives you one glance.
- **Do** draw color from `FLEX_CUSTOMER`; keep the One Green (`#1F8A43` / `#146E33`) and orange-only-for-earned-moments.
- **Do** pick the header treatment by the card's *voice* (Header-Voice Rule): green bar for action cards, `#C76A12` bar for earned moments, `#273039` bar for team replies, white header + green title for light/reference cards.
- **Do** set `wrap: true` on any growable Thai text and keep button labels short.
- **Do** group content in `#F4F8F5` inset boxes instead of reaching for shadow or nesting.
- **Do** write an `altText` that carries the card's point on its own.

### Don't
- **Don't** cram every number and button into one bubble because the room exists — edit down to the one thing.
- **Don't** introduce a LINE-chrome green (`#1DB446` / `#12743A`) or a second brand green to "match the chat" — feed variety is card *voice*, never a new green.
- **Don't** put a white title on the mid orange `#E5861C` (fails 3:1) — an orange header uses the deep `#C76A12`; and never make orange a primary button or an everyday (non-celebratory) header.
- **Don't** dress a human team reply in a brand-green bar — it reads as automated; use the `#273039` human-voice header.
- **Don't** use reserved macro hues (blue/amber/violet/teal) as button, header, or chip color.
- **Don't** fake depth with shadow, gradient, or glass — Flex won't render them; use spacing and tint.
- **Don't** stack emoji as decoration or lean on the free-food-logging-bot look.
- **Don't** ship a green header with white text at the mid green `#1F8A43` — white needs the deep `#146E33`.
- **Don't** leave `altText` empty, generic, or untranslated.
