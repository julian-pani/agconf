import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun", "volta"] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** Node version/tool managers that shim global binaries, in detection order. */
export const TOOL_MANAGERS = ["volta", "asdf", "mise"] as const;

export type ToolManager = (typeof TOOL_MANAGERS)[number];

/** Narrow an arbitrary string (e.g. a CLI flag value) to a supported manager. */
export function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

export interface DetectOptions {
  /** Explicit installer choice, e.g. from `--package-manager`. */
  override?: PackageManager;
}

export interface DetectionResult {
  name: PackageManager;
  installCommand: string;
  detectedVia: string;
  /** Set when the binary is shimmed by a Node tool manager. */
  toolManager?: ToolManager;
  /** Command that must run after the install for the new binary to be visible. */
  postInstallCommand?: string;
}

/**
 * Build the global install command for a given package manager and package.
 */
export function buildInstallCommand(pm: PackageManager, packageName: string): string {
  switch (pm) {
    case "npm":
      return `npm install -g ${packageName}@latest`;
    case "pnpm":
      return `pnpm add -g ${packageName}@latest`;
    case "yarn":
      return `yarn global add ${packageName}@latest`;
    case "bun":
      return `bun install -g ${packageName}@latest`;
    case "volta":
      return `volta install ${packageName}@latest`;
  }
}

/**
 * Command that republishes a tool manager's shims after a global install.
 * Volta writes its own shims during `volta install`, so it needs none.
 */
export function buildReshimCommand(tm: ToolManager): string | null {
  switch (tm) {
    case "volta":
      return null;
    // No plugin argument: `asdf reshim <plugin>` fails when that plugin is not
    // installed, and agconf cannot know which plugin provides the user's Node.
    case "asdf":
      return "asdf reshim";
    case "mise":
      return "mise reshim";
  }
}

/** Resolve the running binary through any symlinks, or null if unavailable. */
function resolveBinaryRealPath(): string | null {
  try {
    const binPath = process.argv[1];
    if (!binPath) return null;
    return fs.realpathSync(binPath);
  } catch {
    // realpathSync can fail if the symlink is broken
    return null;
  }
}

/** Environment variable naming each tool manager's install root, when set. */
const TOOL_MANAGER_HOME_VARS: Record<ToolManager, string> = {
  volta: "VOLTA_HOME",
  asdf: "ASDF_DATA_DIR",
  mise: "MISE_DATA_DIR",
};

/** True when `candidate` is the normalized directory `root` or lives under it. */
function isUnder(candidate: string, root: string): boolean {
  const normalized = path.resolve(root);
  return candidate === normalized || candidate.startsWith(normalized + path.sep);
}

/**
 * Whether a resolved binary path lives inside a tool manager's install root.
 *
 * Matching is per path *segment* rather than a bare substring, so an unrelated
 * directory that merely contains the name cannot masquerade as an install root.
 * Both the dotted home layout (`~/.asdf`) and the XDG one
 * (`~/.local/share/asdf`, `$XDG_DATA_HOME/asdf`) count, plus the manager's own
 * home variable when the user has relocated it.
 */
function pathBelongsTo(realPath: string, manager: ToolManager): boolean {
  const envRoot = process.env[TOOL_MANAGER_HOME_VARS[manager]];
  if (envRoot && isUnder(realPath, envRoot)) return true;

  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome && isUnder(realPath, path.join(xdgDataHome, manager))) return true;

  const segments = realPath.split(path.sep);
  if (segments.includes(`.${manager}`)) return true;

  return segments.some(
    (segment, i) =>
      segment === manager && segments[i - 1] === "share" && segments[i - 2] === ".local",
  );
}

/**
 * Detect a Node tool manager (volta/asdf/mise) from the resolved binary path.
 * These shim global binaries, so they dictate how an upgrade must be applied
 * regardless of which package manager wrote the package.
 */
export function detectToolManager(): ToolManager | null {
  const realPath = resolveBinaryRealPath();
  if (!realPath) return null;

  for (const manager of TOOL_MANAGERS) {
    if (pathBelongsTo(realPath, manager)) return manager;
  }

  return null;
}

/**
 * Tier 1: Check process.env.npm_config_user_agent.
 * Set when running via `npx`, `pnpm exec`, `yarn dlx`, etc.
 */
export function detectFromUserAgent(): PackageManager | null {
  const ua = process.env.npm_config_user_agent;
  if (!ua) return null;

  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("yarn/")) return "yarn";
  if (ua.startsWith("bun/")) return "bun";
  if (ua.startsWith("npm/")) return "npm";

  return null;
}

/**
 * Tier 2: Resolve the binary's real path and pattern-match.
 * Global installs leave distinctive path segments per PM.
 */
export function detectFromBinaryPath(): PackageManager | null {
  const realPath = resolveBinaryRealPath();
  if (!realPath) return null;

  if (realPath.includes("/.pnpm-global/") || realPath.includes("/node_modules/.pnpm/")) {
    return "pnpm";
  }
  if (realPath.includes("/.bun/")) {
    return "bun";
  }
  if (realPath.includes("/.yarn/") || realPath.includes("/yarn/global/")) {
    return "yarn";
  }

  return null;
}

/**
 * Tier 3: Compare binary path against `npm prefix -g` output.
 * This is slower (~100ms subprocess) so it's a last resort.
 */
export function detectFromNpmPrefix(): PackageManager | null {
  try {
    const realPath = resolveBinaryRealPath();
    if (!realPath) return null;

    const npmPrefix = execSync("npm prefix -g", { encoding: "utf-8", stdio: "pipe" }).trim();

    if (realPath.startsWith(npmPrefix)) {
      return "npm";
    }
  } catch {
    // npm might not be installed or prefix command might fail
  }

  return null;
}

/**
 * Detect which package manager installed a globally-installed package.
 *
 * Tiered detection (fast to slow):
 * 0. Volta shim — `volta install` is the only upgrade path that sticks
 * 1. process.env.npm_config_user_agent (free — covers npx/pnpm exec edge case)
 * 2. Pattern-match the resolved binary path (one syscall)
 * 3. Compare against `npm prefix -g` output (one subprocess)
 * 4. Default to npm as fallback
 *
 * An asdf/mise shim does not change *which* manager installs (they wrap a
 * regular npm/pnpm/... global install), only that the shims must be rebuilt
 * afterwards — so it is reported alongside the detected manager via
 * `toolManager`/`postInstallCommand` instead of replacing it. The same holds
 * for `options.override`: it selects the installer, not the shim handling.
 */
export function detectPackageManager(
  packageName: string,
  options: DetectOptions = {},
): DetectionResult {
  const toolManager = detectToolManager();

  const withToolManager = (result: DetectionResult): DetectionResult => {
    if (!toolManager) return result;
    const postInstallCommand = buildReshimCommand(toolManager);
    return {
      ...result,
      toolManager,
      ...(postInstallCommand ? { postInstallCommand } : {}),
    };
  };

  // An explicit flag picks the installer only; a shim still has to be rebuilt.
  if (options.override) {
    return withToolManager({
      name: options.override,
      installCommand: buildInstallCommand(options.override, packageName),
      detectedVia: "--package-manager flag",
    });
  }

  // Tier 0: Volta owns its own install path
  if (toolManager === "volta") {
    return {
      name: "volta",
      installCommand: buildInstallCommand("volta", packageName),
      detectedVia: "volta shim",
      toolManager,
    };
  }

  // Tier 1: env var
  const fromEnv = detectFromUserAgent();
  if (fromEnv) {
    return withToolManager({
      name: fromEnv,
      installCommand: buildInstallCommand(fromEnv, packageName),
      detectedVia: "npm_config_user_agent",
    });
  }

  // Tier 2: binary path
  const fromPath = detectFromBinaryPath();
  if (fromPath) {
    return withToolManager({
      name: fromPath,
      installCommand: buildInstallCommand(fromPath, packageName),
      detectedVia: "binary path",
    });
  }

  // Tier 3: npm prefix
  const fromPrefix = detectFromNpmPrefix();
  if (fromPrefix) {
    return withToolManager({
      name: fromPrefix,
      installCommand: buildInstallCommand(fromPrefix, packageName),
      detectedVia: "npm global prefix",
    });
  }

  // Tier 4: fallback
  return withToolManager({
    name: "npm",
    installCommand: buildInstallCommand("npm", packageName),
    detectedVia: "default",
  });
}
