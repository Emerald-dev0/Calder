/** Prefer the deepest visible route so section overviews aren't active on every child. */
export function activeControlHref(
  pathname: string,
  items: ReadonlyArray<{ href: string; exact?: boolean }>
): string | undefined {
  return items
    .filter(
      (item) => pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`))
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
