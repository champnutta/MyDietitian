# Product

## Register

product

## Users

Two distinct audiences share one web surface (`apps/liff`, static HTML served by Firebase Hosting, opened mostly inside the LINE in-app browser on a phone):

- **Customers** — Thai individuals managing their diet and weight. They log meals by chatting with the MyDietitian LINE bot, then open the **dashboard** (calories/macros, streak, trends) and **settings** (goal/TDEE setup) as LIFF pages. Context: quick, frequent check-ins on a phone — often standing, right after a meal, in seconds. They are paying subscribers and judge whether the service feels worth keeping.
- **Operator/owner** (`znak.iiz@gmail.com`) — runs MyDietitian as a commercial business. Uses the Google-restricted **admin** panel to watch business health (revenue, retention, reliability) and take retention/sales actions (extend a subscription, grant VIP, see who is about to churn). Works on desktop or phone, in short focused sessions, needing to spot a problem and act on it immediately.

## Product Purpose

A commercial, subscription-based AI nutrition-coaching service delivered through LINE OA. The web surfaces make it run as a real business: customer-facing pages keep subscribers engaged and renewing (track progress, set goals); the admin panel lets the owner read the business at a glance and act — turning monitoring into retention. Success = engaged customers who renew (low churn) and an owner who can see and fix what matters fast.

## Brand Personality

Premium, refined, calm — an expert personal coach, not a piece of software. Warm and encouraging in voice (it celebrates a streak, nudges gently), but visually restrained and considered. Confident enough to leave space. Trustworthy with personal health and payment data. Three words: **premium, warm, precise.**

## Anti-references

- **Generic SaaS dashboard** — walls of identical icon + heading + number cards, template-shaped, interchangeable with any other tool. The product currently leans this way and should move away from it.
- **Clinical / hospital coldness** — sterile blue-white, sharp grids, lab-report sterility with no humanity. This is a coach, not a clinic.
- **Cluttered number-walls** — data dumped densely with no hierarchy; everything the same weight so nothing reads. Premium means editing down to what matters.

## Design Principles

1. **Premium calm over dashboard noise.** Space, hierarchy, and restraint carry the "premium" feel — not more cards or more chrome. One clear focal point per screen; secondary data recedes.
2. **Warm precision, not clinical.** Health and money are serious, but the surface should feel like an encouraging coach. Warmth lives in color, copy, and typography — never by tinting the whole thing cold-medical.
3. **Glanceable-first.** The primary entry is a phone inside the LINE webview. The single most important thing on each screen must be legible and understood in one glance, thumb-reachable, before any detail.
4. **Earn trust with restraint.** The product holds personal meal logs, goals, and payments. Show only what a task needs (the admin drawer shows aggregate engagement, never a customer's meal content or dashboard). Data minimization is a feature customers can feel.
5. **Every number earns a decision.** Especially in admin: a metric that doesn't lead to an action is vanity. Surface at-risk customers, expiring subscriptions, and real errors — each next to the action it implies.

## Accessibility & Inclusion

- **WCAG 2.1 AA** — body text ≥ 4.5:1, large/bold text ≥ 3:1; verify tinted-on-near-white combinations rather than assuming.
- **Thai-first typography** — Thai is the primary language; allow for taller line-height and Thai glyph ascenders/descenders, and test real Thai copy (and long names) for overflow at every breakpoint.
- **Mobile-first** — design for the LINE in-app webview on a phone first, then scale up; touch targets ≥ 44px; no hover-only affordances for primary actions.
- **Reduced motion** — every animation needs a `prefers-reduced-motion: reduce` alternative (crossfade or instant).
