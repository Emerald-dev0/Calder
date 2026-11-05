/** Highlight only the most specific matching item in a nested control-plane nav. */
export function activeControlHref(
  pathname: string,
  items: ReadonlyArray<{ href: string; exact?: boolean }>
): string | null {
  return (
    items
      .filter((item) =>
        item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`)
      )
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null
  );
}
