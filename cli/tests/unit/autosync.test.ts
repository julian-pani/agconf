import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUserScopeConfig } from "../../src/config/loader.js";
import {
  buildCrontab,
  CRON_MARKER,
  cronScheduleFor,
  isThrottled,
  maybeStartBackgroundAutosync,
  readAutosyncState,
  stripCrontab,
  writeAutosyncState,
} from "../../src/core/autosync.js";

describe("autosync core", () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-autosync-"));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  const writeConfig = async (yaml: string) => {
    await fs.mkdir(path.join(home, ".agconf"), { recursive: true });
    await fs.writeFile(path.join(home, ".agconf", "config.yaml"), yaml, "utf-8");
  };

  describe("loadUserScopeConfig", () => {
    it("defaults to enabled with a 10-minute interval when absent", async () => {
      const cfg = await loadUserScopeConfig(home);
      expect(cfg.autosync.enabled).toBe(true);
      expect(cfg.autosync.interval_minutes).toBe(10);
    });

    it("honors an explicit disable", async () => {
      await writeConfig("autosync:\n  enabled: false\n");
      const cfg = await loadUserScopeConfig(home);
      expect(cfg.autosync.enabled).toBe(false);
    });

    it("fills defaults for a partial config", async () => {
      await writeConfig("autosync:\n  interval_minutes: 30\n");
      const cfg = await loadUserScopeConfig(home);
      expect(cfg.autosync.enabled).toBe(true);
      expect(cfg.autosync.interval_minutes).toBe(30);
    });
  });

  describe("isThrottled", () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    it("does not throttle with no prior attempt", () => {
      expect(isThrottled(null, 10, now)).toBe(false);
      expect(isThrottled({ version: 1 }, 10, now)).toBe(false);
    });
    it("throttles within the window and not outside it", () => {
      const recent = { version: 1, last_attempt: "2026-08-06T11:55:00.000Z" }; // 5 min ago
      const old = { version: 1, last_attempt: "2026-08-06T11:40:00.000Z" }; // 20 min ago
      expect(isThrottled(recent, 10, now)).toBe(true);
      expect(isThrottled(old, 10, now)).toBe(false);
    });
  });

  describe("state round-trip", () => {
    it("writes and reads back", async () => {
      await writeAutosyncState(home, { version: 1, last_attempt: "x", last_result: "synced" });
      const state = await readAutosyncState(home);
      expect(state?.last_result).toBe("synced");
    });
  });

  describe("crontab builders", () => {
    const line = `*/10 * * * * agconf autosync --trigger cron ${CRON_MARKER}`;
    it("adds the entry to an empty crontab", () => {
      const { content, changed } = buildCrontab("", line);
      expect(changed).toBe(true);
      expect(content).toContain(CRON_MARKER);
    });
    it("preserves other entries and stays idempotent", () => {
      const withOther = "0 3 * * * backup.sh\n";
      const once = buildCrontab(withOther, line).content;
      expect(once).toContain("backup.sh");
      // Re-applying yields exactly one agconf line.
      const twice = buildCrontab(once, line).content;
      expect(twice.match(new RegExp(CRON_MARKER, "g"))?.length).toBe(1);
    });
    it("strips the entry", () => {
      const withBoth = `0 3 * * * backup.sh\n${line}\n`;
      const { content, changed } = stripCrontab(withBoth);
      expect(changed).toBe(true);
      expect(content).toContain("backup.sh");
      expect(content).not.toContain(CRON_MARKER);
    });
    it("maps intervals to schedules", () => {
      expect(cronScheduleFor(10)).toBe("*/10 * * * *");
      expect(cronScheduleFor(90)).toBe("0 * * * *");
    });
  });

  describe("maybeStartBackgroundAutosync", () => {
    it("spawns the runner when enabled", async () => {
      const spawn = vi.fn();
      const started = await maybeStartBackgroundAutosync(home, { spawn });
      expect(started).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(1);
      const args = spawn.mock.calls[0]?.[1] as string[];
      expect(args).toContain("autosync");
      expect(args).toContain("startup");
    });

    it("does nothing when disabled", async () => {
      await writeConfig("autosync:\n  enabled: false\n");
      const spawn = vi.fn();
      const started = await maybeStartBackgroundAutosync(home, { spawn });
      expect(started).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });
  });
});
