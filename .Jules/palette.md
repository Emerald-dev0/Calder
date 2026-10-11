## 2026-10-11 - Accessible Switch Controls
**Learning:** Wrapping a `<button role="switch">` inside a `<label>` creates invalid HTML markup with nested interactive elements, and fails to expose accessible names/descriptions to screen reader users if `aria-labelledby` or `aria-describedby` is omitted.
**Action:** Use a `<div>` wrapper with `React.useId()` to generate unique IDs for label and description text, referencing them on the `<button role="switch">` via `aria-labelledby` and `aria-describedby`, along with focus styling for keyboard navigation.
