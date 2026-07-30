---
target: buildHelpFlexMessage (คู่มือ carousel)
total_score: 29
p0_count: 0
p1_count: 2
timestamp: 2026-07-30T17-53-43Z
slug: services-backend-src-index-ts-buildhelpflexmessage
---
# Critique — buildHelpFlexMessage (คู่มือ carousel)

Assessment-A-led (design review of the Flex JSON builder). Assessment B (detector/browser) N/A: a LINE Flex builder has no browsable markup; detector ran clean on a representative mock only.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Static card; altText carries status |
| 2 | Match System / Real World | 3 | Thai copy strong; English-caps eyebrows on Thai-first surface |
| 3 | User Control & Freedom | 3 | Swipe away / act via buttons |
| 4 | Consistency & Standards | 2 | All-green headers vs Header-Voice Rule; odd glyphs ◎ ⌁ |
| 5 | Error Prevention | 3 | n/a |
| 6 | Recognition vs Recall | 3 | Teaches typed commands; buttons mitigate |
| 7 | Flexibility & Efficiency | 3 | Action buttons are good shortcuts |
| 8 | Aesthetic & Minimalist | 2 | Numbered 01/02/03 scaffolding + heavy green bar each card |
| 9 | Error Recovery | 3 | n/a |
| 10 | Help & Documentation | 4 | Genuinely strong contextual help |
| Total | | 29/40 | Good |

## Anti-Patterns Verdict
Two AI tells: numbered section markers (01·START…04·SUPPORT) and uppercase English eyebrows on a Thai-first surface. Four identical deep-green header bars lean "identical card grid." Detector N/A (Flex JSON, not markup).

## What's Working
- Real contextual help: triggered by คู่มือ, 4-card swipeable walkthrough, each row pairs instruction + one-tap button (heuristic 10 = 4).
- altText exemplary: "📖 คู่มือการใช้งาน MyDietitian".
- Token discipline: pulls from FLEX_CUSTOMER, one green throughout.

## Priority Issues
- [P1] Guide wears heavy brand-green bar on all 4 cards — against Header-Voice Rule; คู่มือ is light/reference voice → white header + green title + 2px green rule. → polish
- [P1] Muted detail text #7A8088 at xs on #F4F8F5 ≈ 3.3:1, below 4.5:1 floor. Darken to ~#55605A/#4B5563. → polish
- [P2] Numbered + English-caps eyebrows read as decoration, not a true sequence; they are four categories. Use Thai category label + optional 1/4 carousel marker. → polish / clarify
- [P2] Fragile glyphs ◎ and ⌁ (card 03) risk tofu/inconsistent rendering; swap for reliable emoji (📊, ✅/📅). → polish
- [P3] Card 03 green primary is ตั้งค่าเป้าหมาย; เปิด Dashboard may be the stronger intended action. Reassign green. → polish

## Persona Red Flags
- Jordan (Thai first-timer): English START/BODY/PROGRESS adds translation; ⌁ may tofu; "พิมพ์ …" is recall-heavy though buttons soften.
- Casey (one-handed LINE webview): swipe + bottom buttons good; low-contrast xs detail hard in daylight.
- Sam (a11y): #7A8088 xs detail is the concrete WCAG miss; icons text-labeled; altText meaningful.

## Questions to Consider
- Do the four cards need numbers, or Thai category names + a 1/4 position marker?
- Should the last (support) card adopt the human-voice treatment, previewing the voices the user meets?
