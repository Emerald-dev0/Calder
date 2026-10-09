## 2026-10-09 - Accessible Form Controls in Dialogs

**Learning:** Confirmation input fields inside custom dialogs often miss `htmlFor` / `id` associations when written inline without wrapping `<label>` tags. Screen readers fail to announce the target phrase prompt when focus lands on the input.
**Action:** Always use `React.useId()` to generate deterministic IDs for dialog inputs and tie them explicitly to their corresponding `<label htmlFor={id}>`.
