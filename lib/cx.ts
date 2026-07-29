// Tiny classnames helper (clsx-lite): join truthy class fragments with a space.
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
