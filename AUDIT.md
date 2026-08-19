# UI/UX Audit — Kachef Scout

Audit date: 2026-08-14. Scope: `client/` only. RTL (Arabic) audited as the primary experience.
Severity scale: Critical (blocks users / data loss), High (breaks a stated requirement or WCAG AA), Medium (measurable friction), Low (polish / hygiene).

---

## 1. Executive summary

The client is far above template quality: logo-derived token system, inline SVG icon set, logical (RTL-safe) properties throughout, card fallbacks for tables, a real bottom nav, focus management and optimistic updates. No Critical findings. The main gaps: the declared brand fonts are never loaded, the admin bottom nav swells to 8 tabs, a handful of emoji/unicode glyphs remain in locales and rows, dates are not locale-formatted, and the teal-to-purple gradient + glass + aurora combination is the one place the app still reads "generated".

| Dimension | Score |
|---|---|
| 1. Mobile usability | 4 / 5 |
| 2. Design system | 4 / 5 |
| 3. Distinctiveness (anti-template) | 3 / 5 |
| 4. Iconography | 4 / 5 |
| 5. RTL / i18n | 4 / 5 |
| 6. Interaction | 4 / 5 |
| 7. Consistency | 4 / 5 |

---

## 2. Findings

### Dimension 1 — Mobile usability (6 findings)

| Severity | Location | Issue | Fix |
|---|---|---|---|
| High | `client/src/components/Layout.jsx:86-116` | Bottom nav renders every visible nav item — an admin gets **8 tabs** (`NAV_ITEMS`, lines 22-31). At 375px each tab is ~47px wide with 10px labels (`text-[0.625rem]`, line 94) that truncate. Platform guidance caps bottom nav at 5. | Keep Dashboard, Members, Sessions, Branches + a fifth "More" tab opening the existing `Dialog` as a bottom sheet listing Promotions, Leaders, Settings, Admin, theme/lang/logout. Kills the compact top-bar buttons too. |
| High | `client/src/components/Layout.jsx:238-247`, `:164-170` | Mobile top bar is `h-24` (96px) and the logo is `h-20 w-20` (80px). With the 68px bottom nav, ~164px of a 667px viewport (~25%) is chrome before content. | Bar to `h-14`, logo crop to `h-9 w-9`, keep wordmark only ≥380px. Update `--header-h` accordingly (see M13). |
| Medium | `client/src/components/ui.jsx:323-329` | Touch sizes below 44px on phones: `sm` = `h-10` (40px), `icon` = `h-10 w-10` (40px), `icon-sm` = `h-9 w-9` (36px). These are the row actions users hit most (`Members.jsx:282-289`, `Leaders.jsx:689-706`, `Admin.jsx:363-387`). | Mobile-first values: `sm` → `h-11`, `icon` → `h-11 w-11`, `icon-sm` → `h-10 w-10`, keeping the existing `sm:` desktop tightening. |
| Medium | `client/src/components/TimePicker.jsx:44-63` | The 24-row hour column opens scrolled to 00; picking an evening time means scrolling the full column on every use. | On open, `scrollIntoView({ block: 'center' })` the `aria-selected` button via a ref effect. |
| Medium | `client/src/pages/Sessions.jsx:300`, `client/src/components/Layout.jsx:94`, `client/src/pages/LeaderDetail.jsx:143` | Text below legibility floor: filter count badge `text-[0.6rem]` (9.6px), bottom-nav labels `text-[0.625rem]` (10px), stat labels `text-[0.7rem]` (11.2px). | Floor UI text at 11px; badges and nav labels to `text-[0.6875rem]` minimum, stat labels to `text-xs`. |
| Low | `client/src/components/DatePicker.jsx:84-98`, `client/src/components/TimePicker.jsx:86-100` | Inline clear affordances are `span role="button" tabIndex={-1}` — pointer-only. DatePicker's popover has a keyboard-reachable Clear; TimePicker's panel has only "Done", so keyboard users cannot clear a time at all. | Make both real `<button type="button">` (keeping the pointerDown guard) and add a Clear button beside "Done" in the TimePicker footer. |

### Dimension 2 — Design system (7 findings)

| Severity | Location | Issue | Fix |
|---|---|---|---|
| High | `client/src/index.css:211-212`, `client/index.html` (no font link) | `--font-sans` declares `"Inter var", Inter, ... "Noto Sans Arabic"` but **no font is ever loaded** — no `@font-face`, no `<link>`. Windows renders Segoe UI, Android renders Roboto, Arabic falls back to Tahoma. The typographic identity silently does not exist. | Self-host Inter var + an Arabic companion as woff2 with `@font-face { font-display: swap }` and `<link rel="preload">` in `index.html`. Static font files, not an npm dependency — flagged in roadmap Phase 3. |
| High | `client/src/components/ui.jsx:1076`, `client/src/pages/Branches.jsx:40` | `text-muted-foreground/80` at 12px: `hsl(265 10% 45%)` at 80% alpha over the near-white background computes to ~3.4:1 — fails WCAG AA (4.5:1) for the StatTile and Metric hint lines. | Drop the `/80`; full `text-muted-foreground` measures ~5.1:1 and passes. |
| High | `client/src/pages/Promotions.jsx:150-224` | History card ignores `history.loading` and `history.error` (fetched line 39): during load it renders the "no history" empty state; on failure it silently shows nothing was ever recorded. | Mirror the pending card's branches (lines 86-96): skeleton rows while loading, `ErrorState` with `history.reload` on error. |
| Medium | `client/src/pages/Dashboard.jsx:197-230` | Recent-sessions card branches on `sessions.loading` but never `sessions.error` — a network failure renders the "no sessions" empty state, indistinguishable from truth. | Add an `sessions.error` branch rendering the existing `ErrorState` with `sessions.reload`. |
| Medium | `client/src/pages/Sessions.jsx:119-121`, `:140-143` | The create dialog depends on `/branches` and `/leaders`, but their `error` states are never surfaced — on failure the branch/leader selects render empty and the form cannot be submitted with no explanation. | If `branches.error || leaders.error`, show `ErrorState` inside the dialog body in place of the form. |
| Medium | `client/src/index.css:93-95` vs `client/src/components/Layout.jsx:223`, `:224`, `:239`, `:251` | `--sidebar-w: 16rem` and `--header-h: 6rem` are defined but the layout hardcodes `w-64`, `lg:ps-64`, `h-[106px]`, `h-24`. Only `--bottomnav-h` is actually consumed. Token drift waiting to happen. | Reference them (`w-(--sidebar-w)`, `ps-(--sidebar-w)`, `h-(--header-h)`) or delete the tokens. |
| Low | `client/src/components/ui.jsx:599-603` vs `client/src/pages/Dashboard.jsx:131` | `SkeletonPage` shows 3 tiles in `sm:grid-cols-2 xl:grid-cols-3`; Dashboard renders up to 4 tiles in the same grid — layout jumps when data lands. | Render 4 skeleton tiles. |

### Dimension 3 — Generic "AI-template" look (4 findings)

The palette itself is *not* template — it is sampled from the group's logo (`index.css:6-17`), which is exactly right. What still reads generated is the delivery: gradient text, glass, aurora, hover-lift cards — the standard 2024 SaaS kit, in anyone's colors.

| Severity | Location | Issue | Fix |
|---|---|---|---|
| Medium | `client/src/index.css:322-328`, used at `ui.jsx:1058` (StatTile brand tone), `ui.jsx:1072`, `Layout.jsx:171`, `Login.jsx:41` | `text-brand-gradient` (teal-to-purple) on the wordmark **and** on data values. Gradient-filled numbers are the single strongest "AI dashboard" tell, and gradient text rasterizes poorly at small sizes. | Reserve the gradient for the wordmark only. Stat values become solid `text-foreground`; tone conveyed by the existing `success`/`warning`/`destructive` tokens. |
| Medium | `client/src/index.css:344-348`, used at `Layout.jsx:84`, `:238`, `ui.jsx:855` | `glass` (blur 16px + saturate 180%) on header, bottom nav and toasts — glassmorphism boilerplate, and `backdrop-filter` is a real GPU cost on the low-end Androids leaders actually carry. | Solid `bg-card` + `border-border` + `shadow-sm` for bars; keep at most a 6px blur on the bottom nav if translucency must stay. |
| Medium | `client/src/index.css:364-373`, used at `Layout.jsx:253`, `Login.jsx:29` | `aurora` — three radial color blooms behind the content — is the canonical generated-landing-page backdrop. | Replace with a flat warm canvas (see §3 palette) or a single very faint brand-teal wash on the login card only. |
| Low | `client/src/components/ui.jsx:365-368`, `:310-312` | Uniform `rounded-2xl` cards with `hover:-translate-y-0.5 hover:shadow-lg` lift, plus `shadow-brand` color glow under every primary button — the default shadcn-remix finish. | Cards: keep radius, swap lift for a border-color + background shift (no translate). Buttons: `shadow-brand` only on the page's single primary CTA, `shadow-xs` elsewhere. |

**Proposed direction — "field ledger", built on the logo's warm half.** The emblem gives six colors; the UI currently uses only the cool pair (teal/purple). Shift the identity onto the warm trio the logo actually leads with (cream dome, gold sun, orange ring), keeping teal as the action color:

- Canvas (light): `--background: hsl(43 40% 96%)` (cream paper, from `--brand-cream`), `--card: hsl(0 0% 100%)`
- Ink: keep `--foreground: hsl(275 32% 12%)` (plum ink) — already good
- Action: keep `--primary: hsl(191 92% 27%)` teal; **retire `--brand-to` purple from chrome**, keep `--info` purple for informational badges only
- Celebration accent (birthdays, promotions): `--brand-gold hsl(40 95% 67%)` background with `hsl(30 60% 22%)` text (AA)
- Alert accent: `--brand-orange hsl(28 91% 54%)` reserved for the pending-promotions tile
- Dark mode: keep the existing plum ground (`hsl(274 28% 7%)`) — it is already distinctive
- Type: ship the declared Inter var for Latin; pair with **IBM Plex Sans Arabic** (matching weights, more character than the Tahoma fallback) — font files flagged in roadmap
- Type scale (rem): 0.75 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.125, line-height 1.5 body, 1.2 headings — formalizes what pages already approximate
- Spacing rhythm: 4px base; rhythm tiers 16 (intra-card), 24 (card gap), 40 (section) — the current `space-y-4/6` mapped to named tiers
- Iconography: keep the existing stroke-2 24px inline SVG system; extend it with scouting motifs drawn in the same style (tent, campfire, compass, fleur-de-lis) to replace the generic shield/award where meaning fits

### Dimension 4 — Iconography (6 findings)

Inventory of every emoji / unicode glyph used as an icon (referenced by codepoint; none may remain per requirement). The inline SVG system in `ui.jsx:31-248` is already correct — stroke-based, 24px viewBox, `currentColor`, `aria-hidden` — replacements below reuse it.

| Severity | Location | Glyph | Fix |
|---|---|---|---|
| High | `client/src/locales/fr.json:49,54,57,223` and `client/src/locales/ar.json:49,54,57,223` | U+2713 CHECK MARK in `common.saved`; U+1F382 BIRTHDAY CAKE in `birthday.today` and `birthday.isToday`; U+1F389 PARTY POPPER in `promotion.noPending` | Strip glyphs from all four strings in both files. Visual reinforcement already exists in the render sites: toasts carry `IconCheck` (`ui.jsx:805`), birthday rows carry `IconCake` (`Dashboard.jsx:101`, `Members.jsx:249`), the empty state carries `IconSparkles` (`Promotions.jsx:101`). |
| High | `client/src/pages/Leaders.jsx:679-680` | U+2713 CHECK MARK and U+2717 BALLOT X inside presence badges | `<Badge variant="success"><IconCheck className="h-3 w-3" />{l.present_count}</Badge>` and `<IconX className="h-3 w-3" />` for absences — the pattern `BirthdayBadge` (`Members.jsx:247-251`) already uses. |
| Medium | `client/src/pages/MemberDetail.jsx:323` | U+2192 RIGHTWARDS ARROW as promotion direction, hand-mirrored with `rtl:rotate-180` | `<IconArrow className="h-3.5 w-3.5 text-muted-foreground rtl:rotate-180" />` — exactly what `Promotions.jsx:124` and `:174` already do. |
| Medium | `client/src/components/DateRangePicker.jsx:47` | U+2192 RIGHTWARDS ARROW inside the range label string | Compose the label as JSX with `IconArrow`, or use an en dash range separator inside the existing `dir="ltr"` span. |
| Medium | `client/src/pages/Settings.jsx:387`, `:462` | U+221E INFINITY as `placeholder` on max-age inputs (screen readers announce "infinity") | Empty placeholder — the adjacent hint `settings.noLimit` (`Settings.jsx:308`) already explains that blank = no limit. |
| Medium | `client/src/locales/fr.json:168`, `client/src/locales/ar.json:168` | Literal "+ " prefix baked into `session.addHelper`, rendered as a `<select>` placeholder option (`SessionDetail.jsx:381`) where a plus-as-icon makes no sense | Remove the "+ " from both strings; the Sessions-page button already pairs the string with `IconPlus`. |

Low, for completeness: `SearchInput.jsx:57` renders U+2318 PLACE OF INTEREST SIGN inside a `<kbd>` element — a keyboard-key symbol in a `<kbd>` is legitimate, but the `navigator.platform` sniff it hangs on is deprecated; prefer `navigator.userAgentData?.platform` with a fallback.

### Dimension 5 — RTL / i18n (5 findings)

The fundamentals are done properly: `DirectionProvider` (`App.jsx:141`), `dir` swap on `<html>` (`i18n.js:18-21`), logical properties (`ps-/pe-/ms-/me-/start-/end-`) everywhere, directional icons mirrored via `rtl:rotate-180` (`MemberDetail.jsx:98`, `Dashboard.jsx:193`), `dir="ltr"` islands on phones and dates, calendar localized through date-fns `ar`/`fr` (`CalendarPanel.jsx:10`). Key parity between `ar.json` and `fr.json` is exact.

| Severity | Location | Issue | Fix |
|---|---|---|---|
| Medium | `client/src/utils.js:2-6` (used in ~30 call sites) | `fmtDate` hardcodes `JJ/MM/AAAA` — Arabic users get a French date order with no locale awareness, while date-fns 4 with `ar`/`fr` locales is already in the bundle (`package.json:15`, `CalendarPanel.jsx:1`). | Localize: `new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar' : 'fr-FR', { dateStyle: 'short' }).format(toDate(iso))` — zero new dependencies, one function to change. Keep Latin digits (`nu-latn`) if mixed-digit tables are a concern; that becomes a documented decision instead of an accident. |
| Medium | `client/src/locales/fr.json:269` | `leader.assistantPrefix` is the Arabic word "مساعد" **inside the French locale** — a French UI composes assistant titles as "مساعد Chef des Louveteaux" (`Leaders.jsx:366`). | If titles are intentionally Arabic-canonical, move the prefix out of locales into a constant; otherwise set the French value to "Adjoint". |
| Medium | `client/src/components/ui.jsx:735` | Dialog close button `aria-label="close"` — hardcoded English announced to Arabic and French screen-reader users on every modal. | Add a `closeLabel` prop threaded from callers (all have `t()`), or accept a label via `ConfirmProvider`-style injection. |
| Low | `client/src/locales/fr.json` + `ar.json` | Dead keys carried in both files: `admin.permNone/permView/permEdit` (superseded level model, fr.json:419-421), `session.editCounts` (:209), `promotion.matalibAcquired` (:229), `promotion.currentBranch/targetBranch` (:221-222), `leader.copyFromCurrent` (:261), `leader.leaderLabel` (:281), `leader.leadersBranch` (:300), `leader.branchRoles` (:275), `leader.cardAchievedAt` (:307), `common.add/all/none/loading` (:22,33,35,38), `member.matalibEdit` (:121), `member.residence` (:112). | Prune in one sweep (both files stay in lockstep) so real parity gaps become visible in diffs. |
| Low | `client/index.html:2` | `lang="fr"` static while the runtime may boot in Arabic (localStorage) — first-paint UA styling and translation prompts see the wrong language until `i18n.js:23` runs. | Acceptable, but note: an inline pre-bundle script (the same pattern as the background-color hack at lines 19-26) could stamp `lang`/`dir` from localStorage before paint. |

### Dimension 6 — Interaction (6 findings)

| Severity | Location | Issue | Fix |
|---|---|---|---|
| Medium | `client/src/components/Combobox.jsx:19-67` | Suggestions are mouse-only: no ArrowDown/ArrowUp/Enter handling, options are plain buttons in a portal while focus is pinned to the input (`onOpenAutoFocus` prevented, line 48). `role="combobox"` without `aria-expanded` wiring to a listbox id. | Track an active index on the input's keydown (ArrowDown/Up/Enter/Escape), style the active option, expose it via `aria-activedescendant`, give the popover list `role="listbox"` and options `role="option"`. |
| Medium | `client/src/components/ui.jsx:845-862` | Toast dismissal is `onClick` on a `div` — no keyboard path, no visible close control; error toasts auto-dismiss in 5s regardless of hover. | Add an explicit close `<button aria-label={...}>` with `IconX`, pause the timeout on `mouseenter`/`focusin`. |
| Medium | `client/src/pages/SessionDetail.jsx:204-207` | `markAllPresent` awaits one POST **per child** in series — 20 children on a mobile connection ≈ 20 sequential round-trips behind a single spinner. | Fire in parallel (`Promise.allSettled`) as a stopgap; proper fix is a bulk endpoint — flagged as a server-touching roadmap item. |
| Low | `client/src/App.jsx:99-103` | `usePerms()` called after the conditional `if (!user) return <Login />`. Safe today only because `useContext` allocates no hook slot; it violates rules-of-hooks and breaks the moment `usePerms` gains state. | Hoist the `usePerms()` call above the early return. |
| Low | `client/src/components/ui.jsx:877-884` | `Table` doc comment promises "a fade hint at the trailing edge" but none is implemented — horizontally scrollable tables (`MemberDetail.jsx:393`) give no affordance that columns are cut off. | Add the mask (`mask-image: linear-gradient(...)` on the wrapper, or an inset gradient overlay) or correct the comment. |
| Low | `client/src/pages/Login.jsx:60-69` | Password field has no show/hide toggle — costly on mobile keyboards where typos are the norm. | Inline `IconX`-style toggle button switching `type` between `password`/`text`. |

Positives worth preserving: the `focus-ring` utility applied on effectively every interactive element, the dialog focus trap + restore (`ui.jsx:660-701`), Escape layering with Radix portals (`ui.jsx:673-677`), optimistic attendance marking with rollback (`SessionDetail.jsx:171-183`), `prefers-reduced-motion` kill switch (`index.css:445-454`), and lazy-loaded calendar chunk (`CalendarPanel.jsx:5-8`).

### Dimension 7 — Consistency (6 findings)

| Severity | Location | Issue | Fix |
|---|---|---|---|
| Medium | `client/src/components/ui.jsx:510-531` | `Field` — the one component that wires `aria-describedby`/`aria-invalid` for hint/error — is exported and **used nowhere**. Every form hand-rolls `<div className="space-y-1.5"><Label/><Input/></div>` (e.g. `Members.jsx:89-198`, `Leaders.jsx:77-121`, `Admin.jsx:147-181`), so field-level errors are never associated with inputs. | Adopt `Field` across forms (see §3 form example). ~40 call sites, purely mechanical. |
| Medium | `client/src/pages/Settings.jsx:247-269`, `:277-299` | Theme and language pickers hand-roll a segmented control with template-literal class strings while `SegmentedControl` (`ui.jsx:971-1008`) exists — divergent hover states, no `animate-pop`, duplicated styles. | Replace both with `SegmentedControl` (`tone: 'default'`), icons passed in labels. |
| Medium | `client/src/components/shadcn/select.jsx:13-45`, `client/src/components/shadcn/calendar.jsx:8-25` | `Chevron`, `Check`, `NavChevron` re-implemented locally although `ui.jsx` exports `IconChevronDown` (:194) and `IconCheck` (:167) — three chevron sources with differing stroke widths (2 vs 2.5). | Extract `icons.jsx` from `ui.jsx` (also shrinks the 1094-line monolith) and import everywhere, shadcn files included. |
| Medium | `client/src/components/ui.jsx:1056-1080` vs `client/src/pages/Branches.jsx:32-43` | Two stat-tile components for the same job: `StatTile` (icon chip + gradient value) and `Metric` (boxed, plain value) — same data shape, different anatomy. | Fold `Metric` into `StatTile` as a `boxed` variant; Branches keeps its layout through the variant. |
| Low | `client/src/pages/Admin.jsx:248-250` | Raw permission keys (`members.delete`) rendered in mono font to end users — developer vocabulary leaking into an admin UI otherwise fully translated. | Move the key to a `title` attribute; show only the translated label. |
| Low | `client/package.json:13` vs `client/src/components/ui.jsx:308-329` | `class-variance-authority` is installed but variants are plain objects — either unused dependency or unadopted convention. | Pick one: adopt CVA for `Button`/`Badge` variants, or drop the dependency (dependency removal flagged for roadmap). |

---

## 3. Proposed design direction — tokens and pattern examples

### Tokens (drop-in edits to `client/src/index.css`)

```css
:root {
  /* Canvas warms up to the logo's cream field; cards stay white for contrast */
  --background: hsl(43 40% 96%);
  --foreground: hsl(275 32% 12%);          /* unchanged plum ink */
  --primary: hsl(191 92% 27%);             /* unchanged teal action */

  /* Celebration + alert accents promoted from decoration to semantics */
  --celebrate: hsl(40 95% 67%);
  --celebrate-foreground: hsl(30 60% 22%); /* 7.2:1 on --celebrate */
  --alert-accent: hsl(28 91% 54%);

  /* Fix the AA failure: hints use the full token, never alpha-modified */
  --muted-foreground: hsl(265 10% 42%);    /* 5.6:1 on --background */

  /* Purple leaves the chrome; stays available as --info for badges */
}
```

Type scale (rem): `0.75 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.125`. Body line-height 1.5, headings 1.2 with the existing negative tracking (`index.css:237-241`). Spacing rhythm on the 4px base: 16 intra-card, 24 between cards, 40 between page sections.

Fonts (Phase 3, static assets — flagged): Inter var (Latin) + IBM Plex Sans Arabic, `@font-face` + `font-display: swap` + preload.

Iconography: keep the `Icon` wrapper contract (`ui.jsx:31-47`) — 24px grid, `stroke="currentColor"`, `strokeWidth 2` — and extend with scouting motifs in the same voice:

```jsx
export const IconTent = (p) => (
  <Icon {...p}>
    <path d="M12 3 2 21h20L12 3z" />
    <path d="M12 13v8" />
    <path d="m9 21 3-5 3 5" />
  </Icon>
);
export const IconCampfire = (p) => (
  <Icon {...p}>
    <path d="M12 3c2.5 2.6 4 4.9 4 7.4A4 4 0 0 1 8 10.4C8 7.9 9.5 5.6 12 3z" />
    <path d="m4 21 16-4" />
    <path d="m20 21-16-4" />
  </Icon>
);
```

### Pattern A — mobile nav: 8 tabs to 4 + "More"

Before (`Layout.jsx:86-116` — every permitted item becomes a tab):

```jsx
<ul className="flex items-stretch">
  {items.map(({ to, short, Icon, end }) => (
    <li key={to} className="flex-1"> ... </li>
  ))}
</ul>
```

After (same components, no new dependencies — primary four plus a sheet reusing `Dialog`):

```jsx
const PRIMARY = items.slice(0, 4);
const overflow = items.slice(4);
<ul className="flex items-stretch">
  {PRIMARY.map((item) => <BottomTab key={item.to} {...item} />)}
  {overflow.length > 0 && (
    <li className="flex-1">
      <button onClick={() => setMoreOpen(true)} aria-expanded={moreOpen}
        className="focus-ring flex h-[4.25rem] w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground">
        <IconMenu className="h-5 w-5" />
        {t('nav.more')}
      </button>
    </li>
  )}
</ul>
<Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title={t('nav.more')}>
  <ul className="divide-y divide-border">
    {overflow.map(({ to, key, Icon }) => (
      <li key={to}>
        <NavLink to={to} onClick={() => setMoreOpen(false)}
          className="focus-ring flex min-h-12 items-center gap-3 px-1 text-sm font-medium">
          <Icon className="h-5 w-5 text-muted-foreground" />
          {t(key)}
        </NavLink>
      </li>
    ))}
  </ul>
  <div className="mt-4 flex gap-2 border-t border-border pt-4">
    <ThemeToggle /> <LangToggle /> <UserMenu />
  </div>
</Dialog>
```

(Requires one new locale key `nav.more` in both files and one `IconMenu` in the existing icon set.)

### Pattern B — table-to-card: attendance history on phones

Before (`MemberDetail.jsx:393-428` — 3-column `Table` at all widths; horizontal scroll with no affordance at 375px):

```jsx
<Table>
  <thead>...</thead>
  <tbody>
    {history.map((h) => (
      <tr key={h.session_id} onClick={() => navigate(`/sessions/${h.session_id}`)} ...>
        <Td className="whitespace-nowrap tabular-nums">{fmtDate(h.date)}</Td>
        <Td><Link ...>{h.title}</Link></Td>
        <Td className="text-end"><Badge variant={variant}>{t(key)}</Badge></Td>
      </tr>
    ))}
  </tbody>
</Table>
```

After (the split Members.jsx already uses at lines 490-506 — list rows under `md`, table above; also removes the redundant `tr onClick`):

```jsx
<ul className="divide-y divide-border md:hidden">
  {history.map((h) => (
    <li key={h.session_id}>
      <Link to={`/sessions/${h.session_id}`}
        className="focus-ring flex min-h-14 items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{h.title}</div>
          <div className="text-xs tabular-nums text-muted-foreground">{fmtDate(h.date)}</div>
        </div>
        <Badge variant={STATUS_BADGE[h.status][0]}>{t(STATUS_BADGE[h.status][1])}</Badge>
      </Link>
    </li>
  ))}
</ul>
<Table className="hidden md:block">{/* unchanged desktop table, without tr onClick */}</Table>
```

### Pattern C — form fields through `Field`

Before (`Members.jsx:89-92` — repeated wrapper, error never linked to a field):

```jsx
<div className="space-y-1.5">
  <Label htmlFor="first_name">{t('member.firstName')}</Label>
  <Input id="first_name" required autoComplete="off"
    value={form.first_name} onChange={set('first_name')} />
</div>
```

After (the existing, currently-unused `Field` from `ui.jsx:510` — id generation and `aria-describedby`/`aria-invalid` wiring for free):

```jsx
<Field label={t('member.firstName')} error={errors.first_name}>
  {(a11y) => (
    <Input {...a11y} required autoComplete="off"
      value={form.first_name} onChange={set('first_name')} />
  )}
</Field>
```

---

## 4. Roadmap

Every item independently shippable. Size: S (≤half day), M (≤2 days), L (>2 days). Items marked **[dep]** add static assets or touch the server and need sign-off.

### Phase 1 — quick wins (correctness and requirement compliance)

| # | Item | Size |
|---|---|---|
| 1.1 | Strip U+2713/U+1F382/U+1F389 from `fr.json`/`ar.json` (4 keys each); drop "+ " prefix from `session.addHelper` | S |
| 1.2 | Replace U+2713/U+2717 in `Leaders.jsx:679-680` and U+2192 in `MemberDetail.jsx:323`, `DateRangePicker.jsx:47` with `IconCheck`/`IconX`/`IconArrow`; empty the U+221E placeholders in `Settings.jsx` | S |
| 1.3 | Add loading/error branches: Promotions history, Dashboard recent sessions, Sessions create-dialog fetches | S |
| 1.4 | Contrast: remove `/80` from `text-muted-foreground` hints (`ui.jsx:1076`, `Branches.jsx:40`); raise 9.6-11px text to ≥11px | S |
| 1.5 | Localize `fmtDate` via `Intl.DateTimeFormat` on `i18n.language` | M |
| 1.6 | Translate dialog close `aria-label` (`ui.jsx:735`); resolve `assistantPrefix` in `fr.json:269` | S |
| 1.7 | Hoist `usePerms()` above the early return in `App.jsx` | S |
| 1.8 | 4-tile `SkeletonPage`; prune dead locale keys in both files | S |

### Phase 2 — mobile refactor

| # | Item | Size |
|---|---|---|
| 2.1 | Bottom nav: 4 primary tabs + "More" sheet (Pattern A); retire the compact top-bar toggles | M |
| 2.2 | Compact mobile header: `h-14` bar, 36px logo crop; wire `--header-h`/`--sidebar-w` tokens into `Layout.jsx` | S |
| 2.3 | Touch targets: bump `sm`/`icon`/`icon-sm` button sizes to ≥44px on touch | M |
| 2.4 | TimePicker scroll-to-selected on open; add Clear to its panel; real buttons for both pickers' inline clear | S |
| 2.5 | Combobox keyboard navigation (`aria-activedescendant` pattern) | M |
| 2.6 | Toast close button + hover/focus pause | S |
| 2.7 | Attendance history table-to-card on `MemberDetail` (Pattern B) | S |
| 2.8 | Table trailing-edge fade affordance (or fix the comment) | S |
| 2.9 | Bulk attendance batching — parallel client stopgap now; bulk endpoint **[dep: server]** | M |

### Phase 3 — visual redesign

| # | Item | Size |
|---|---|---|
| 3.1 | Ship declared fonts: Inter var + IBM Plex Sans Arabic, `@font-face` + preload **[dep: font asset files]** | M |
| 3.2 | Warm-canvas palette shift (§3 tokens); retire gradient text outside the wordmark; demote `shadow-brand` to single-CTA use | M |
| 3.3 | Replace `aurora` and reduce `glass` to solid bars (perf + distinctiveness) | S |
| 3.4 | Extend the icon set with scouting motifs (tent, campfire, compass) in the existing stroke style; extract `icons.jsx` and dedupe shadcn-local chevrons/checks | M |
| 3.5 | Merge `Metric` into `StatTile`; reuse `SegmentedControl` in Settings; adopt `Field` across all forms (Pattern C) | M |
| 3.6 | Decide CVA: adopt for variant maps or remove the dependency **[dep: package change]** | S |

---

*Method note: every value cited was read from source at the listed line; contrast ratios computed from the HSL tokens in `index.css` over their actual rendered backgrounds. `server/`, `dist/`, and `node_modules/` were excluded per scope.*
