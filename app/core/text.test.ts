import { describe, expect, it } from "vitest";

import { INTERFACE_NAMES, outOfSentenceCase } from "./text.ts";

describe(outOfSentenceCase, () => {
  it("finds nothing in sentence case", () => {
    expect(
      outOfSentenceCase("Close other tabs", INTERFACE_NAMES)
    ).toStrictEqual([]);
  });

  it("names each capital after the first word", () => {
    expect(
      outOfSentenceCase("Open in Default Browser", INTERFACE_NAMES)
    ).toStrictEqual(["Default", "Browser"]);
  });

  it("keeps a name, a name of several words and an acronym", () => {
    expect(
      outOfSentenceCase(
        "Upgrade to Meru Pro, show in File Explorer, copy URL",
        INTERFACE_NAMES
      )
    ).toStrictEqual([]);
  });

  it("reads past an access key's ampersand", () => {
    expect(outOfSentenceCase("Paste and &Match style", [])).toStrictEqual([
      "Match",
    ]);
  });

  it("takes a name only as a whole word", () => {
    expect(
      outOfSentenceCase("Show Meetings", [...INTERFACE_NAMES, "Meet"])
    ).toStrictEqual(["Meetings"]);
  });

  it("leaves a first word that is a name alone", () => {
    expect(outOfSentenceCase("Gmail", ["Gmail"])).toStrictEqual([]);
    expect(outOfSentenceCase("iCloud sync", ["iCloud"])).toStrictEqual([]);
  });

  it("faults a first word in lower case", () => {
    expect(outOfSentenceCase("close other tabs", [])).toStrictEqual(["close"]);
  });

  it("faults a capital after a hyphen inside a word", () => {
    expect(outOfSentenceCase("Open in a Pop-Out", [])).toStrictEqual([
      "Pop",
      "Out",
    ]);
    expect(outOfSentenceCase("Pop-Out window", [])).toStrictEqual(["Out"]);
  });

  it("does not fault a placeholder standing first", () => {
    expect(outOfSentenceCase("{} new emails", [])).toStrictEqual([]);
  });
});
