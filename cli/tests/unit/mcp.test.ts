import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverMcpServers, parseMcpServer, validateMcpServer } from "../../src/core/mcp.js";

const STDIO_SERVER = JSON.stringify({ command: "docs-mcp", args: ["--stdio"] });
const HTTP_SERVER = JSON.stringify({ url: "https://example.com/mcp", bearer_token_env_var: "TOK" });
const NAMED_SERVER = JSON.stringify({ name: "custom-name", command: "x" });

describe("parseMcpServer", () => {
  it("derives the server name from the filename stem", () => {
    const server = parseMcpServer(STDIO_SERVER, "figma.json");
    expect(server.name).toBe("figma");
    expect(server.relativePath).toBe("figma.json");
    expect(server.config).toEqual({ command: "docs-mcp", args: ["--stdio"] });
  });

  it("honors an explicit name field and strips it from the config", () => {
    const server = parseMcpServer(NAMED_SERVER, "ignored.json");
    expect(server.name).toBe("custom-name");
    expect(server.config).toEqual({ command: "x" });
    expect(server.config).not.toHaveProperty("name");
  });

  it("returns an empty config for malformed JSON", () => {
    const server = parseMcpServer("{not json", "broken.json");
    expect(server.name).toBe("broken");
    expect(server.config).toEqual({});
  });

  it("returns an empty config for a non-object payload", () => {
    const server = parseMcpServer("[1,2,3]", "arr.json");
    expect(server.config).toEqual({});
  });
});

describe("validateMcpServer", () => {
  it("accepts a stdio server with a command", () => {
    expect(validateMcpServer(STDIO_SERVER, "a.json")).toBeNull();
  });

  it("accepts an http server with a url", () => {
    expect(validateMcpServer(HTTP_SERVER, "b.json")).toBeNull();
  });

  it("rejects invalid JSON", () => {
    const err = validateMcpServer("{bad", "c.json");
    expect(err).not.toBeNull();
    expect(err?.errors).toContain("Invalid JSON");
  });

  it("rejects a non-object payload", () => {
    const err = validateMcpServer('"hello"', "d.json");
    expect(err?.errors[0]).toMatch(/must be a JSON object/);
  });

  it("rejects a server with neither command nor url", () => {
    const err = validateMcpServer(JSON.stringify({ env: {} }), "e.json");
    expect(err?.errors[0]).toMatch(/command.*url/);
  });
});

describe("discoverMcpServers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-mcp-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns an empty array when the directory does not exist", async () => {
    const servers = await discoverMcpServers(path.join(tempDir, "nope"));
    expect(servers).toEqual([]);
  });

  it("discovers flat *.json files sorted by path", async () => {
    await fs.writeFile(path.join(tempDir, "zed.json"), STDIO_SERVER);
    await fs.writeFile(path.join(tempDir, "alpha.json"), HTTP_SERVER);
    await fs.writeFile(path.join(tempDir, "notes.txt"), "ignored");

    const servers = await discoverMcpServers(tempDir);
    expect(servers.map((s) => s.name)).toEqual(["alpha", "zed"]);
  });
});
