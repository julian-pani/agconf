import { z } from "zod";

export const SourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("github"),
    repository: z.string(),
    commit_sha: z.string(),
    ref: z.string(),
  }),
  z.object({
    type: z.literal("local"),
    path: z.string(),
    commit_sha: z.string().optional(),
  }),
]);

export const ContentSchema = z.object({
  agents_md: z.object({
    global_block_hash: z.string(),
    merged: z.boolean(),
  }),
  skills: z.array(z.string()),
  targets: z.array(z.string()).optional(),
});

export const LockfileSchema = z.object({
  version: z.literal("1"),
  pinned_version: z.string().optional(), // Pinned release version (e.g., "1.2.0")
  synced_at: z.string().datetime(),
  source: SourceSchema,
  content: ContentSchema,
  cli_version: z.string(),
});

export type Source = z.infer<typeof SourceSchema>;
export type Content = z.infer<typeof ContentSchema>;
export type Lockfile = z.infer<typeof LockfileSchema>;
