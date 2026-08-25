import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `node:child_process` is mocked so the GitHub-token lookup never shells out to
 * a real `gh` (which would make results depend on the developer's machine).
 * `execSync` backs the blocking lookup; `execFile` backs the async "safe" one.
 */
const ghToken = { value: null as string | null };

vi.mock("node:child_process", () => ({
  execSync: () => {
    if (ghToken.value === null) throw new Error("gh: not authenticated");
    return `${ghToken.value}\n`;
  },
  execFile: (
    _cmd: string,
    _args: string[],
    cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void,
  ) => {
    if (ghToken.value === null) {
      cb(new Error("gh: not found"));
      return;
    }
    cb(null, { stdout: `${ghToken.value}\n`, stderr: "" });
  },
}));

import {
  compareVersions,
  formatTag,
  getLatestRelease,
  getLatestReleaseSafe,
  isVersionRef,
  parseVersion,
} from "../../src/core/version.js";

describe("version", () => {
  describe("parseVersion", () => {
    it("removes v prefix from version tag", () => {
      expect(parseVersion("v1.2.3")).toBe("1.2.3");
    });

    it("returns version as-is if no v prefix", () => {
      expect(parseVersion("1.2.3")).toBe("1.2.3");
    });

    it("handles prerelease versions", () => {
      expect(parseVersion("v1.0.0-alpha")).toBe("1.0.0-alpha");
      expect(parseVersion("v2.1.0-beta.1")).toBe("2.1.0-beta.1");
    });

    it("handles edge cases", () => {
      expect(parseVersion("v0.0.1")).toBe("0.0.1");
      expect(parseVersion("v10.20.30")).toBe("10.20.30");
    });
  });

  describe("formatTag", () => {
    it("adds v prefix to version", () => {
      expect(formatTag("1.2.3")).toBe("v1.2.3");
    });

    it("returns tag as-is if already has v prefix", () => {
      expect(formatTag("v1.2.3")).toBe("v1.2.3");
    });

    it("handles prerelease versions", () => {
      expect(formatTag("1.0.0-alpha")).toBe("v1.0.0-alpha");
      expect(formatTag("v1.0.0-beta.2")).toBe("v1.0.0-beta.2");
    });
  });

  describe("isVersionRef", () => {
    it("returns true for version tags with v prefix", () => {
      expect(isVersionRef("v1.0.0")).toBe(true);
      expect(isVersionRef("v1.2.3")).toBe(true);
      expect(isVersionRef("v10.20.30")).toBe(true);
    });

    it("returns true for version tags without v prefix", () => {
      expect(isVersionRef("1.0.0")).toBe(true);
      expect(isVersionRef("1.2.3")).toBe(true);
      expect(isVersionRef("0.0.1")).toBe(true);
    });

    it("returns true for prerelease versions", () => {
      expect(isVersionRef("v1.0.0-alpha")).toBe(true);
      expect(isVersionRef("1.0.0-beta.1")).toBe(true);
      expect(isVersionRef("v2.0.0-rc.2")).toBe(true);
    });

    it("returns false for branch names", () => {
      expect(isVersionRef("master")).toBe(false);
      expect(isVersionRef("main")).toBe(false);
      expect(isVersionRef("develop")).toBe(false);
      expect(isVersionRef("feature/new-thing")).toBe(false);
    });

    it("returns false for invalid version formats", () => {
      expect(isVersionRef("v1.0")).toBe(false);
      expect(isVersionRef("v1")).toBe(false);
      expect(isVersionRef("latest")).toBe(false);
      expect(isVersionRef("1.2.3.4")).toBe(false);
    });
  });

  // ─── Network layer ────────────────────────────────────────────────────────
  describe("release lookups (getLatestRelease / getLatestReleaseSafe)", () => {
    const RELEASE_BODY = {
      tag_name: "v1.2.0",
      target_commitish: "abc1234567890",
      published_at: "2026-01-01T00:00:00Z",
      tarball_url: "https://api.github.com/tarball/v1.2.0",
    };

    let fetchMock: ReturnType<typeof vi.fn>;
    let originalToken: string | undefined;

    const okResponse = (body: unknown) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    });
    const errResponse = (status: number, statusText: string) => ({
      ok: false,
      status,
      statusText,
      json: async () => ({}),
    });

    beforeEach(() => {
      originalToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = "env-token";
      ghToken.value = "gh-cli-token";
      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
      vi.unstubAllGlobals();
    });

    const headersOf = (call: unknown[]) =>
      (call[1] as { headers: Record<string, string> } | undefined)?.headers ?? {};

    describe("getLatestRelease", () => {
      it("parses the release payload and strips the v prefix", async () => {
        fetchMock.mockResolvedValue(okResponse(RELEASE_BODY));

        const release = await getLatestRelease("acme/standards");

        expect(release).toEqual({
          tag: "v1.2.0",
          version: "1.2.0",
          commitSha: "abc1234567890",
          publishedAt: "2026-01-01T00:00:00Z",
          tarballUrl: "https://api.github.com/tarball/v1.2.0",
        });
        expect(fetchMock.mock.calls[0]?.[0]).toBe(
          "https://api.github.com/repos/acme/standards/releases/latest",
        );
      });

      it("rejects an unsafe repository before it reaches the API path", async () => {
        // The value can come from a lockfile; it lands in a URL path here and in
        // a subprocess argument list in source.ts. Guard must run at the sink.
        await expect(getLatestRelease("acme/$(id)")).rejects.toThrow(/owner\/repo format/);
        await expect(getLatestRelease("../../etc/passwd")).rejects.toThrow(/owner\/repo format/);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("defaults commitSha to an empty string when target_commitish is absent", async () => {
        fetchMock.mockResolvedValue(okResponse({ ...RELEASE_BODY, target_commitish: undefined }));

        const release = await getLatestRelease("acme/standards");
        expect(release.commitSha).toBe("");
      });

      it("prefers GITHUB_TOKEN over the gh CLI", async () => {
        fetchMock.mockResolvedValue(okResponse(RELEASE_BODY));

        await getLatestRelease("acme/standards");

        expect(headersOf(fetchMock.mock.calls[0] ?? []).Authorization).toBe("token env-token");
      });

      it("falls back to `gh auth token` when GITHUB_TOKEN is unset", async () => {
        delete process.env.GITHUB_TOKEN;
        fetchMock.mockResolvedValue(okResponse(RELEASE_BODY));

        await getLatestRelease("acme/standards");

        expect(headersOf(fetchMock.mock.calls[0] ?? []).Authorization).toBe("token gh-cli-token");
      });

      it("throws actionable auth guidance when no token is available at all", async () => {
        delete process.env.GITHUB_TOKEN;
        ghToken.value = null;
        fetchMock.mockResolvedValue(okResponse(RELEASE_BODY));

        await expect(getLatestRelease("acme/standards")).rejects.toThrow(
          /GitHub authentication required/,
        );
        // The request is never attempted without credentials.
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("distinguishes 404 (no releases) from other HTTP failures", async () => {
        fetchMock.mockResolvedValue(errResponse(404, "Not Found"));
        await expect(getLatestRelease("acme/standards")).rejects.toThrow("No releases found");

        fetchMock.mockResolvedValue(errResponse(500, "Internal Server Error"));
        await expect(getLatestRelease("acme/standards")).rejects.toThrow(
          "Failed to fetch latest release: Internal Server Error",
        );
      });
    });

    describe("getLatestReleaseSafe", () => {
      it("returns the release and bounds the request with an abort signal", async () => {
        fetchMock.mockResolvedValue(okResponse(RELEASE_BODY));

        const release = await getLatestReleaseSafe("acme/standards", 1234);

        expect(release?.version).toBe("1.2.0");
        const init = fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal };
        expect(init?.signal).toBeInstanceOf(AbortSignal);
      });

      it("omits the Authorization header when no token can be found (never throws)", async () => {
        delete process.env.GITHUB_TOKEN;
        ghToken.value = null;
        fetchMock.mockResolvedValue(okResponse(RELEASE_BODY));

        const release = await getLatestReleaseSafe("acme/standards", 1000);

        expect(release?.version).toBe("1.2.0");
        expect(headersOf(fetchMock.mock.calls[0] ?? []).Authorization).toBeUndefined();
      });

      it("uses the gh CLI token when GITHUB_TOKEN is unset", async () => {
        delete process.env.GITHUB_TOKEN;
        fetchMock.mockResolvedValue(okResponse(RELEASE_BODY));

        await getLatestReleaseSafe("acme/standards", 1000);

        expect(headersOf(fetchMock.mock.calls[0] ?? []).Authorization).toBe("token gh-cli-token");
      });

      it("returns null for an HTTP error instead of throwing", async () => {
        fetchMock.mockResolvedValue(errResponse(404, "Not Found"));
        expect(await getLatestReleaseSafe("acme/standards", 1000)).toBeNull();
      });

      it("returns null when the payload has no usable tag", async () => {
        // A malformed payload must read as "can't tell", not crash session start.
        fetchMock.mockResolvedValue(okResponse({}));
        expect(await getLatestReleaseSafe("acme/standards", 1000)).toBeNull();

        fetchMock.mockResolvedValue(okResponse({ tag_name: "v" }));
        expect(await getLatestReleaseSafe("acme/standards", 1000)).toBeNull();
      });

      it("returns null when the request fails or times out", async () => {
        fetchMock.mockRejectedValue(new DOMException("aborted", "TimeoutError"));
        expect(await getLatestReleaseSafe("acme/standards", 1)).toBeNull();

        fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com"));
        expect(await getLatestReleaseSafe("acme/standards", 1000)).toBeNull();
      });
    });
  });

  describe("compareVersions", () => {
    it("returns 0 for equal versions", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.0", "v1.0.0")).toBe(0);
      expect(compareVersions("v1.2.3", "v1.2.3")).toBe(0);
    });

    it("compares major versions correctly", () => {
      expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
      expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
      expect(compareVersions("10.0.0", "9.0.0")).toBe(1);
    });

    it("compares minor versions correctly", () => {
      expect(compareVersions("1.2.0", "1.1.0")).toBe(1);
      expect(compareVersions("1.1.0", "1.2.0")).toBe(-1);
      expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    });

    it("compares patch versions correctly", () => {
      expect(compareVersions("1.0.2", "1.0.1")).toBe(1);
      expect(compareVersions("1.0.1", "1.0.2")).toBe(-1);
      expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    });

    it("handles prerelease versions (prerelease < release)", () => {
      expect(compareVersions("1.0.0-alpha", "1.0.0")).toBe(-1);
      expect(compareVersions("1.0.0", "1.0.0-alpha")).toBe(1);
      expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
      expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    });

    it("compares prerelease versions alphabetically", () => {
      expect(compareVersions("1.0.0-alpha", "1.0.0-alpha")).toBe(0);
      expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.2")).toBe(-1);
      expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    });

    it("handles v prefix in comparisons", () => {
      expect(compareVersions("v1.2.0", "v1.1.0")).toBe(1);
      expect(compareVersions("v1.0.0", "1.0.1")).toBe(-1);
    });
  });
});
