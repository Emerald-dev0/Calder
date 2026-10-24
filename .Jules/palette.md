## 2026-10-07 - Accessible ARIA Labels on Collapsed Icon-Only Triggers

**Learning:** Collapsed icon buttons that display abbreviated text or initials (like organization initials in `context-switcher.tsx`) need explicit `aria-label`s specifying both the action and current selected context state for screen reader users.
**Action:** Always complement tooltip or `title` attributes on icon-only/initial-avatar trigger buttons with descriptive `aria-label` attributes.

## 2026-10-19 - Accessible & Auto-Focused Confirmation Phrase Inputs

**Learning:** Phrase confirmation inputs in destructive dialogs require explicit `id`/`htmlFor` label linkage and `aria-required="true"` for screen readers. In addition, disabling browser autocorrect (`autoComplete="off"`, `autoCorrect="off"`, `spellCheck={false}`) and providing `autoFocus` prevents browser text mutation and enables seamless keyboard typing.
**Action:** When building confirmation phrase inputs, pair `React.useId()` label linkage with `autoFocus` and disabled spellcheck/autocorrect.

## 2026-10-24 - Automatic ARIA Describedby for Form Field Hints & Errors

**Learning:** Form primitives (`DsInput`, `DsSelect`, `DsTextarea`) must automatically link generated hint/description IDs (`${id}-hint`) and error IDs (`${id}-error`) to `aria-describedby` on the underlying input element so screen readers announce validation errors and field instructions when focused.
**Action:** Always generate explicit helper/error IDs and assign `aria-describedby` in form input primitives unless overridden by explicit caller props.
