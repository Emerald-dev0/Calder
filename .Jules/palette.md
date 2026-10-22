## 2026-10-07 - Accessible ARIA Labels on Collapsed Icon-Only Triggers

**Learning:** Collapsed icon buttons that display abbreviated text or initials (like organization initials in `context-switcher.tsx`) need explicit `aria-label`s specifying both the action and current selected context state for screen reader users.
**Action:** Always complement tooltip or `title` attributes on icon-only/initial-avatar trigger buttons with descriptive `aria-label` attributes.

## 2026-10-19 - Accessible & Auto-Focused Confirmation Phrase Inputs

**Learning:** Phrase confirmation inputs in destructive dialogs require explicit `id`/`htmlFor` label linkage and `aria-required="true"` for screen readers. In addition, disabling browser autocorrect (`autoComplete="off"`, `autoCorrect="off"`, `spellCheck={false}`) and providing `autoFocus` prevents browser text mutation and enables seamless keyboard typing.
**Action:** When building confirmation phrase inputs, pair `React.useId()` label linkage with `autoFocus` and disabled spellcheck/autocorrect.

## 2026-10-22 - Explicit Tab-to-Tabpanel Linking with WAI-ARIA Attributes

**Learning:** Controls with `role="tab"` and `role="tablist"` require explicit `id` and `aria-controls` linkage targeting the corresponding container with `role="tabpanel"` and `aria-labelledby`. Without explicit ID linkage, screen reader users cannot associate tab navigation controls with the dynamically rendered panel contents in inspectors or preview containers.
**Action:** Always assign explicit `id` and `aria-controls` attributes to `role="tab"` elements and pair them with `role="tabpanel"` wrappers having matching `id` and `aria-labelledby`.
