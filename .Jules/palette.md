## 2026-10-07 - Accessible ARIA Labels on Collapsed Icon-Only Triggers

**Learning:** Collapsed icon buttons that display abbreviated text or initials (like organization initials in `context-switcher.tsx`) need explicit `aria-label`s specifying both the action and current selected context state for screen reader users.
**Action:** Always complement tooltip or `title` attributes on icon-only/initial-avatar trigger buttons with descriptive `aria-label` attributes.

## 2026-10-19 - Accessible & Auto-Focused Confirmation Phrase Inputs

**Learning:** Phrase confirmation inputs in destructive dialogs require explicit `id`/`htmlFor` label linkage and `aria-required="true"` for screen readers. In addition, disabling browser autocorrect (`autoComplete="off"`, `autoCorrect="off"`, `spellCheck={false}`) and providing `autoFocus` prevents browser text mutation and enables seamless keyboard typing.
**Action:** When building confirmation phrase inputs, pair `React.useId()` label linkage with `autoFocus` and disabled spellcheck/autocorrect.

## 2026-10-27 - Accessible State for Toggleable Chart Legend Chips

**Learning:** Chart series legend chips that toggle dataset visibility on/off require `aria-pressed` state attributes so assistive technology can announce whether each data series is active or hidden.
**Action:** Always complement visual dataset toggle styling (`data-on`) with `aria-pressed={boolean}` and explicit `aria-label`s on chart legend toggle buttons.
