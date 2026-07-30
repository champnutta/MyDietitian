# Product

## Register

product

## Users

Two distinct audiences share one web surface (`apps/liff`, static HTML served by Firebase Hosting, opened mostly inside the LINE in-app browser on a phone):

- **Customers** — Thai individuals managing their diet and weight. They log meals by chatting with the MyDietitian LINE bot, then open the **dashboard** (calories/macros, streak, trends) and **settings** (goal/TDEE setup) as LIFF pages. Context: quick, frequent check-ins on a phone — often standing, right after a meal, in seconds. They are paying subscribers and judge whether the service feels worth keeping.
- **Operator/owner** (`znak.iiz@gmail.com`) — runs MyDietitian as a commercial business. Uses the Google-restricted **admin** panel to watch business health (revenue, retention, reliability) and take retention/sales actions (extend a subscription, grant VIP, see who is about to churn). Works on desktop or phone, in short focused sessions, needing to spot a problem and act on it immediately.

## Product Purpose

A commercial, subscription-based AI nutrition-coaching service delivered through LINE OA. The web surfaces exist to keep subscribers engaged and renewing: the dashboard makes daily progress feel visible and worth returning to; settings makes goal setup feel guided, not bureaucratic. Coaching goes beyond a static daily target — subscribers can run a **guided multi-week program** (trainer-style CUT/Bulk periodization that steps a macro down/up each week), and the bot **proactively checks in over LINE** when a new week begins or a program completes. This is the coach relationship made tangible: the plan progresses on its own and reaches out, rather than waiting to be opened. The admin panel lets the owner read the business at a glance and act — turning monitoring into retention. **Success right now = subscribers who glance their progress, feel encouraged, and renew** (low churn), with an owner who can spot and fix at-risk accounts fast.

## Brand Personality

Premium, warm, encouraging — a trusted personal coach who celebrates progress, not a piece of software. Visually restrained and considered most of the time; the brand green leads, and warmth shows up in copy, micro-moments (streak badges, goal-hit acknowledgments), and the logo's warm orange accent — not in decorative chrome. Confident enough to leave space. Trustworthy with personal health and payment data. Three words: **premium, warm, encouraging.**

## Anti-references

- **Generic SaaS dashboard** — walls of identical icon + heading + number cards, template-shaped, interchangeable with any other tool. The admin panel currently leans this way and should move away from it.
- **Clinical / hospital coldness** — sterile blue-white, sharp grids, lab-report sterility with no humanity. This is a coach, not a clinic.
- **Cluttered number-walls** — data dumped densely with no hierarchy; everything the same weight so nothing reads. Premium means editing down to what matters.
- **Generic LINE chatbot / food-logging app** — bubble UI clichés, calorie-counter aesthetics, neon fitness tropes, or the visual language of free diet trackers. MyDietitian is a paid coach; it should feel more considered than a chat plugin or MyFitnessPal clone.

## Design Principles

1. **Retention through encouragement, not noise.** The dashboard's job is to make subscribers feel progress and want to come back. One clear focal point per screen; celebrate streaks and wins in copy and micro-moments — never by adding more cards or louder chrome. This extends to proactive LINE pushes (new program week, program complete): every unprompted message must be an earned, useful moment — a plan advancing, a milestone reached — never a nag or a re-engagement blast.
2. **Warm precision, not clinical.** Health and money are serious, but the surface should feel like an encouraging coach. Warmth lives in color, copy, and typography — never by tinting the whole thing cold-medical.
3. **Glanceable-first.** The primary entry is a phone inside the LINE webview. The single most important thing on each screen must be legible and understood in one glance, thumb-reachable, before any detail.
4. **Earn trust with restraint.** The product holds personal meal logs, goals, and payments. Show only what a task needs (the admin drawer shows aggregate engagement, never a customer's meal content or dashboard). Data minimization is a feature customers can feel.
5. **Every number earns a decision.** Especially in admin: a metric that doesn't lead to an action is vanity. Surface at-risk customers, expiring subscriptions, and real errors — each next to the action it implies.

## Accessibility & Inclusion

- **WCAG 2.1 AA** — body text ≥ 4.5:1, large/bold text ≥ 3:1; verify tinted-on-near-white combinations rather than assuming.
- **Thai-first typography** — Thai is the primary language; allow for taller line-height and Thai glyph ascenders/descenders, and test real Thai copy (and long names) for overflow at every breakpoint.
- **Mobile-first** — design for the LINE in-app webview on a phone first, then scale up; touch targets ≥ 44px; no hover-only affordances for primary actions.
- **Reduced motion** — every animation needs a `prefers-reduced-motion: reduce` alternative (crossfade or instant).
