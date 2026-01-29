import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Source } from "../schemas/lockfile.js";
import { buildAgentsMd, extractRepoBlockContent, parseAgentsMd } from "./markers.js";

export interface MergeOptions {
  override: boolean;
}

export interface MergeResult {
  content: string;
  merged: boolean;
  preservedRepoContent: boolean;
}

export interface ClaudeMdResult {
  created: boolean;
  updated: boolean;
  location: "root" | "dotclaude" | null;
  contentMerged: boolean;
}

interface ExistingContent {
  agentsMd: string | null;
  claudeMd: string | null;
  claudeMdLocation: "root" | "dotclaude" | null;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function gatherExistingContent(targetDir: string): Promise<ExistingContent> {
  const agentsMdPath = path.join(targetDir, "AGENTS.md");
  const rootClaudeMdPath = path.join(targetDir, "CLAUDE.md");
  const dotClaudeClaudeMdPath = path.join(targetDir, ".claude", "CLAUDE.md");

  const agentsMd = await readFileIfExists(agentsMdPath);

  // Check root CLAUDE.md first, then .claude/CLAUDE.md
  const rootClaudeMd = await readFileIfExists(rootClaudeMdPath);
  if (rootClaudeMd !== null) {
    return { agentsMd, claudeMd: rootClaudeMd, claudeMdLocation: "root" };
  }

  const dotClaudeClaudeMd = await readFileIfExists(dotClaudeClaudeMdPath);
  if (dotClaudeClaudeMd !== null) {
    return { agentsMd, claudeMd: dotClaudeClaudeMd, claudeMdLocation: "dotclaude" };
  }

  return { agentsMd, claudeMd: null, claudeMdLocation: null };
}

function stripAgentsReference(content: string): string {
  // Remove @AGENTS.md, @../AGENTS.md, or @.claude/AGENTS.md references
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.match(/^@(\.\.\/|\.claude\/)?AGENTS\.md$/);
    })
    .join("\n")
    .trim();
}

export async function mergeAgentsMd(
  targetDir: string,
  globalContent: string,
  _source: Source,
  options: MergeOptions = { override: false },
): Promise<
  MergeResult & {
    existingClaudeMdContent: string | null;
    claudeMdLocation: "root" | "dotclaude" | null;
  }
> {
  const existing = await gatherExistingContent(targetDir);

  // Collect content to merge into repo block
  const contentToMerge: string[] = [];

  // Handle existing AGENTS.md
  if (existing.agentsMd !== null && !options.override) {
    const parsed = parseAgentsMd(existing.agentsMd);
    if (parsed.hasMarkers) {
      // Has markers - preserve repo block content
      const repoContent = extractRepoBlockContent(parsed);
      if (repoContent) {
        contentToMerge.push(repoContent);
      }
    } else {
      // No markers - treat entire content as repo-specific
      contentToMerge.push(existing.agentsMd.trim());
    }
  }

  // Handle existing CLAUDE.md content (merge into repo block)
  let claudeMdContentForMerge: string | null = null;
  if (existing.claudeMd !== null && !options.override) {
    const strippedContent = stripAgentsReference(existing.claudeMd);
    if (strippedContent) {
      claudeMdContentForMerge = strippedContent;
      contentToMerge.push(strippedContent);
    }
  }

  // Build final repo content
  const repoContent = contentToMerge.length > 0 ? contentToMerge.join("\n\n") : null;
  const content = buildAgentsMd(globalContent, repoContent, {});

  const merged = !options.override && (existing.agentsMd !== null || existing.claudeMd !== null);
  const preservedRepoContent = contentToMerge.length > 0;

  return {
    content,
    merged,
    preservedRepoContent,
    existingClaudeMdContent: claudeMdContentForMerge,
    claudeMdLocation: existing.claudeMdLocation,
  };
}

export async function writeAgentsMd(targetDir: string, content: string): Promise<void> {
  const agentsMdPath = path.join(targetDir, "AGENTS.md");
  await fs.writeFile(agentsMdPath, content, "utf-8");
}

export async function ensureClaudeMd(
  targetDir: string,
  existingLocation: "root" | "dotclaude" | null,
): Promise<ClaudeMdResult> {
  // Determine where CLAUDE.md should be and what reference to use
  // If there's an existing one, update it in place; otherwise create in .claude/
  const rootPath = path.join(targetDir, "CLAUDE.md");
  const dotClaudePath = path.join(targetDir, ".claude", "CLAUDE.md");

  // Reference paths (AGENTS.md is in root)
  const rootReference = "@AGENTS.md";
  const dotClaudeReference = "@../AGENTS.md";

  if (existingLocation === "root") {
    // Update root CLAUDE.md
    const existingContent = await readFileIfExists(rootPath);
    if (existingContent !== null) {
      // Check if reference already exists
      if (existingContent.includes(rootReference)) {
        return { created: false, updated: false, location: "root", contentMerged: false };
      }
      // Content was already merged into AGENTS.md, just add the reference
      await fs.writeFile(rootPath, `${rootReference}\n`, "utf-8");
      return { created: false, updated: true, location: "root", contentMerged: true };
    }
  }

  if (existingLocation === "dotclaude") {
    // Update .claude/CLAUDE.md
    const existingContent = await readFileIfExists(dotClaudePath);
    if (existingContent !== null) {
      // Check if reference already exists
      if (existingContent.includes(dotClaudeReference)) {
        return { created: false, updated: false, location: "dotclaude", contentMerged: false };
      }
      // Content was already merged into AGENTS.md, just add the reference
      await fs.writeFile(dotClaudePath, `${dotClaudeReference}\n`, "utf-8");
      return { created: false, updated: true, location: "dotclaude", contentMerged: true };
    }
  }

  // No existing CLAUDE.md - create in .claude/
  await fs.mkdir(path.dirname(dotClaudePath), { recursive: true });
  await fs.writeFile(dotClaudePath, `${dotClaudeReference}\n`, "utf-8");
  return { created: true, updated: false, location: "dotclaude", contentMerged: false };
}
