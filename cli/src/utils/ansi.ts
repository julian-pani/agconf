// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes
const ANSI_SGR_PATTERN = /\u001B\[[0-9;]*m/g;

/**
 * Remove ANSI color/style escapes from a string. Used wherever styled output has
 * to survive as plain data — e.g. text embedded in a JSON payload consumed by
 * another program, where the escapes are noise rather than formatting.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR_PATTERN, "");
}
