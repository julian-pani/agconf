import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import { toMetadataPrefix } from "../utils/prefix.js";
import {
  frontmatterIsSimple,
  parseFrontmatter as parseFrontmatterShared,
  serializeFrontmatter,
} from "./frontmatter.js";
import {
  hasGlobalBlockChanges,
  hasRulesSectionChanges,
  isAgentsMdManaged,
  type MarkerOptions,
  parseAgentsMd,
  parseGlobalBlockMetadata,
  parseRulesSection,
} from "./markers.js";

// Default metadata prefix
const DEFAULT_METADATA_PREFIX = "agconf";

/**
 * Options for metadata operations.
 */
export interface MetadataOptions extends MarkerOptions {
  /** Prefix for metadata keys (default: "agconf") */
  metadataPrefix?: string;
}

/**
 * Generate metadata key names based on the configured prefix.
 * Used in skill frontmatter to track managed content.
 *
 * - `content_hash` covers the file's own body (frontmatter-stripped).
 * - `assets_hash` covers sibling files that share the file's managed status
 *   but have no frontmatter of their own — e.g. for SKILL.md it covers the
 *   `references/`, `scripts/`, etc. files inside the skill directory.
 *   The field is generic so other "metadata file + sibling assets" patterns
 *   added later can reuse it.
 */
export function getMetadataKeys(prefix: string = DEFAULT_METADATA_PREFIX) {
  const keyPrefix = toMetadataPrefix(prefix);
  return {
    managed: `${keyPrefix}_managed`,
    contentHash: `${keyPrefix}_content_hash`,
    assetsHash: `${keyPrefix}_assets_hash`,
  };
}

/**
 * Metadata fields added to synced skill files.
 * These are stored under the `metadata` key in YAML frontmatter.
 *
 * Note: Source and sync timestamp are tracked in lockfile
 * to avoid unnecessary file changes on every sync.
 */
/**
 * Parse YAML frontmatter from markdown content.
 * Returns the frontmatter object and the body content.
 *
 * Note: This wrapper ensures backward compatibility by returning
 * an empty object instead of null when no frontmatter exists.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
} {
  const result = parseFrontmatterShared(content);
  return {
    frontmatter: result.frontmatter ?? {},
    body: result.body,
    raw: result.raw,
  };
}

/**
 * Validation error for skill frontmatter.
 */
export interface SkillValidationError {
  skillName: string;
  path: string;
  errors: string[];
}

/**
 * Validate that a skill file has required frontmatter fields.
 * Returns validation errors if any required fields are missing.
 */
export function validateSkillFrontmatter(
  content: string,
  skillName: string,
  filePath: string,
): SkillValidationError | null {
  const { frontmatter } = parseFrontmatter(content);
  const errors: string[] = [];

  // Check for frontmatter existence
  if (Object.keys(frontmatter).length === 0) {
    errors.push("Missing frontmatter (must have --- delimiters)");
  } else {
    // Check for required fields
    if (!frontmatter.name) {
      errors.push("Missing required field: name");
    }
    if (!frontmatter.description) {
      errors.push("Missing required field: description");
    }
  }

  if (errors.length > 0) {
    return { skillName, path: filePath, errors };
  }
  return null;
}

/**
 * Compute content hash excluding managed metadata.
 * This allows detecting manual changes to synced files.
 */
export function computeContentHash(content: string, options: MetadataOptions = {}): string {
  const stripped = stripManagedMetadata(content, options);
  const hash = createHash("sha256").update(stripped).digest("hex");
  return `sha256:${hash.slice(0, 12)}`;
}

/**
 * Compute an aggregate content hash for a directory's "asset" files.
 *
 * Used to detect manual modifications to files that travel alongside a
 * metadata-bearing file (e.g. SKILL.md + references/foo.py). Paths in
 * `excludeFiles` are skipped — typically the metadata file itself.
 *
 * Hash inputs are sorted POSIX-style for cross-platform stability and each
 * file contributes both its relative path and its raw bytes, separated by
 * NUL bytes so a rename can't collide with a content edit.
 *
 * Returns an empty string when the directory has no asset files. An empty
 * hash means "no assets to track" and should be treated as "no mismatch
 * possible" by callers.
 */
export async function computeAssetsHash(dir: string, excludeFiles: string[] = []): Promise<string> {
  const skip = new Set(excludeFiles.map((f) => f.split(path.sep).join("/")));

  let files: string[];
  try {
    files = await fg("**/*", { cwd: dir, onlyFiles: true, dot: true });
  } catch {
    return "";
  }

  const relevant = files
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => !skip.has(f))
    .sort();

  if (relevant.length === 0) return "";

  const hash = createHash("sha256");
  for (const relPath of relevant) {
    const bytes = await fs.readFile(path.join(dir, relPath));
    hash.update(relPath);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex").slice(0, 12)}`;
}

/**
 * Compare the assets_hash recorded in a managed file's frontmatter against
 * the current contents of its asset directory.
 *
 * Returns `false` when the file has no recorded assets_hash (no tracking),
 * or when the recorded hash matches the live directory contents.
 */
export async function hasModifiedAssets(
  content: string,
  assetDir: string,
  excludeFiles: string[] = [],
  options: MetadataOptions = {},
): Promise<boolean> {
  const { metadataPrefix = DEFAULT_METADATA_PREFIX } = options;
  const { frontmatter } = parseFrontmatter(content);

  if (!frontmatter.metadata || typeof frontmatter.metadata !== "object") {
    return false;
  }

  const metadata = frontmatter.metadata as Record<string, string>;
  const keys = getMetadataKeys(metadataPrefix);
  const storedHash = metadata[keys.assetsHash];
  if (!storedHash) return false;

  const currentHash = await computeAssetsHash(assetDir, excludeFiles);
  return storedHash !== currentHash;
}

/**
 * Strip managed metadata from content for hashing purposes.
 * Removes metadata fields with the configured prefix.
 */
export function stripManagedMetadata(content: string, options: MetadataOptions = {}): string {
  const { metadataPrefix = DEFAULT_METADATA_PREFIX } = options;
  const { frontmatter, body } = parseFrontmatter(content);

  if (Object.keys(frontmatter).length === 0) {
    return content;
  }

  // Get the key prefix (convert dashes to underscores for key names)
  const keyPrefix = `${toMetadataPrefix(metadataPrefix)}_`;

  // Remove managed fields from metadata
  if (frontmatter.metadata && typeof frontmatter.metadata === "object") {
    const metadata = frontmatter.metadata as Record<string, string>;
    const cleanedMetadata: Record<string, string> = {};

    for (const [key, value] of Object.entries(metadata)) {
      // Skip keys with configured prefix
      if (!key.startsWith(keyPrefix)) {
        cleanedMetadata[key] = value;
      }
    }

    if (Object.keys(cleanedMetadata).length > 0) {
      frontmatter.metadata = cleanedMetadata;
    } else {
      delete frontmatter.metadata;
    }
  }

  // If frontmatter is now empty after stripping, return just the body
  // This ensures content that originally had no frontmatter hashes the same
  // after having managed metadata added and then stripped
  if (Object.keys(frontmatter).length === 0) {
    return body;
  }

  // Rebuild content with remaining frontmatter
  const yamlContent = serializeFrontmatter(frontmatter);
  return `---\n${yamlContent}\n---\n${body}`;
}

/**
 * Add managed metadata to a skill file content.
 * Adds the managed flag, the file's own content hash, and (optionally) an
 * aggregate hash covering associated asset files so `check` can detect
 * tampering of sibling files (references/, scripts/, ...).
 * Source/timestamp live in the lockfile, not here.
 */
export function addManagedMetadata(
  content: string,
  options: MetadataOptions & { assetsHash?: string } = {},
): string {
  const { metadataPrefix = DEFAULT_METADATA_PREFIX, assetsHash } = options;
  const { frontmatter, body } = parseFrontmatter(content);

  // Compute hash of original content (without any existing managed metadata)
  const contentHash = computeContentHash(content, options);

  // Ensure metadata object exists
  if (!frontmatter.metadata || typeof frontmatter.metadata !== "object") {
    frontmatter.metadata = {};
  }

  const metadata = frontmatter.metadata as Record<string, string>;
  const keys = getMetadataKeys(metadataPrefix);

  // Add managed fields (only managed flag and hash - source/timestamp in lockfile)
  metadata[keys.managed] = "true";
  metadata[keys.contentHash] = contentHash;
  if (assetsHash !== undefined && assetsHash !== "") {
    metadata[keys.assetsHash] = assetsHash;
  }

  // Rebuild content
  const yamlContent = serializeFrontmatter(frontmatter);
  return `---\n${yamlContent}\n---\n${body}`;
}

/**
 * Check if a file has been manually modified since last sync.
 * Returns true if the content hash doesn't match.
 */
export function hasManualChanges(content: string, options: MetadataOptions = {}): boolean {
  const { metadataPrefix = DEFAULT_METADATA_PREFIX } = options;
  const { frontmatter } = parseFrontmatter(content);

  if (!frontmatter.metadata || typeof frontmatter.metadata !== "object") {
    return false; // No metadata means not managed
  }

  const metadata = frontmatter.metadata as Record<string, string>;
  const keys = getMetadataKeys(metadataPrefix);
  const storedHash = metadata[keys.contentHash];

  if (!storedHash) {
    return false; // No hash stored
  }

  const currentHash = computeContentHash(content, options);
  return storedHash !== currentHash;
}

/**
 * Check if a file is managed by agconf.
 */
export function isManaged(content: string, options: MetadataOptions = {}): boolean {
  const { metadataPrefix = DEFAULT_METADATA_PREFIX } = options;
  const { frontmatter } = parseFrontmatter(content);

  if (!frontmatter.metadata || typeof frontmatter.metadata !== "object") {
    return false;
  }

  const metadata = frontmatter.metadata as Record<string, string>;
  const keys = getMetadataKeys(metadataPrefix);
  return metadata[keys.managed] === "true";
}

/**
 * True when a downstream skill directory is byte-identical to its canonical
 * counterpart: SKILL.md compared with managed metadata stripped from both
 * sides, every other file compared byte-for-byte, and the file sets must match
 * exactly. Lets callers tell a pending round-trip (safe to adopt) from a real
 * conflict (would lose local content). Shared by `sync`'s overwrite guard and
 * `propose --new`'s collision classification.
 */
export async function skillMatchesCanonical(
  localDir: string,
  canonicalDir: string,
  options: MetadataOptions = {},
): Promise<boolean> {
  const list = async (dir: string): Promise<string[]> => {
    try {
      return (await fg("**/*", { cwd: dir, onlyFiles: true, dot: true }))
        .map((p) => p.split(path.sep).join("/"))
        .sort();
    } catch {
      return [];
    }
  };
  const localFiles = await list(localDir);
  const canonFiles = await list(canonicalDir);
  if (localFiles.length !== canonFiles.length) return false;
  if (localFiles.join("\n") !== canonFiles.join("\n")) return false;

  for (const rel of localFiles) {
    const lp = path.join(localDir, rel);
    const cp = path.join(canonicalDir, rel);
    if (rel === "SKILL.md") {
      const [l, c] = await Promise.all([fs.readFile(lp, "utf-8"), fs.readFile(cp, "utf-8")]);
      if (!markdownContentMatches(l, c, options)) return false;
    } else {
      const [l, c] = await Promise.all([fs.readFile(lp), fs.readFile(cp)]);
      if (!l.equals(c)) return false;
    }
  }
  return true;
}

/**
 * True when a single downstream markdown file (rule or agent) matches its
 * canonical counterpart once managed metadata is stripped from both sides.
 */
export async function fileMatchesCanonical(
  localPath: string,
  canonicalPath: string,
  options: MetadataOptions = {},
): Promise<boolean> {
  const [l, c] = await Promise.all([
    fs.readFile(localPath, "utf-8"),
    fs.readFile(canonicalPath, "utf-8"),
  ]);
  return markdownContentMatches(l, c, options);
}

/**
 * Decide whether two markdown files are equivalent for the purpose of "safe to
 * overwrite/adopt one with the other". Bodies are preserved verbatim by
 * `stripManagedMetadata`, so the only data-loss risk is in frontmatter the
 * hand-rolled YAML parser cannot represent. We therefore only trust the
 * metadata-stripped comparison when BOTH files' frontmatter is parser-faithful
 * (`frontmatterIsSimple`); otherwise we require strict byte equality, erring
 * toward "different" (a safe conflict) rather than a false match (silent loss).
 */
function markdownContentMatches(
  local: string,
  canonical: string,
  options: MetadataOptions,
): boolean {
  if (local === canonical) return true;
  if (!frontmatterIsSimple(local) || !frontmatterIsSimple(canonical)) return false;
  return stripManagedMetadata(local, options) === stripManagedMetadata(canonical, options);
}

/**
 * Result of checking a skill file for modifications.
 */
interface SkillFileCheckResult {
  /** Relative path to the skill file */
  path: string;
  /** Skill name (directory name) */
  skillName: string;
  /** Whether the file is managed by agconf */
  isManaged: boolean;
  /** True if either the SKILL.md body OR its sibling asset files were modified */
  hasChanges: boolean;
  /** True if the SKILL.md body itself was modified (content_hash mismatch) */
  contentChanged: boolean;
  /** True if sibling asset files were modified (assets_hash mismatch) */
  assetsChanged: boolean;
}

/**
 * Check all synced skill files in a target directory for manual modifications.
 * Reports modifications to SKILL.md (via content_hash) and to its sibling
 * asset files (via assets_hash) — both detected locally with no canonical
 * access required.
 */
export async function checkSkillFiles(
  targetDir: string,
  targets: string[] = ["claude"],
  options: MetadataOptions = {},
): Promise<SkillFileCheckResult[]> {
  const results: SkillFileCheckResult[] = [];

  for (const target of targets) {
    const skillsDir = path.join(targetDir, `.${target}`, "skills");

    // Check if skills directory exists
    try {
      await fs.access(skillsDir);
    } catch {
      // Expected: skills directory may not exist for this target
      continue;
    }

    // Find all SKILL.md files
    const skillFiles = await fg("*/SKILL.md", {
      cwd: skillsDir,
      absolute: false,
    });

    for (const skillFile of skillFiles) {
      const fullPath = path.join(skillsDir, skillFile);
      const skillName = path.dirname(skillFile);
      const skillDir = path.join(skillsDir, skillName);
      const relativePath = path.join(`.${target}`, "skills", skillFile);

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const fileIsManaged = isManaged(content, options);

        const contentChanged = fileIsManaged && hasManualChanges(content, options);
        const assetsChanged =
          fileIsManaged && (await hasModifiedAssets(content, skillDir, ["SKILL.md"], options));

        results.push({
          path: relativePath,
          skillName,
          isManaged: fileIsManaged,
          hasChanges: contentChanged || assetsChanged,
          contentChanged,
          assetsChanged,
        });
      } catch (_error) {
        // Expected: file read may fail, skip this skill file
      }
    }
  }

  return results;
}

/**
 * Check all synced rule files in a target directory for manual modifications.
 * Returns information about each managed rule file found.
 */
export async function checkRuleFiles(
  targetDir: string,
  targets: string[] = ["claude"],
  options: MetadataOptions = {},
): Promise<RuleFileCheckResult[]> {
  const results: RuleFileCheckResult[] = [];

  for (const target of targets) {
    const rulesDir = path.join(targetDir, `.${target}`, "rules");

    // Check if rules directory exists
    try {
      await fs.access(rulesDir);
    } catch {
      // Expected: rules directory may not exist for this target
      continue;
    }

    // Find all .md files recursively
    const ruleFiles = await fg("**/*.md", {
      cwd: rulesDir,
      absolute: false,
    });

    for (const ruleFile of ruleFiles) {
      const fullPath = path.join(rulesDir, ruleFile);
      const relativePath = path.join(`.${target}`, "rules", ruleFile);

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const fileIsManaged = isManaged(content, options);
        const hasChanges = fileIsManaged && hasManualChanges(content, options);

        // Extract rulePath from metadata if available
        const { frontmatter } = parseFrontmatter(content);
        const metadata = frontmatter.metadata as Record<string, string> | undefined;
        const keyPrefix = toMetadataPrefix(options.metadataPrefix || "agconf");
        const rulePath = metadata?.[`${keyPrefix}_source_path`] || ruleFile;

        results.push({
          path: relativePath,
          rulePath,
          isManaged: fileIsManaged,
          hasChanges,
        });
      } catch (_error) {
        // Expected: file read may fail, skip this rule file
      }
    }
  }

  return results;
}

/**
 * Result of checking a managed file for modifications.
 * Used for skill files, rule files, agent files, and AGENTS.md.
 */
export interface ManagedFileCheckResult {
  /** Relative path to the file */
  path: string;
  /** Type of file */
  type: "skill" | "agents" | "rule" | "rules-section" | "agent";
  /** Skill name if type is skill */
  skillName?: string;
  /** Rule source path if type is rule (e.g., "security/auth.md") */
  rulePath?: string;
  /** Agent path if type is agent (e.g., "code-reviewer.md") */
  agentPath?: string;
  /** Whether the file is managed by agconf */
  isManaged: boolean;
  /** Whether the file has been manually modified */
  hasChanges: boolean;
  /** For skill: whether SKILL.md body itself was modified */
  contentChanged?: boolean;
  /** For skill: whether sibling assets (references/, scripts/, ...) were modified */
  assetsChanged?: boolean;
  /** Source info from the file's metadata */
  source?: string;
  /** When the file was synced */
  syncedAt?: string;
}

/**
 * Result of checking a rule file for modifications.
 */
interface RuleFileCheckResult {
  /** Relative path to the rule file (from target dir) */
  path: string;
  /** Original rule path (e.g., "security/auth.md") */
  rulePath: string;
  /** Whether the file is managed by agconf */
  isManaged: boolean;
  /** Whether the file has been manually modified */
  hasChanges: boolean;
}

/**
 * Result of checking an agent file for modifications.
 */
interface AgentFileCheckResult {
  /** Relative path to the agent file (from target dir) */
  path: string;
  /** Agent file name (e.g., "code-reviewer.md") */
  agentPath: string;
  /** Whether the file is managed by agconf */
  isManaged: boolean;
  /** Whether the file has been manually modified */
  hasChanges: boolean;
}

/**
 * Check all synced agent files in a target directory for manual modifications.
 * Returns information about each managed agent file found.
 */
export async function checkAgentFiles(
  targetDir: string,
  options: MetadataOptions = {},
): Promise<AgentFileCheckResult[]> {
  const results: AgentFileCheckResult[] = [];

  // Agents are only synced to Claude target
  const agentsDir = path.join(targetDir, ".claude", "agents");

  // Check if agents directory exists
  try {
    await fs.access(agentsDir);
  } catch {
    // Expected: agents directory may not exist
    return results;
  }

  // Find all .md files (agents are flat, not nested)
  const agentFiles = await fg("*.md", {
    cwd: agentsDir,
    absolute: false,
  });

  for (const agentFile of agentFiles) {
    const fullPath = path.join(agentsDir, agentFile);
    const relativePath = path.join(".claude", "agents", agentFile);

    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const fileIsManaged = isManaged(content, options);
      const hasChanges = fileIsManaged && hasManualChanges(content, options);

      results.push({
        path: relativePath,
        agentPath: agentFile,
        isManaged: fileIsManaged,
        hasChanges,
      });
    } catch (_error) {
      // Expected: file read may fail, skip this agent file
    }
  }

  return results;
}

/**
 * Check AGENTS.md for manual modifications.
 */
export async function checkAgentsMd(
  targetDir: string,
  options: MarkerOptions = {},
): Promise<ManagedFileCheckResult | null> {
  const agentsMdPath = path.join(targetDir, "AGENTS.md");

  try {
    const content = await fs.readFile(agentsMdPath, "utf-8");
    const managed = isAgentsMdManaged(content, options);

    if (!managed) {
      return null;
    }

    const hasChanges = hasGlobalBlockChanges(content, options);

    // Extract metadata
    const parsed = parseAgentsMd(content, options);
    let source: string | undefined;
    let syncedAt: string | undefined;

    if (parsed.globalBlock) {
      const metadata = parseGlobalBlockMetadata(parsed.globalBlock);
      source = metadata.source;
      syncedAt = metadata.syncedAt;
    }

    const result: ManagedFileCheckResult = {
      path: "AGENTS.md",
      type: "agents",
      isManaged: managed,
      hasChanges,
    };
    if (source !== undefined) result.source = source;
    if (syncedAt !== undefined) result.syncedAt = syncedAt;
    return result;
  } catch {
    // Expected: AGENTS.md may not exist or can't be read
    return null;
  }
}

/** Options for checking managed files */
export interface CheckManagedFilesOptions {
  /** Marker prefix for AGENTS.md (default: "agconf") */
  markerPrefix?: string;
  /** Metadata prefix for skill files (default: "agconf") */
  metadataPrefix?: string;
}

/**
 * Check all managed files (skills, rules, and AGENTS.md) for modifications.
 */
export async function checkAllManagedFiles(
  targetDir: string,
  targets: string[] = ["claude"],
  options: CheckManagedFilesOptions = {},
): Promise<ManagedFileCheckResult[]> {
  const results: ManagedFileCheckResult[] = [];
  const markerOptions = options.markerPrefix ? { prefix: options.markerPrefix } : {};
  const metadataOptions = options.metadataPrefix ? { metadataPrefix: options.metadataPrefix } : {};

  // Check AGENTS.md global block
  const agentsMdResult = await checkAgentsMd(targetDir, markerOptions);
  if (agentsMdResult) {
    results.push(agentsMdResult);
  }

  // Check AGENTS.md rules section (for Codex target where rules are concatenated)
  const rulesSectionResult = await checkAgentsMdRulesSection(targetDir, markerOptions);
  if (rulesSectionResult) {
    results.push(rulesSectionResult);
  }

  // Check skill files
  const skillFiles = await checkSkillFiles(targetDir, targets, metadataOptions);
  for (const skill of skillFiles) {
    if (skill.isManaged) {
      results.push({
        path: skill.path,
        type: "skill",
        skillName: skill.skillName,
        isManaged: skill.isManaged,
        hasChanges: skill.hasChanges,
        contentChanged: skill.contentChanged,
        assetsChanged: skill.assetsChanged,
      });
    }
  }

  // Check rule files (for Claude target where rules are separate files)
  const ruleFiles = await checkRuleFiles(targetDir, targets, metadataOptions);
  for (const rule of ruleFiles) {
    if (rule.isManaged) {
      results.push({
        path: rule.path,
        type: "rule",
        rulePath: rule.rulePath,
        isManaged: rule.isManaged,
        hasChanges: rule.hasChanges,
      });
    }
  }

  // Check agent files (for Claude target only)
  if (targets.includes("claude")) {
    const agentFiles = await checkAgentFiles(targetDir, metadataOptions);
    for (const agent of agentFiles) {
      if (agent.isManaged) {
        results.push({
          path: agent.path,
          type: "agent",
          agentPath: agent.agentPath,
          isManaged: agent.isManaged,
          hasChanges: agent.hasChanges,
        });
      }
    }
  }

  return results;
}

/**
 * Check AGENTS.md rules section for manual modifications.
 * This is used for Codex target where rules are concatenated into AGENTS.md.
 */
export async function checkAgentsMdRulesSection(
  targetDir: string,
  options: MarkerOptions = {},
): Promise<ManagedFileCheckResult | null> {
  const agentsMdPath = path.join(targetDir, "AGENTS.md");

  try {
    const content = await fs.readFile(agentsMdPath, "utf-8");
    const parsed = parseRulesSection(content, options);

    if (!parsed.hasMarkers || !parsed.content) {
      return null; // No rules section
    }

    const hasChanges = hasRulesSectionChanges(content, options);

    return {
      path: "AGENTS.md",
      type: "rules-section",
      isManaged: true,
      hasChanges,
    };
  } catch {
    // Expected: AGENTS.md may not exist or can't be read
    return null;
  }
}

/**
 * Get all modified managed files (skills and AGENTS.md).
 */
export async function getModifiedManagedFiles(
  targetDir: string,
  targets: string[] = ["claude"],
  options: CheckManagedFilesOptions = {},
): Promise<ManagedFileCheckResult[]> {
  const allFiles = await checkAllManagedFiles(targetDir, targets, options);
  return allFiles.filter((f) => f.hasChanges);
}
