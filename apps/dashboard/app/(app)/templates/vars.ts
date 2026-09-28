/** Shared {{variable}} extraction; identical regex to the API renderer. */
export function extractVariables(...bodies: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const body of bodies) {
    if (!body) continue;
    for (const m of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]!);
  }
  return [...found].sort();
}
