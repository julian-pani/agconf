import { describe, expect, it } from "vitest";
import {
  compareVersions,
  formatTag,
  getCliTarballUrl,
  getLatestCliTarballUrl,
  isBranchRef,
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

  describe("isBranchRef", () => {
    it("returns true for branch names", () => {
      expect(isBranchRef("master")).toBe(true);
      expect(isBranchRef("main")).toBe(true);
      expect(isBranchRef("develop")).toBe(true);
      expect(isBranchRef("feature/new-thing")).toBe(true);
    });

    it("returns false for version tags", () => {
      expect(isBranchRef("v1.0.0")).toBe(false);
      expect(isBranchRef("1.2.3")).toBe(false);
      expect(isBranchRef("v1.0.0-alpha")).toBe(false);
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

  describe("getCliTarballUrl", () => {
    const TEST_REPO = "org/agent-conf";

    it("generates correct URL for version without v prefix", () => {
      const url = getCliTarballUrl(TEST_REPO, "1.2.3");
      expect(url).toBe(
        "https://github.com/org/agent-conf/releases/download/v1.2.3/agent-conf-cli-v1.2.3.tar.gz",
      );
    });

    it("generates correct URL for version with v prefix", () => {
      const url = getCliTarballUrl(TEST_REPO, "v1.2.3");
      expect(url).toBe(
        "https://github.com/org/agent-conf/releases/download/v1.2.3/agent-conf-cli-v1.2.3.tar.gz",
      );
    });

    it("handles prerelease versions", () => {
      const url = getCliTarballUrl(TEST_REPO, "1.0.0-alpha");
      expect(url).toBe(
        "https://github.com/org/agent-conf/releases/download/v1.0.0-alpha/agent-conf-cli-v1.0.0-alpha.tar.gz",
      );
    });
  });

  describe("getLatestCliTarballUrl", () => {
    it("returns the latest release URL", () => {
      const url = getLatestCliTarballUrl("org/agent-conf");
      expect(url).toBe(
        "https://github.com/org/agent-conf/releases/latest/download/agent-conf-cli.tar.gz",
      );
    });
  });
});
