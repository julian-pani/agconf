/**
 * Escape regex metacharacters in a string so it can be embedded literally in a
 * `RegExp`. Used when interpolating user-configurable values (e.g. a custom
 * marker/metadata prefix) into a pattern, so an exotic prefix can neither match
 * too loosely nor throw at `RegExp` construction.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
