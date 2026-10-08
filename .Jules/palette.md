## 2026-10-07 - Accessible ARIA Labels on Collapsed Icon-Only Triggers
**Learning:** Collapsed icon buttons that display abbreviated text or initials (like organization initials in `context-switcher.tsx`) need explicit `aria-label`s specifying both the action and current selected context state for screen reader users.
**Action:** Always complement tooltip or `title` attributes on icon-only/initial-avatar trigger buttons with descriptive `aria-label` attributes.
