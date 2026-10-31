# Color upgrade proposal · 31 October 2026

Skill: ui-taste (audit + polish playbooks). Read-only pass; nothing in `client/` changed.

Evidence: token file `client/src/index.css`, grep over `client/src` for every color class, WCAG contrast computed for each token pair (light and dark), existing captures (`captures/design-review-2026-10-23/`, `captures/fr-light-desktop-*`, `captures/ar-dark-phone-*`), fresh headless renders of the sign-in page, and the before/after mock in `captures/color-proposal-2026-10-31/palette-before-after.png`. Signed-in pages were not re-rendered: color tokens have not changed since the 23 October captures except `--input`.

## Verdict

The color system is already disciplined: one teal accent, no raw Tailwind palette classes anywhere, semantic tokens used ~2 000 times. Nothing is broken. What holds it back is **flatness and sameness**: the canvas is almost white, the sidebar is white, teal and green are the same darkness and nearly the same hue, and the warm half of the logo (cream, gold, orange) appears only on the sign-in page. The upgrade is an evolution of the tokens, not a redesign. All proposed values pass WCAG AA.

## Findings, ranked by what the user sees

### 1. No depth between canvas, sidebar and cards

| Pair | Now | Proposed |
| --- | --- | --- |
| card / background (light) | 1.06 : 1 | 1.10 : 1 (cream paper) |
| card / background (dark) | 1.10 : 1 | 1.16 : 1 |
| border / card (light) | 1.30 : 1 | 1.36 : 1, warm-tinted |

Everything reads as white boxes drawn on white. The sidebar is `bg-card` with a hairline, so the colored emblem floats on a grey-white column. Fix: warm the canvas to `hsl(42 24% 95%)` (the logo's cream field, one step down), paint the sidebar with the canvas color instead of card white, and warm the border so it belongs to the paper rather than to a cool grey UI kit. Cards stay pure white and now visibly sit on the page. This is the single biggest visual change for one token edit, and it connects the app to the cream sign-in scene.

### 2. Primary teal and success green compete

Teal `hsl(193 82% 31%)` and success `hsl(150 68% 29%)`: same lightness (1.03 : 1 between them), 43° apart, both low-saturation blue-greens. On the members table the green presence percentages and the teal links/active nav read as one family, so "good result" and "clickable" are not told apart by color. Fix: move success to a grass green `hsl(140 62% 28%)` and pull primary slightly toward the logo lake (`#10bccd` = hue 186) with `hsl(189 84% 29%)`. Dark: `hsl(140 50% 52%)` and `hsl(188 70% 48%)`.

### 3. Warning orange reads as brown

`hsl(28 90% 35%)` is the logo orange darkened until it passes AA, which turns it muddy ("À payer : 7 000 F" on Caisses, the sécurité badge). Text has to stay dark to pass, but the **surfaces** do not: badge and chip backgrounds should use the real logo orange at low lightness-mix, not the dark text color at 15% alpha. Proposed: text `hsl(26 92% 33%)`, surface `hsl(30 95% 92%)`, line `hsl(28 90% 78%)`. Same recipe for success, destructive and info.

### 4. Badge text fails AA on tinted backgrounds (light)

| Badge | Now | Proposed |
| --- | --- | --- |
| success text on `bg-success/12` | 4.42 : 1 | 5.21 : 1 |
| warning text on `bg-warning/15` | 4.29 : 1 | 5.15 : 1 |
| destructive text on `bg-destructive/12` (dark) | 4.41 : 1 | 5.88 : 1 |

These are 12 px labels. Fixed by the dedicated surface tokens above instead of alpha mixing.

### 5. Alpha mixing has become the de-facto palette

Grep counts: `bg-accent/40` 42×, `bg-muted/40` 21×, `/30` 18×, `bg-destructive/10` 16×, `bg-primary/10` 11×, `bg-success/12` 10×, plus `/5 /8 /12 /15 /25 /35` variants, about 30 distinct alpha steps in all. Each one is a slightly different color computed per surface, which is why soft surfaces never quite match between pages. Proposed: add eight surface tokens (`--success-soft/-line`, `--warning-soft/-line`, `--destructive-soft/-line`, `--info-soft/-line`) and `--primary-soft`, and keep alpha only for `muted/accent` hover states. The Badge, StatTile icon chip, dashboard to-do chips and the Caisses "À payer" row are the first callers.

### 6. Hardcoded greens outside the system

WhatsApp `#25D366` appears 14× (`DuesArrears`, `Followup`, `MemberDues`, `MemberParts`) and a second green `#1a7f45` / `#166b3a` 8× in `MemberForms.jsx` as a send button. Two unrelated greens next to the semantic success green. Proposed: one `--whatsapp: #25D366` token for the icon, and the send button becomes a normal `Button` (primary teal) with the WhatsApp icon. Brand color stays on the glyph, not on a full button surface.

### 7. Dark mode is neutral charcoal, not the night scene

Light mode's sign-in scene is cream; dark mode's is plum (`--scene-sky #1b1124`), but the app itself is `hsl(220 12% 7%)` blue-grey. A barely-there plum cast on the dark canvas (`hsl(260 10% 7%)`) and sidebar would tie the two the same way the cream ties light mode. Optional; shown in the mock as the smaller step (card lifted to 13%, border to 23%).

### Checked and fine

Foreground 16 : 1, muted-foreground 5.2 : 1 on card and 4.9 : 1 on canvas, primary text 5.4 : 1, white on primary button 5.2 : 1, accent pair 7.7 : 1, active nav 9.7 : 1, input boundary 3.4 : 1 (fixed 23 October). Info plum is used only 6× and reads well. Dark mode body pairs are all 6 : 1 or better. The share bars and presence sparklines being single-hue teal on grey is correct; do not add chart colors.

## Proposed token diff (`client/src/index.css`)

```css
:root, .print-light {
  --background: hsl(42 30% 94%);        /* was hsl(45 12% 97%) — cream paper */
  --sidebar: var(--background);         /* new; Layout sidebar uses bg-sidebar instead of bg-card */
  --border: hsl(40 14% 86%);            /* was hsl(220 12% 89%) — warm hairline */
  --secondary: hsl(40 18% 90%);         /* was hsl(220 12% 95%) — active nav on cream */
  --muted-foreground: hsl(220 8% 42%);  /* was 44% — keeps 5:1 on the darker canvas */

  --primary: hsl(189 84% 29%);          /* was hsl(193 82% 31%) — toward the logo lake */
  --primary-hover: hsl(189 88% 23%);
  --ring: hsl(189 84% 34%);
  --primary-soft: hsl(189 50% 93%);     /* replaces bg-primary/10 chips */

  --success: hsl(140 62% 28%);          /* was hsl(150 68% 29%) — grass, not teal */
  --success-soft: hsl(140 50% 93%);
  --success-line: hsl(140 40% 80%);
  --warning: hsl(26 92% 33%);
  --warning-soft: hsl(30 95% 92%);      /* logo orange as surface, dark text on top */
  --warning-line: hsl(28 90% 78%);
  --destructive: hsl(0 72% 42%);
  --destructive-soft: hsl(0 80% 95%);
  --destructive-line: hsl(0 70% 84%);
  --info-soft: hsl(280 30% 94%);
  --info-line: hsl(280 25% 82%);
  --whatsapp: #25d366;
}

.dark {
  --card: hsl(220 10% 13%);             /* was 11% — one visible step above the canvas */
  --sidebar: hsl(220 12% 9%);
  --border: hsl(220 8% 23%);            /* was 20% */
  --secondary: hsl(220 8% 19%);
  --primary: hsl(188 70% 48%);
  --primary-hover: hsl(188 76% 56%);
  --primary-soft: hsl(188 30% 17%);
  --success: hsl(140 50% 52%);
  --success-soft: hsl(140 30% 16%);
  --success-line: hsl(140 30% 26%);
  --warning: hsl(36 90% 62%);
  --warning-soft: hsl(36 40% 16%);
  --warning-line: hsl(36 40% 28%);
  --destructive: hsl(0 80% 72%);        /* was 64% — badge text passes 4.5:1 */
  --destructive-soft: hsl(0 35% 17%);
  --destructive-line: hsl(0 35% 28%);
  --info: hsl(280 34% 72%);
  --info-soft: hsl(280 25% 18%);
  --info-line: hsl(280 25% 30%);
}
```

Then in `@theme inline` expose `--color-sidebar`, `--color-primary-soft`, `--color-*-soft`, `--color-*-line`, `--color-whatsapp`; update `index.html` `theme-color` to `#f4f0e6` / `#101214`; and swap the Badge variants in `ui.jsx:882-887` from `bg-success/12 … border-success/25` to `bg-success-soft … border-success-line` (same for warning, destructive, info). `bg-brand-soft` utility becomes `background-color: var(--primary-soft)`.

Verified contrast of the proposal (WCAG, computed): light muted-fg/canvas 5.05, primary/card 5.34, white/primary 5.15, every badge 5.1 to 5.6; dark muted-fg/card 6.3, primary/card 6.95, badges 5.8 to 7.2.

## Scope of the work

- Token edit + `@theme` block: one file, 30 minutes.
- Badge/StatTile/chip callers onto surface tokens: `ui.jsx` + 4 to 6 pages, mechanical.
- Sidebar surface: `Layout.jsx` desktop column and phone header.
- WhatsApp token: 5 components.
- Re-render the 14 capture pages light/dark to confirm, then the PDF print theme (`.print-light` shares the light tokens, so the cream canvas must not leak into printed pages; the print root should stay on `--card`).

## Not proposed

- Per-فرقة colors (one hue per branch on chips and avatars). It would add real scanning value on the members list and the Caisses tiles, but the canonical branch colors are the group's decision, not a design guess. Worth a separate conversation.
- A full warm "field ledger" redesign (gold celebration token, plum headings) from the 14 August audit. The current single-accent system is stronger than that proposal; the cream canvas above takes its one good idea.
- Chart palettes. Single-hue teal data is right for this product.
