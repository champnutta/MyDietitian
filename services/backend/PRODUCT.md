# Product

## Register

product

## Users

One primary audience, one secondary — both meeting the product **inside the LINE chat thread**, never on a web page:

- **Customers (primary)** — Thai individuals managing diet and weight. They interact with MyDietitian by chatting with the LINE bot: sending a meal photo or typing a dish name, then reading the bot's reply. Every server-built Flex card lands in a *live, scrolling chat feed* — often glanced at one-handed, standing, seconds after a meal, between other LINE conversations. The card competes with that scroll: it has roughly a half-second to land its one point before the thumb moves on. They are paying subscribers judging, message by message, whether the coach feels worth keeping.
- **Operator/owner (secondary)** — `znak.iiz@gmail.com` also receives server-built Flex in chat (e.g. the slip-approval card, "สลิปใหม่รอตรวจ"). Same medium, different job: a fast operational decision (approve/reject) from the phone. In scope for this surface, but the design is anchored to the customer feed; operator cards inherit the same tokens and glance-first discipline.

## Product Purpose

This service — the LINE-bot backend (`services/backend/src/index.ts`) — is where MyDietitian's coaching relationship actually happens. It is not a companion to the web app; for most subscribers it **is** the product. The web surfaces (dashboard, settings) are occasional deep-dives reached by a link; the chat is daily. Every reply the backend builds — meal card, daily-summary hub, the คู่มือ guide, onboarding, BIA analysis, settings/dashboard links, support replies, program-week notices — is a coaching touchpoint that has to feel considered, encouraging, and instantly readable in a busy feed. **Success = a subscriber who logs a meal, sees a card that makes progress feel real in one glance, feels encouraged, and renews.** The Flex surface carries retention directly: it is the coach's voice, and a cluttered or slow-to-read card is a coach who mumbles.

## Brand Personality

Premium, warm, encouraging — a trusted personal coach speaking inside a chat, not a food-logging bot printing data. The bot leads with the brand green, warms with copy and the orange earned-moment accent, and edits ruthlessly so each card says one thing well. Confident enough to leave whitespace even in a 300px-wide bubble. Trustworthy with meal logs, body data, and payment context. Three words: **premium, warm, encouraging** — the same personality as the web surfaces, proven under tighter constraints. In chat, warmth lives almost entirely in *copy* (a one-line streak acknowledgment, an encouraging remaining-calories nudge) and in the single orange accent — never in decorative chrome, because Flex has no room for chrome.

## Anti-references

- **Generic LINE chatbot / food-logging bot** — bubble-UI clichés, calorie-counter neon, emoji spam, walls of stat rows, the visual language of free diet trackers. MyDietitian is a paid coach; its cards must read as more considered than any free bot's, not less.
- **The data-dump card** — every macro, every number, every button crammed into one bubble because "the room is there." No focal point, everything the same weight, nothing readable at a glance in a moving feed. Premium means one clear thing per card.
- **Clinical / lab-report coldness** — sterile blue-white rows, sharp grids, a nutrition-facts-panel feel. This is an encouraging coach in a chat, not a printout.
- **Chatbot chrome greens** — the retired LINE-grass `#1DB446` / `#12743A` reached for "to match LINE's chat UI." The brand keeps its own logo green inside LINE; it does not reskin itself to look like the platform.
- **Motion/glass cosplay** — trying to fake web-app polish (shadows, gradients, animation) that LINE Flex cannot render. The medium's flatness is the aesthetic, not a limitation to disguise.

## Design Principles

1. **Glanceable-in-feed, or it failed.** Every card competes with an active chat scroll. The single most important thing — the day's calories, the meal name, the guide's next action — must land in one glance before the reader scrolls past. One focal element per bubble; everything else recedes or is cut. This is the sharpest version of the web's glanceable-first rule, because there is no "page" to settle into.
2. **The medium is flat — design with it.** LINE Flex is JSON boxes: no arbitrary CSS, no motion, no real shadow, fixed size buckets, color applied only where the schema allows. Warmth and hierarchy come from copy, weight, spacing, one accent color, and emoji-as-icon — not from effects the renderer will drop. Never design a card that assumes capabilities Flex doesn't have.
3. **Retention through encouragement, not noise.** A card's job is to make the subscriber feel progress and want to come back. Celebrate streaks and wins in *copy* and the orange accent; never by adding another row, button, or bubble. Proactive pushes (program week change, program complete) must each be an earned, useful moment — never a nag.
4. **One system, web and chat.** The chat surface obeys the same brand as the web: One Green (`#1F8A43` / `#146E33`), orange only for earned moments, reserved macro-data colors, flat white bodies. A subscriber moving from a Flex card to the dashboard should feel one product. Reconcile any drift toward LINE-chrome greens on sight.
5. **`altText` is part of the design.** Every Flex message has an `altText` string shown in notifications, the chat list, and to screen readers. It is not a throwaway — it must carry the card's one point in plain text, so the message works even when the bubble doesn't render.

## Accessibility & Inclusion

- **WCAG 2.1 AA color contrast** — body text ≥ 4.5:1, large/bold ≥ 3:1, against the *actual* Flex fill. Green-on-white and white-on-green must use the deep shade (`#146E33`) where a light green would fail. Muted `#7A8088` on white is borderline for small text — bump toward Ink when close.
- **Thai-first, overflow-safe** — Thai is the only customer language and runs long; Flex boxes are narrow (~300px) and wrap unpredictably. Set `wrap: true` on any text that can grow, keep button labels short (Thai + emoji overflow a 2-column cell fast), and test real Thai copy and long dish/member names before shipping.
- **`altText` for non-visual access** — screen readers and notification previews get only `altText`; it must be a meaningful summary, never "flex message" or an empty string.
- **No motion dependency** — Flex cannot animate; nothing in the experience may rely on motion. (This is a constraint the medium enforces, and the design should never fight it.)
- **Touch targets** — action buttons rely on LINE's own button sizing; keep to real `button` elements with `height: "sm"` or larger rather than tap-on-text hacks, so targets stay thumb-reachable.
