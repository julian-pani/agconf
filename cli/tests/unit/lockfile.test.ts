import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkCliVersionMismatch,
  getCliVersion,
  getLockfilePath,
  hashContent,
  readLockfile,
  readLockfileSafe,
  writeLockfile,
} from "../../src/core/lockfile.js";
import { checkSchemaCompatibility, SUPPORTED_SCHEMA_VERSION } from "../../src/core/schema.js";
import { CURRENT_LOCKFILE_VERSION, LockfileSchema } from "../../src/schemas/lockfile.js";

describe("lockfile", () => {
  describe("LockfileSchema", () => {
    it("should validate a valid GitHub source lockfile", () => {
      const lockfile = {
        version: "1.0.0",
        synced_at: "2026-01-27T15:30:00.000Z",
        source: {
          type: "github" as const,
          repository: "org/agconf",
          commit_sha: "abc1234567890",
          ref: "master",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: true,
          },
          skills: ["conventional-commits", "git-conventions"],
        },
        cli_version: "1.0.0",
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(true);
    });

    it("should validate a valid local source lockfile", () => {
      const lockfile = {
        version: "1.0.0",
        synced_at: "2026-01-27T15:30:00.000Z",
        source: {
          type: "local" as const,
          path: "/path/to/agconf",
          commit_sha: "abc1234567890",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: false,
          },
          skills: [],
        },
        cli_version: "1.0.0",
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(true);
    });

    it("should allow local source without commit_sha", () => {
      const lockfile = {
        version: "1.0.0",
        synced_at: "2026-01-27T15:30:00.000Z",
        source: {
          type: "local" as const,
          path: "/path/to/agconf",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: false,
          },
          skills: [],
        },
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(true);
    });

    it("should allow lockfile without cli_version (optional for diagnostics)", () => {
      const lockfile = {
        version: "1.0.0",
        synced_at: "2026-01-27T15:30:00.000Z",
        source: {
          type: "github" as const,
          repository: "org/agconf",
          commit_sha: "abc1234567890",
          ref: "master",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: true,
          },
          skills: [],
        },
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(true);
    });

    it("should reject invalid semver version format", () => {
      const lockfile = {
        version: "1", // Invalid: must be semver format
        synced_at: "2026-01-27T15:30:00.000Z",
        source: {
          type: "github",
          repository: "org/agconf",
          commit_sha: "abc1234567890",
          ref: "master",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: true,
          },
          skills: [],
        },
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(false);
    });

    it("should reject invalid datetime", () => {
      const lockfile = {
        version: "1.0.0",
        synced_at: "not-a-date",
        source: {
          type: "github",
          repository: "org/agconf",
          commit_sha: "abc1234567890",
          ref: "master",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: true,
          },
          skills: [],
        },
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(false);
    });
  });

  describe("CURRENT_LOCKFILE_VERSION", () => {
    it("should be a valid semver format", () => {
      expect(CURRENT_LOCKFILE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("should match SUPPORTED_SCHEMA_VERSION", () => {
      expect(CURRENT_LOCKFILE_VERSION).toBe(SUPPORTED_SCHEMA_VERSION);
    });
  });

  describe("checkSchemaCompatibility", () => {
    it("should return compatible for matching version", () => {
      const result = checkSchemaCompatibility(SUPPORTED_SCHEMA_VERSION);
      expect(result.compatible).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });

    it("should return compatible with warning for newer minor version", () => {
      const result = checkSchemaCompatibility("1.1.0");
      expect(result.compatible).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("Some features may not work");
    });

    it("should return compatible with no warning for older minor version", () => {
      // Assuming current version is 1.0.0, any older minor is fine
      const result = checkSchemaCompatibility("1.0.0");
      expect(result.compatible).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it("should return incompatible for newer major version", () => {
      const result = checkSchemaCompatibility("2.0.0");
      expect(result.compatible).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("requires a newer CLI");
    });

    it("should treat a truncated version as having a zero minor (no crash)", () => {
      // A hand-edited "1" must degrade to 1.0.0-compatible, not throw.
      const result = checkSchemaCompatibility("1");
      expect(result.compatible).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it("should return incompatible for older major version", () => {
      const result = checkSchemaCompatibility("0.9.0");
      expect(result.compatible).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("outdated and no longer supported");
    });
  });

  describe("hashContent", () => {
    it("should produce consistent hashes", () => {
      const content = "Hello, World!";
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different content", () => {
      const hash1 = hashContent("Hello");
      const hash2 = hashContent("World");

      expect(hash1).not.toBe(hash2);
    });

    it("should produce sha256 prefixed hashes", () => {
      const hash = hashContent("test");
      expect(hash).toMatch(/^sha256:[a-f0-9]{12}$/);
    });
  });

  describe("read / write round trip", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agconf-lockfile-"));
    });
    afterEach(async () => {
      await fsp.rm(dir, { recursive: true, force: true });
    });

    const localSource = { type: "local" as const, path: "/canonical" };

    it("returns null (not an error) when no lockfile exists", async () => {
      expect(await readLockfile(dir)).toBeNull();
      expect(await readLockfileSafe(dir)).toBeNull();
    });

    it("writes and reads back the lockfile, creating .agconf as needed", async () => {
      const written = await writeLockfile(dir, {
        source: localSource,
        globalBlockContent: "GLOBAL",
        skills: ["alpha"],
        targets: ["claude", "codex"],
        pinnedVersion: "1.2.0",
        markerPrefix: "acme",
        rules: { files: ["security/api.md"], content_hash: "sha256:aaaaaaaaaaaa" },
        agents: { files: ["reviewer.md"], content_hash: "sha256:bbbbbbbbbbbb" },
      });

      expect(written.content.agents_md.global_block_hash).toBe(hashContent("GLOBAL"));

      const read = await readLockfile(dir);
      expect(read?.lockfile).toEqual(written);
      expect(read?.schemaCompatibility.compatible).toBe(true);
      // No temp artifact is left behind by the atomic write.
      const entries = await fsp.readdir(path.join(dir, ".agconf"));
      expect(entries).toEqual(["lockfile.json"]);
    });

    it("defaults targets to ['claude'] when not specified", async () => {
      const written = await writeLockfile(dir, {
        source: localSource,
        globalBlockContent: "GLOBAL",
        skills: [],
      });
      expect(written.content.targets).toEqual(["claude"]);
      expect(written.pinned_version).toBeUndefined();
    });

    it("throws on a corrupt lockfile, but readLockfileSafe degrades to null", async () => {
      await fsp.mkdir(path.join(dir, ".agconf"), { recursive: true });
      await fsp.writeFile(getLockfilePath(dir), "{ not json", "utf-8");

      await expect(readLockfile(dir)).rejects.toThrow();
      expect(await readLockfileSafe(dir)).toBeNull();
    });

    it("throws on a schema-invalid lockfile, but readLockfileSafe degrades to null", async () => {
      await fsp.mkdir(path.join(dir, ".agconf"), { recursive: true });
      // Valid JSON, invalid shape (missing `content`).
      await fsp.writeFile(
        getLockfilePath(dir),
        JSON.stringify({ version: "1.0.0", synced_at: new Date().toISOString(), source: {} }),
        "utf-8",
      );

      await expect(readLockfile(dir)).rejects.toThrow();
      expect(await readLockfileSafe(dir)).toBeNull();
    });
  });

  describe("checkCliVersionMismatch", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agconf-climismatch-"));
    });
    afterEach(async () => {
      await fsp.rm(dir, { recursive: true, force: true });
    });

    /** Write a lockfile with an arbitrary `cli_version` (writeLockfile always stamps its own). */
    const seed = async (cliVersion?: string) => {
      const lockfile: Record<string, unknown> = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/canonical" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
        },
      };
      if (cliVersion !== undefined) lockfile.cli_version = cliVersion;
      await fsp.mkdir(path.join(dir, ".agconf"), { recursive: true });
      await fsp.writeFile(getLockfilePath(dir), JSON.stringify(lockfile), "utf-8");
    };

    it("returns null when there is no lockfile (first sync)", async () => {
      expect(await checkCliVersionMismatch(dir)).toBeNull();
    });

    it("returns null when the lockfile records no CLI version", async () => {
      await seed();
      expect(await checkCliVersionMismatch(dir)).toBeNull();
    });

    it("returns null when the versions are equal", async () => {
      await seed(getCliVersion());
      expect(await checkCliVersionMismatch(dir)).toBeNull();
    });

    it("reports a mismatch when the lockfile was synced with a newer CLI", async () => {
      // Under test getCliVersion() is the "0.0.0" dev fallback, so any real
      // version is newer. Each of major/minor/patch must be enough on its own.
      for (const newer of ["1.0.0", "0.1.0", "0.0.1"]) {
        await seed(newer);
        expect(await checkCliVersionMismatch(dir)).toEqual({
          currentVersion: getCliVersion(),
          lockfileVersion: newer,
        });
      }
    });
  });

  describe("getCliVersion", () => {
    it("should return fallback version when not built (dev mode)", () => {
      // During tests (not built with tsup), __BUILD_VERSION__ is undefined
      // so it should return the fallback "0.0.0"
      const version = getCliVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it.skipIf(!existsSync("./dist/index.js"))(
      "built CLI should output version matching package.json",
      () => {
        // This test verifies that after building, the CLI version matches package.json
        const pkgJson = JSON.parse(readFileSync("./package.json", "utf-8"));
        const expectedVersion = pkgJson.version;

        // Run the built CLI to get its version
        const output = execSync("node ./dist/index.js --version", {
          encoding: "utf-8",
        }).trim();

        expect(output).toBe(expectedVersion);
      },
    );
  });
});
