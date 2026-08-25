import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../src/utils/ansi.js";

const ESC = "\u001B";

describe("stripAnsi", () => {
  it("removes color escapes and keeps the text", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[39m and ${ESC}[2mdim${ESC}[22m`)).toBe("red and dim");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });
});
