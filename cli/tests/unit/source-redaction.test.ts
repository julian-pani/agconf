import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The GITHUB_TOKEN this test injects into the clone URL. simple-git's error
// message echoes git's stderr, which can contain the full URL (token included);
// resolveGithubSource must strip it before the error propagates to any logger.
const SECRET_TOKEN = "ghp_supersecrettokenvalue1234567890";

// Force the gh CLI path to look unavailable so cloneRepository falls through to
// the git-clone-with-token branch (the one that can leak the token on failure).
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    exec: (_command: string, arg2: unknown, arg3?: unknown) => {
      const cb = (typeof arg2 === "function" ? arg2 : arg3) as (err: Error) => void;
      cb(new Error("gh unavailable"));
    },
  };
});

// Make the token-bearing clone fail with a git-style error that embeds the URL.
vi.mock("simple-git", () => ({
  simpleGit: () => ({
    clone: () =>
      Promise.reject(
        new Error(
          `fatal: Authentication failed for 'https://x-access-token:${SECRET_TOKEN}@github.com/acme/private-repo.git/'`,
        ),
      ),
  }),
}));

describe("resolveGithubSource token redaction", () => {
  let originalToken: string | undefined;

  beforeEach(() => {
    originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = SECRET_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    vi.restoreAllMocks();
  });

  it("strips the embedded token from a failed clone error", async () => {
    const { resolveGithubSource } = await import("../../src/core/source.js");

    const promise = resolveGithubSource(
      { repository: "acme/private-repo", ref: "main" },
      "/tmp/agconf-nonexistent-clone-target",
    );

    await expect(promise).rejects.toThrow(/Authentication failed/);
    // The rejection message must not contain the token, and must show the mask.
    await promise.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(SECRET_TOKEN);
      expect(message).not.toContain("x-access-token");
      expect(message).toContain("//***@github.com/acme/private-repo.git");
    });
  });
});
