/**
 * A GitHub `owner/repo` slug. Deliberately stricter than "two segments split by
 * a slash": each segment must START with an alphanumeric, which rejects both
 * `..` path traversal (`../..`, `x/..`) and leading-dash values that a CLI would
 * read as a flag rather than a positional argument (`-oProxyCommand=…/repo`).
 */
const REPOSITORY_SLUG = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

/** Is this a well-formed, safe-to-interpolate GitHub `owner/repo` slug? */
export function isValidRepositorySlug(value: string): boolean {
  return REPOSITORY_SLUG.test(value);
}

/**
 * Throw unless `value` is a safe `owner/repo` slug. Called at the sinks that
 * pass a repository to a subprocess or a URL — the value can arrive from a
 * lockfile (committed downstream, or the `~/.agconf` store) as well as from a
 * flag, so it is not trusted input just because a person typed it once.
 */
export function assertValidRepositorySlug(value: string): void {
  if (!isValidRepositorySlug(value)) {
    throw new Error(
      `Invalid repository "${value}". Expected a GitHub repository in owner/repo format (e.g. acme/standards).`,
    );
  }
}

/**
 * Throw unless `ref` is a plausible git ref. Defense in depth: refs reach us
 * from a canonical repo's release tags (i.e. from whoever can cut a release
 * there), and flow into `git`/`gh` argument lists. Argument arrays already stop
 * shell interpretation, so this exists to stop a ref being read as a FLAG and to
 * keep obviously-malformed refs from reaching the network.
 */
export function assertValidGitRef(ref: string): void {
  // Deliberately permissive about the characters git itself allows in a tag —
  // `@` (monorepo tags like `standards@1.2.0`) and `+` (semver build metadata,
  // `v1.0.0+build.1`) are real and must not fail a sync. The load-bearing
  // constraints are only the two that argument arrays cannot cover: a ref must
  // not START with `-` (it would be read as a flag) and must not traverse.
  if (!/^[A-Za-z0-9][\w./@+-]*$/.test(ref) || ref.includes("..")) {
    throw new Error(`Invalid ref "${ref}". Expected a branch, tag, or commit-ish.`);
  }
}
