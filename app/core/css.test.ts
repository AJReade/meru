import { describe, expect, it } from "vitest";

import { cssString } from "./css.ts";

describe(cssString, () => {
  it("escapes a quote and a backslash by themselves", () => {
    expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("escapes every control character as its code point", () => {
    expect(cssString("a\fb")).toBe('"a\\c b"');
    expect(cssString("a\r\nb")).toBe('"a\\d \\a b"');
    expect(cssString("a\u007Fb\u0001")).toBe('"a\\7f b\\1 "');
  });

  it("turns NUL into the replacement character", () => {
    expect(cssString("a\0b")).toBe('"a\uFFFDb"');
  });

  it("escapes the line and paragraph separators", () => {
    expect(cssString("a\u2028b\u2029")).toBe('"a\\2028 b\\2029 "');
  });

  it("leaves any other text as it is", () => {
    expect(cssString("Arbeit · 仕事 🎉")).toBe('"Arbeit · 仕事 🎉"');
  });
});
