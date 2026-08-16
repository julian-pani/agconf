import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  evaluateChange,
  type MergeBase,
  resolveMergeBase,
  StaleBaseError,
  threeWayMerge,
} from "../../src/core/propose-merge.js";

const buf = (s: string): Buffer => Buffer.from(s, "utf-8");

/** A resolvable base holding `content`. */
const baseWith = (content: string | null): MergeBase => ({
  available: true,
  content: content === null ? null : buf(content),
});

const NO_BASE: MergeBase = { available: false, content: null };

describe("propose-merge", () => {
  describe("threeWayMerge", () => {
    it("merges non-overlapping edits on either side", async () => {
      const base = "line one\nline two\nline three\n";
      const ours = "line one CHANGED\nline two\nline three\n";
      const theirs = "line one\nline two\nline three CHANGED\n";

      const result = await threeWayMerge(buf(base), buf(ours), buf(theirs));

      expect(result.conflicted).toBe(false);
      expect(result.merged?.toString("utf-8")).toBe(
        "line one CHANGED\nline two\nline three CHANGED\n",
      );
    });

    it("reports a conflict when both sides edit the same line", async () => {
      const base = "shared line\n";
      const result = await threeWayMerge(buf(base), buf("ours wins\n"), buf("theirs wins\n"));

      expect(result.conflicted).toBe(true);
      expect(result.merged).toBeNull();
    });

    it("refuses to merge binary content", async () => {
      const binary = Buffer.from([0x89, 0x50, 0x00, 0x1a]);
      const result = await threeWayMerge(binary, Buffer.from([0x89, 0x00]), binary);

      expect(result.conflicted).toBe(true);
      expect(result.merged).toBeNull();
    });
  });

  describe("evaluateChange", () => {
    it("drops a file that already matches canonical HEAD verbatim", async () => {
      const decision = await evaluateChange({
        ours: buf("same\n"),
        theirs: buf("same\n"),
        base: baseWith("different\n"),
      });

      expect(decision.kind).toBe("drop");
    });

    it("proposes local content when canonical has not moved since the sync", async () => {
      const decision = await evaluateChange({
        ours: buf("local edit\n"),
        theirs: buf("original\n"),
        base: baseWith("original\n"),
      });

      expect(decision).toEqual({ kind: "propose", content: buf("local edit\n"), rebased: false });
    });

    it("drops a file the local repo never touched, even when canonical moved", async () => {
      // The reverting case: ours is still the base, so every difference from
      // HEAD belongs to canonical. Proposing ours would undo it.
      const decision = await evaluateChange({
        ours: buf("original\n"),
        theirs: buf("upstream edit\n"),
        base: baseWith("original\n"),
      });

      expect(decision.kind).toBe("drop");
    });

    it("merges when both sides changed different regions", async () => {
      const decision = await evaluateChange({
        ours: buf("HEADER\nbody\nfooter\n"),
        theirs: buf("header\nbody\nFOOTER\n"),
        base: baseWith("header\nbody\nfooter\n"),
      });

      expect(decision.kind).toBe("propose");
      if (decision.kind !== "propose") return;
      expect(decision.rebased).toBe(true);
      expect(decision.content.toString("utf-8")).toBe("HEADER\nbody\nFOOTER\n");
    });

    it("conflicts when both sides changed the same region", async () => {
      const decision = await evaluateChange({
        ours: buf("local wins\n"),
        theirs: buf("canonical wins\n"),
        base: baseWith("original\n"),
      });

      expect(decision.kind).toBe("conflict");
    });

    it("proposes an addition when the path exists in neither base nor HEAD", async () => {
      const decision = await evaluateChange({
        ours: buf("brand new\n"),
        theirs: null,
        base: baseWith(null),
      });

      expect(decision).toEqual({ kind: "propose", content: buf("brand new\n"), rebased: false });
    });

    it("conflicts when canonical deleted the file after the sync", async () => {
      const decision = await evaluateChange({
        ours: buf("still here\n"),
        theirs: null,
        base: baseWith("still here upstream\n"),
      });

      expect(decision.kind).toBe("conflict");
      if (decision.kind !== "conflict") return;
      expect(decision.reason).toContain("deleted in canonical");
    });

    it("conflicts when canonical added a different file at the same path", async () => {
      const decision = await evaluateChange({
        ours: buf("our version\n"),
        theirs: buf("their version\n"),
        base: baseWith(null),
      });

      expect(decision.kind).toBe("conflict");
      if (decision.kind !== "conflict") return;
      expect(decision.reason).toContain("added in canonical");
    });

    describe("without a resolvable merge base", () => {
      it("conflicts when the embedded hash proves canonical moved", async () => {
        const decision = await evaluateChange({
          ours: buf("local edit\n"),
          theirs: buf("upstream edit\n"),
          base: NO_BASE,
          upstreamMoved: true,
        });

        expect(decision.kind).toBe("conflict");
        if (decision.kind !== "conflict") return;
        expect(decision.reason).toContain("merge base is unavailable");
      });

      it("proposes when the embedded hash proves canonical did not move", async () => {
        const decision = await evaluateChange({
          ours: buf("local edit\n"),
          theirs: buf("original\n"),
          base: NO_BASE,
          upstreamMoved: false,
        });

        expect(decision.kind).toBe("propose");
      });

      it("proposes when there is no staleness signal at all", async () => {
        // Skill assets carry no metadata, so nothing can be proven either way.
        const decision = await evaluateChange({
          ours: buf("asset\n"),
          theirs: buf("other asset\n"),
          base: NO_BASE,
        });

        expect(decision.kind).toBe("propose");
      });
    });
  });

  describe("resolveMergeBase", () => {
    let repoDir: string;

    beforeEach(async () => {
      repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-base-test-"));
      execSync("git init", { cwd: repoDir, stdio: "ignore" });
      execSync("git config user.email t@t.com", { cwd: repoDir, stdio: "ignore" });
      execSync("git config user.name Test", { cwd: repoDir, stdio: "ignore" });
    });

    afterEach(async () => {
      await fs.rm(repoDir, { recursive: true, force: true });
    });

    function commit(message: string): string {
      execSync(`git add -A && git commit -m ${message}`, { cwd: repoDir, stdio: "ignore" });
      return execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim();
    }

    it("returns the content the path had at the given commit", async () => {
      await fs.writeFile(path.join(repoDir, "a.md"), "first\n", "utf-8");
      const sha = commit("one");
      await fs.writeFile(path.join(repoDir, "a.md"), "second\n", "utf-8");
      commit("two");

      const base = await resolveMergeBase(
        repoDir,
        { type: "local", path: repoDir, commit_sha: sha },
        "a.md",
      );

      expect(base.available).toBe(true);
      expect(base.content?.toString("utf-8")).toBe("first\n");
    });

    it("reports available-but-absent when the file postdates the commit", async () => {
      await fs.writeFile(path.join(repoDir, "a.md"), "first\n", "utf-8");
      const sha = commit("one");
      await fs.writeFile(path.join(repoDir, "b.md"), "new file\n", "utf-8");
      commit("two");

      const base = await resolveMergeBase(
        repoDir,
        { type: "local", path: repoDir, commit_sha: sha },
        "b.md",
      );

      expect(base).toEqual({ available: true, content: null });
    });

    it("reports unavailable when the lockfile has no commit sha", async () => {
      await fs.writeFile(path.join(repoDir, "a.md"), "first\n", "utf-8");
      commit("one");

      const base = await resolveMergeBase(repoDir, { type: "local", path: repoDir }, "a.md");

      expect(base.available).toBe(false);
    });

    it("reports unavailable when the commit is not in this clone", async () => {
      await fs.writeFile(path.join(repoDir, "a.md"), "first\n", "utf-8");
      commit("one");

      const base = await resolveMergeBase(
        repoDir,
        { type: "local", path: repoDir, commit_sha: "0".repeat(40) },
        "a.md",
      );

      expect(base.available).toBe(false);
    });
  });

  describe("StaleBaseError", () => {
    it("carries the conflicts and counts them in the message", () => {
      const error = new StaleBaseError([
        {
          downstreamPath: ".claude/skills/a/SKILL.md",
          canonicalPath: "skills/a/SKILL.md",
          reason: "overlap",
        },
      ]);

      expect(error.name).toBe("StaleBaseError");
      expect(error.conflicts).toHaveLength(1);
      expect(error.message).toContain("1 file(s)");
    });
  });
});
