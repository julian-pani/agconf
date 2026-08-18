import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll } from "vitest";

/**
 * Give every test file its own TMPDIR, and delete it when the file is done.
 *
 * Code under test creates temp dirs of its own — `agconf propose` clones the
 * whole canonical repo into one per run — and a test that exercises a path
 * which legitimately keeps that dir (or that simply calls a core function
 * directly, without the command layer that owns cleanup) leaves it behind.
 * Run often enough, the suite buries the developer's temp dir in thousands of
 * abandoned clones.
 *
 * Redirecting TMPDIR per file contains all of it: anything resolving through
 * `os.tmpdir()` or `process.env.TMPDIR` lands here and goes away with the file,
 * without every test having to remember to clean up after itself.
 */
let root: string | undefined;
let original: string | undefined;

beforeAll(async () => {
  original = process.env.TMPDIR;
  // Created under the real tmp root, before the redirect takes effect.
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-vitest-"));
  process.env.TMPDIR = root;
});

afterAll(async () => {
  if (original === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = original;
  if (root) await fs.rm(root, { recursive: true, force: true });
});
