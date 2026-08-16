import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTempDir,
  directoryExists,
  ensureDir,
  fileExists,
  removeTempDir,
  resolvePath,
} from "../../src/utils/fs.js";

describe("fs utils", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-fsutil-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe("ensureDir", () => {
    it("creates nested directories and is idempotent", async () => {
      const nested = path.join(dir, "a", "b", "c");
      await ensureDir(nested);
      await ensureDir(nested);
      expect(await directoryExists(nested)).toBe(true);
    });
  });

  describe("fileExists / directoryExists", () => {
    it("distinguishes files, directories, and absent paths", async () => {
      const file = path.join(dir, "file.txt");
      await fs.writeFile(file, "x", "utf-8");

      expect(await fileExists(file)).toBe(true);
      expect(await fileExists(path.join(dir, "nope.txt"))).toBe(false);

      // A directory is accessible, so fileExists reports true for it too...
      expect(await fileExists(dir)).toBe(true);
      // ...while directoryExists is strict about the kind.
      expect(await directoryExists(dir)).toBe(true);
      expect(await directoryExists(file)).toBe(false);
      expect(await directoryExists(path.join(dir, "nope"))).toBe(false);
    });
  });

  describe("createTempDir / removeTempDir", () => {
    it("creates a unique prefixed directory and removes it", async () => {
      const a = await createTempDir("agconf-fsutil-test-");
      const b = await createTempDir("agconf-fsutil-test-");
      try {
        expect(a).not.toBe(b);
        expect(path.basename(a).startsWith("agconf-fsutil-test-")).toBe(true);
        expect(await directoryExists(a)).toBe(true);

        await removeTempDir(a);
        expect(await directoryExists(a)).toBe(false);
      } finally {
        await removeTempDir(a);
        await removeTempDir(b);
      }
    });

    it("never throws when the directory is already gone", async () => {
      await expect(removeTempDir(path.join(dir, "never-existed"))).resolves.toBeUndefined();
    });
  });

  describe("resolvePath", () => {
    it("expands a leading ~ to the home directory", () => {
      expect(resolvePath("~/code/agconf")).toBe(path.join(os.homedir(), "/code/agconf"));
      expect(resolvePath("~")).toBe(os.homedir());
    });

    it("resolves relative paths against cwd and leaves absolute paths intact", () => {
      expect(resolvePath("./x")).toBe(path.resolve("./x"));
      expect(resolvePath("/tmp/x")).toBe(path.resolve("/tmp/x"));
      // A `~` that is not the first character is not a home reference.
      expect(resolvePath("a/~b")).toBe(path.resolve("a/~b"));
    });
  });
});
