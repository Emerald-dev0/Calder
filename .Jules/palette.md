## 2025-10-10 - Collapsed Switcher Accessible Name

**Learning:** Icon-only or compact sidebar elements (like context and workspace switchers) often rely on title attributes or rendered initials for accessible labeling, which can fail screen reader expectations if no `aria-label` is specified.
**Action:** Always provide an explicit `aria-label` describing both the action and current context (e.g., `Switch organization or project: ${orgName}`) for collapsed or icon-only switcher buttons.
