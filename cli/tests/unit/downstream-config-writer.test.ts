import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDownstreamConfig, setWorkflowCommitStrategy } from "../../src/config/loader.js";

describe("setWorkflowCommitStrategy", () => {
  let repo: string;
  const configPath = () => path.join(repo, ".agconf", "config.yaml");

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-cs-"));
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("creates .agconf/config.yaml when absent", async () => {
    await setWorkflowCommitStrategy(repo, "direct");

    expect((await loadDownstreamConfig(repo))?.workflow?.commit_strategy).toBe("direct");
  });

  it("preserves comments and other keys", async () => {
    await fs.mkdir(path.dirname(configPath()), { recursive: true });
    await fs.writeFile(
      configPath(),
      "# keep me\ndelivery:\n  skills: plugin\nworkflow:\n  reviewers: alice\n",
      "utf-8",
    );

    await setWorkflowCommitStrategy(repo, "direct");

    const raw = await fs.readFile(configPath(), "utf-8");
    expect(raw).toContain("# keep me");
    const config = await loadDownstreamConfig(repo);
    expect(config?.delivery?.skills).toBe("plugin");
    expect(config?.workflow).toMatchObject({ reviewers: "alice", commit_strategy: "direct" });
  });

  it("overwrites an existing strategy", async () => {
    await setWorkflowCommitStrategy(repo, "direct");
    await setWorkflowCommitStrategy(repo, "pr");

    expect((await loadDownstreamConfig(repo))?.workflow?.commit_strategy).toBe("pr");
  });
});
