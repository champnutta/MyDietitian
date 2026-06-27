---
target: apps/liff/public/admin.html
total_score: 28
p0_count: 0
p1_count: 2
timestamp: 2026-06-26T19-01-12Z
slug: apps-liff-public-admin-html
---
# Critique — apps/liff/public/admin.html

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading/error/sending states exist, but it's text-only "กำลังโหลด…"; no skeletons, panel pops in blank-then-full. |
| 2 | Match System / Real World | 3 | Strong Thai, but Thai+English jargon mix (Subscription active, Fallback %, At-risk) — fine for the owner, leaky for anyone else. |
| 3 | User Control and Freedom | 3 | Drawer ✕ + tap-outside, confirm() on grants. No Esc-to-close, no keyboard path. |
| 4 | Consistency and Standards | 2 | `.flip` class drives BOTH a trivial "สลับเป็น gemini" toggle AND high-stakes +30/+90/VIP grant buttons — same weight for wildly different stakes. |
| 5 | Error Prevention | 3 | confirm() before grant + push; push requires selection + message. But grant confirm doesn't name the customer. |
| 6 | Recognition Rather Than Recall | 4 | ⓘ tooltips explain every metric; tabs + labels visible; nothing hidden. |
| 7 | Flexibility and Efficiency | 3 | Bulk push + select-all is a real power feature. No keyboard shortcuts, no range-select. |
| 8 | Aesthetic and Minimalist Design | 2 | Every tab opens with a uniform grid of identical same-size stat cards. No focal point. This IS the "generic SaaS dashboard" anti-reference. |
| 9 | Error Recovery | 2 | If getAdminMonitoring fails, the whole panel stays hidden — blank page + a tiny gray error line, no retry button. |
| 10 | Help and Documentation | 3 | Metric tooltips + finance/growth explainer notes. Good for an internal tool. |
| **Total** | | **28/40** | **Good (low end) — solid IA, undermined by flat-equal hierarchy** |

## Anti-Patterns Verdict

**LLM assessment**: Yes — at a glance this reads "generic SaaS admin," which is precisely PRODUCT.md's #1 anti-reference. The tell is structural: all five tabs (Overview, Retention, System, Finance, Growth) open with a `repeat(auto-fit, minmax(150px,1fr))` grid of interchangeable white cards, each a muted label over a 25px number. That triggers two absolute bans at once — **identical card grids** and the **hero-metric template** — and it directly violates DESIGN.md's own "Premium calm over dashboard noise" and "Flush-List Rule." The emoji tab/section chrome (📊🔁🛠️💰📈) reinforces the "internal tool" read over "premium coach." The bones are good; the surface is the reflex.

**Deterministic scan**: detect.mjs returned 1 finding — `single-font` (warning, line 13). False positive for this register: the product reference explicitly says one well-tuned sans is correct for app UI, and DESIGN.md commits to it as "The Fixed-Scale Rule" family. No action.

**Visual overlays**: not available — the page is gated behind Google admin sign-in with no local dev server, so no injection/overlay was run. Findings are from source + detector review.

## Overall Impression

The information architecture is genuinely strong — the hard-won "every number earns a decision" idea is largely realized (at-risk + expiring lists sit right next to grant/push actions; the drawer is privacy-safe). What lets it down is visual hierarchy: nothing leads. Six equal cards on Overview, four equal cards on every other tab, all the same size and weight, so the eye has no entry point and the "premium" promise never lands. The single biggest opportunity: give each tab ONE hero and demote the rest.

## What's Working

- **Decisions next to data.** At-risk/expiring rows open a drawer with +30/+90/VIP grant + a customer LINE message; the bulk push tool targets exactly those segments. This is the opposite of a vanity dashboard and it's the product's best idea.
- **Right mobile affordance.** Deep detail is a bottom-sheet drawer (thumb zone), not a centered modal — correct for the LINE-webview, mobile-first context.
- **Privacy restraint on-brand.** The drawer shows aggregate engagement only (no meal content, no dashboard link) — "earn trust with restraint" made real.

## Priority Issues

- **[P1] Identical card grids, zero hierarchy.** Every tab leads with a uniform stat-card grid; Revenue, At-risk and Errors all weigh the same, so nothing is the focal point. This is the literal "generic SaaS dashboard / cluttered number-wall" anti-reference. **Fix:** one hero per tab (Overview→revenue or at-risk; System→errors/AI health) given real estate + a trend/sparkline, with the remaining metrics demoted to a compact inline strip. **Command:** `/impeccable layout`.
- **[P1] Action stakes look identical.** A `.flip`-styled "สลับเป็น gemini" toggle and a `.flip`-styled "+90 วัน / 👑 VIP Lifetime" grant (which extends a paid subscription AND messages the customer) are visually the same low-emphasis pill. **Fix:** a clear button tier system (primary / secondary / quiet); make grant actions weightier and name the customer in the confirm dialog. **Command:** `/impeccable layout` (+ `/impeccable clarify` for the confirm copy).
- **[P2] Load failure = blank screen.** On a failed `getAdminMonitoring`, `#panel` stays `hidden`; the operator sees an empty page with one gray line and no way to retry. **Fix:** keep the shell, show an inline error card with a "ลองใหม่" retry button; consider skeletons during load. **Command:** `/impeccable harden`.
- **[P2] Premium feel absent.** Emoji chrome + flat-equal density + 2-up tiny cards on a 360px phone read "tool," not "calm premium coach." **Fix:** restrained icon set over emoji, more whitespace/rhythm, larger type for the one thing that matters. **Command:** `/impeccable polish`.
- **[P2] Keyboard/SR a11y gaps (PRODUCT.md commits to AA).** Tabs are `<div onclick>` (not focusable, no `role="tab"`/`aria-selected`); the drawer modal has no Esc, focus trap, or `aria-modal`; status is encoded by color alone (ok/warn/danger on the same number); the ⓘ tooltip is hover-`::after` — invisible to screen readers AND to touch (the whole app is mobile-first). **Fix:** real focusable tab buttons, Esc + focus management on the drawer, a text/icon status cue beside color, tap/focus-reachable tooltips. **Command:** `/impeccable harden` then `/impeccable audit`.

## Persona Red Flags

**Alex (Power User / the owner):** Tabs aren't keyboard-focusable (`<div>` not button) — no tabbing between sections. No Esc to dismiss the drawer. Bulk push is great, but customer selection is one checkbox at a time (no shift-range). On his phone, the ⓘ metric tooltips never appear (hover-only), so "Fallback %" / "Active subs log" stay cryptic.

**Sam (Accessibility):** Tab strip has no `role="tab"`/`aria-selected` and can't be reached by keyboard. The drawer is a custom modal with no focus trap, `aria-modal`, or labelled title. Metric health is color-only (green/amber/red on the number) — indistinguishable to a colorblind user; add a glyph or word. Hover `::after` tooltips are unreadable by a screen reader.

**Casey (Distracted Mobile, mobile-first product):** Bottom-sheet drawer and overflow-scroll tabs are right for the thumb. But hover-only tooltips are dead on touch — the one place metric meaning lives is unreachable. At 360px the 2-column `minmax(150px)` grid crams labels; long Thai names in at-risk rows risk wrapping awkwardly.

## Minor Observations

- The bulk-push "ส่งข้อความ" button calls `/adminPushToUsers`; confirm that backend endpoint exists, or the primary action silently 404s (Riley would find this immediately).
- `.flip` is now an overloaded class name (AI toggle, grant, custom-days) — naming debt that will bite the next edit.
- Active tab uses color-only emphasis plus weight + underline (good), but inactive tabs at `--muted` on `--bg` are close to the 4.5:1 floor — verify.
- Two greens still exist project-wide (settings `#1db446`); admin is correctly on `#18B98C`. Keep it.

## Questions to Consider

- If each tab could show only ONE number big, which one would the owner want — and could everything else collapse into a single line beneath it?
- The dashboard answers "what's happening." Does it answer "what should I do in the next 5 minutes"? The at-risk/expiring lists do; the card grids don't.
- What would the calm, premium version look like if you deleted half the cards?
