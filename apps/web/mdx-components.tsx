import type { MDXComponents } from "mdx/types";

/**
 * MDX element mapping: raw markdown renders inside the docs prose system,
 * so blog posts inherit the same typography as the rest of the site.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
 return { ...components };
}
