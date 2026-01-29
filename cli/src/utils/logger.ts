import ora, { type Ora } from "ora";
import pc from "picocolors";

export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  dim(message: string): void;
  spinner(text: string): Ora;
}

export function createLogger(quiet = false): Logger {
  return {
    info(message: string) {
      if (!quiet) {
        console.log(`${pc.blue("info")} ${message}`);
      }
    },

    success(message: string) {
      if (!quiet) {
        console.log(`${pc.green("success")} ${message}`);
      }
    },

    warn(message: string) {
      console.log(`${pc.yellow("warn")} ${message}`);
    },

    error(message: string) {
      console.error(`${pc.red("error")} ${message}`);
    },

    dim(message: string) {
      if (!quiet) {
        console.log(pc.dim(message));
      }
    },

    spinner(text: string): Ora {
      if (quiet) {
        return ora({ text, isSilent: true });
      }
      return ora({ text, color: "blue" });
    },
  };
}

export function formatPath(p: string, cwd: string = process.cwd()): string {
  if (p.startsWith(cwd)) {
    return `.${p.slice(cwd.length)}`;
  }
  return p;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
