## 2026-10-13 - Data Table Keyboard & Screen Reader Accessibility

**Learning:** Sortable table columns need `aria-sort` ("ascending" | "descending" | "none") on `<th>` elements and keyboard interaction handlers (`tabIndex={0}` + Enter/Space listener) so screen reader and keyboard-only users can sort data tables effortlessly. `CopyableMono` elements also need dynamic `aria-label`s so screen readers announce copy status cleanly.
**Action:** Always add `aria-sort`, `tabIndex`, and `onKeyDown` handlers to sortable table headers, and supply explicit `aria-label` attributes to inline copy buttons.
