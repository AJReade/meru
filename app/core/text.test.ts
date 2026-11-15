import { describe, expect, it } from "vitest";

import { capitalsOutOfPlace, INTERFACE_NAMES } from "./text.ts";

describe(capitalsOutOfPlace, () => {
  it("finds nothing in sentence case", () => {
    expect(
      capitalsOutOfPlace("Close other tabs", INTERFACE_NAMES)
    ).toStrictEqual([]);
  });

  it("names each capital after the first word", () => {
    expect(
      capitalsOutOfPlace("Open in Default Browser", INTERFACE_NAMES)
    ).toStrictEqual(["Default", "Browser"]);
  });

  it("keeps a name, a name of several words and an acronym", () => {
    expect(
      capitalsOutOfPlace(
        "Upgrade to Meru Pro, show in File Explorer, copy URL",
        INTERFACE_NAMES
      )
    ).toStrictEqual([]);
  });

  it("reads past an access key's ampersand", () => {
    expect(capitalsOutOfPlace("Paste and &Match style", [])).toStrictEqual([
      "Match",
    ]);
  });

  it("takes a name only as a whole word", () => {
    expect(capitalsOutOfPlace("Show Meetings", INTERFACE_NAMES)).toStrictEqual([
      "Meetings",
    ]);
  });

  it("leaves a capitalised first word alone", () => {
    expect(capitalsOutOfPlace("Gmail", INTERFACE_NAMES)).toStrictEqual([]);
  });
});
