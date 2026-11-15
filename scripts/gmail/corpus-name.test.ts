import { describe, expect, it } from "vitest";

import { corpusFileName } from "./corpus-name.ts";

describe(corpusFileName, () => {
  const body = `<div class="a3s" id=":13u"><div id="avWBGd-44"><br/>xxx xx</div></div>`;

  it("names a kind sent to fill a gap by the kind alone", () => {
    expect(corpusFileName("receipt", true, body)).toBe("receipt.html");
  });

  it("names a shape by a hash of the body that Gmail's ids and the formatter's wrapping leave as it was", () => {
    const name = corpusFileName("plain-text", false, body);

    expect([
      /^plain-text-[\da-f]{8}\.html$/u.test(name),
      corpusFileName(
        "plain-text",
        false,
        `<div class="a3s" id=":wc">\n  <div id="avWBGd-9">\n    <br />xxx xx\n  </div>\n</div>\n`
      ),
      corpusFileName("plain-text", false, body.replace("xxx", "xxxx")) === name,
    ]).toStrictEqual([true, name, false]);
  });
});
