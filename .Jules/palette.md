# Palette's Journal - Critical Learnings

## 2026-10-15 - ARIA Atomic for Toast Notifications
**Learning:** Screen readers may only announce partial text changes in dynamic toast containers if `aria-atomic="true"` is omitted from the polite live region and toast status elements.
**Action:** Always set `aria-atomic="true"` on dynamic toast notification viewports (`aria-live="polite"`) and toast status elements (`role="status"`) to ensure full toast titles and descriptions are voiced as an atomic unit.
