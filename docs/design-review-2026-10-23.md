# Design team review · 23 October 2026

## Brief and scope

Polish the existing scout management app for French- and Arabic-speaking leaders, preserving its teal identity, bilingual language, existing workflows and permissions. Make routine work—finding members, preparing activities, attendance, meetings and dues—clear and accessible on desktop and phones.

Reviewed all 21 page modules and 43 top-level shared components. The implementation uses React 19, React Router, Tailwind 4, Radix primitives and the existing Inter/Noto Sans Arabic typography. Project evidence: current components, tokens, assets, AUDIT.md and the feature roadmap. No AGENTS.md or separate product/design convention document was found.

Rendered coverage: dashboard; branches; members and member detail; sessions and session detail; preparation cards and card detail; events and event detail; meetings and meeting detail; treasury; promotions; leaders and leader detail; settings; administration; print report; sign-in; initial password change; and the missing-page state. French light pages were inspected at 1280px and 320px; Arabic dark pages at 320px, with desktop authentication checks.

The session print preview was rendered. Other print variants and every conditional form state were reviewed in source where applicable, but were not exhaustively exercised in the browser. Review data was synthetic and stored in a separate local database; the working app database was not changed.

## Coverage

| Domain | Evidence | Result |
| --- | --- | --- |
| Accessibility | Shared controls, all-page names scan, modal focus, keyboard pickers, required fields, error announcements and route focus | Approve for inspected scope |
| Layout | All-route desktop/mobile captures, 320px reflow measurements, RTL captures, form and calendar overlays | Approve |
| Writing | All page/shared translation usage, French/Arabic actions, validation, confirmations, empty states and recovery messages | Approve |
| Typography | Long titles, mixed-script names, Arabic heading leading, existing type scale | Approve |
| Colors | Input boundary measurements, semantic foreground pairs, calendar text and focus treatment | Approve |
| UI polish | Rendered hierarchy, spacing, surfaces, form footer, navigation and overlay positioning | Approve |

## Resolved findings

No actionable HIGH findings remain in the inspected scope.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | client/src/components/ui.jsx:998 | Modal focus could run before the portal existed; background remained available | Focus waits for mount; background inert; focus trapped and restored | Keeps keyboard interaction inside the active task |
| HIGH | Accessibility | client/src/components/Combobox.jsx:77; client/src/components/SearchSelect.jsx:176 | Incomplete listbox relationships and keyboard selection | Active descendants, arrow navigation and Enter selection | Exposes the focused suggestion to assistive technology |
| HIGH | Accessibility | client/src/components/DatePicker.jsx:178; client/src/components/TimePicker.jsx:133; client/src/components/ui.jsx:817 | Hidden required proxies could receive invalid focus | First invalid visible picker opens and receives focus | Provides a usable recovery path |
| HIGH | Accessibility | client/src/components/MemberForm.jsx:292; client/src/components/ui.jsx:1051 | Initial focus could land on the visually hidden photo input | Text field receives initial focus; photo upload has a visible focus treatment | Makes the keyboard position visible |
| HIGH | Colors | client/src/index.css:52; client/src/index.css:136 | Field boundaries measured below 3:1 | Light boundary/card 3.42:1; dark boundary/card 3.70:1 | Makes field boundaries distinguishable |
| HIGH | Layout | client/src/components/shadcn/popover.jsx:22 | A tall calendar could clip above the viewport | Popovers use available-height bounds and scroll | Keeps month/year controls reachable |
| HIGH | Writing | client/src/locales/fr.json:2899 | Empty health data implied participants had no health concerns | Explicitly says none are recorded | Avoids treating missing information as a health assurance |
| MEDIUM | Writing | client/src/lib/errors.js:20; client/src/App.jsx:172 | Technical error codes/exceptions could reach the UI | Localized recovery at display boundaries; domain comparisons retained | Gives readers a useful next step |
| MEDIUM | Accessibility | client/src/components/ui.jsx:1253 | Errors auto-dismissed and newer messages could displace them | Errors persist until dismissed; stable polite success announcements | Leaves important feedback available |
| MEDIUM | Writing | client/src/components/CalendarPanel.jsx:19; page confirmations | Calendar names defaulted to English; some confirmations used generic labels | French/Arabic calendar names and explicit action labels | Makes actions and states understandable |
| MEDIUM | Typography | client/src/index.css:259; client/src/index.css:283 | Long names and tight Arabic headings could crowd content | Headings wrap; Arabic leading is 1.4 | Preserves readable mixed-script content |
| MEDIUM | Accessibility | client/src/components/Layout.jsx:586; client/src/App.jsx:142 | Navigation could leave focus in the sidebar; missing page lacked h1 | Focus moves to main; page titles update; missing page has h1 | Makes route changes understandable |

## Verification

Passed:

- `npm run build` on the final source. The build retains a non-blocking bundle-size warning.
- `git diff --check`.
- All 21 page modules rendered through their routes or authentication states.
- Twenty Arabic dark route checks: `dir=rtl`, dark theme, `scrollX=0`, document width no wider than the 320px viewport, and no unnamed visible controls in the automated DOM scan. Intentional horizontally scrollable table containers were treated separately from page overflow.
- Modal opens on the first text input; Tab from the final action wraps inside; Escape restores the trigger. Escape from the calendar closes the calendar while leaving the form open.
- Keyboard date selection and clearing; time selection and clearing; searchable leader selection with active-descendant state and Enter.
- Required date, time, select and searchable select tested in an isolated temporary harness using the real components: only the first invalid picker opens, each completed field advances validation, and the completed form validates. Harness removed afterward.
- Initial ArrowUp/Enter selects the last combobox suggestion; ArrowDown and wrapping remain supported.
- Date picker position measured at top 12px / bottom 408px inside an 812px viewport after correction.
- Copy validation: translation JSON parses; existing interpolation tokens preserved; static translation references resolve; all 40 page confirmations have action labels; 217 server error literals checked in both languages without mutating the original errors.

Not verified: speech output with a real screen reader, native browser 200% zoom, OS forced-colors mode, every conditional state and every print variant. Forced-colors focus styles and reduced-motion rules were inspected in source. These limits do not constitute a full WCAG certification.

## Evidence

- [Desktop dashboard](../captures/design-review-2026-10-23/dashboard-desktop.png)
- [Member form at phone width](../captures/design-review-2026-10-23/member-form-mobile.png)
- [Viewport-bounded calendar](../captures/design-review-2026-10-23/calendar-mobile.png)
- [Arabic dark settings](../captures/design-review-2026-10-23/settings-ar-dark.png)
- [Arabic password screen](../captures/design-review-2026-10-23/password-ar-desktop.png)
- [Arabic route measurements](../captures/design-review-2026-10-23/route-audit.json)

## Sign-off

| Reviewer | Decision |
| --- | --- |
| UI Designer | Approve: rendered visual design, including authentication and Arabic dark mode |
| Brand Guardian / copy reviewer | Approve: French/Arabic wording, actions and recovery |
| UX Researcher / accessibility reviewer | Approve: inspected source and supplied runtime evidence, within the stated limits |

**Verdict: Approve for the reviewed scope.**
