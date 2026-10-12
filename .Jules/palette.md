## 2026-10-12 - Focus Management in Modal Overlays & Switch Primitive Accessibility

**Learning:** React modal dialogs and drawers that lack focus trapping or focus restoration cause keyboard users to lose focus context on close. Custom `<button role="switch">` elements inside `<label>` elements need explicit `aria-label` to be announced properly by screen readers when focused via keyboard.
**Action:** Always save `document.activeElement` before mounting dialogs/drawers and restore focus on unmount. Ensure switch primitive components pass `aria-label={label}` directly to the `<button role="switch">`.
