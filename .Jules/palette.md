## 2026-10-16 - Custom Switch Accessibility (role="switch")

**Learning:** Custom switch components using `<button role="switch">` wrapped inside a `<label>` do not implicitly expose sibling label elements to screen readers as the switch button's accessible name unless `aria-label` or `aria-labelledby` is explicitly attached to the switch button element.
**Action:** Always provide an explicit `aria-label` (defaulting to the visible label text) on `<button role="switch">` elements in design system primitive controls.
