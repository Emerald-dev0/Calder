## 2026-10-07 - Accessible ARIA Labels on Collapsed Icon-Only Triggers
**Learning:** Collapsed icon buttons that display abbreviated text or initials (like organization initials in `context-switcher.tsx`) need explicit `aria-label`s specifying both the action and current selected context state for screen reader users.
**Action:** Always complement tooltip or `title` attributes on icon-only/initial-avatar trigger buttons with descriptive `aria-label` attributes.

## 2026-10-07 - Accessible State Indications for Interactive Controls
**Learning:** Copy buttons with truncated text (`CopyableMono`) and segmented toggle buttons (`DataTable` density controls) require explicit `aria-label` updates and `aria-pressed` state attributes so screen reader users receive immediate audio feedback on interactions and state changes.
**Action:** Always add dynamic `aria-label` state feedback for copy buttons and `aria-pressed` attributes to toggle buttons.
