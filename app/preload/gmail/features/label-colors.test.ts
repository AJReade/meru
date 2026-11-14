import { describe, expect, it } from "vitest";

import type { LabelColor } from "../../../core/records/label-color.ts";
import { cssOf } from "../../content/styles.ts";
import { mountGmail, reached } from "../testing.ts";
import labels from "./fixtures/labels.html?raw";
import { labelColorRules, labelColors } from "./label-colors.ts";

const work: LabelColor = {
  color: "#ff0000",
  label: "Work",
  textColor: "auto",
};
const home: LabelColor = {
  color: "rgb(0, 0, 255)",
  label: "Home",
  textColor: "white",
};

describe(labelColors.id, () => {
  it("colours a label everywhere Gmail draws it", () => {
    const page = mountGmail({
      features: [labelColors],
      html: labels,
      settings: { labelColors: [work, home] },
    });

    const found = reached(labelColorRules([work]));
    expect(
      found.map((element) => element.className || element.tagName)
    ).toStrictEqual(["at", "av", "hN", "aEe"]);

    const sheet = page.sheet("labelColors") ?? "";
    expect(sheet).toContain("background-color: #ff0000 !important;");
    expect(sheet).toContain("contrast-color(#ff0000)");
    expect(sheet).toContain("color: #ffffff !important;");
    page.app.dispose();
  });

  it("follows a change to the colours while the page stays up", () => {
    const page = mountGmail({
      features: [labelColors],
      html: labels,
      settings: { labelColors: [work] },
    });

    page.change({ labelColors: [{ ...work, color: "#00ff00" }] });

    expect(page.sheet("labelColors")).toContain("#00ff00");
    page.change({ labelColors: [] });
    expect(page.sheet("labelColors")).toBeUndefined();
    page.app.dispose();
  });
});

describe("a hostile label name", () => {
  const hostile = [
    'x\f] {} body { visibility: hidden !important } .q[a="',
    'x\0"] {} body { display: none }',
    'x\u2028"] {} body { display: none }',
    '"]} </style><script>window.pwned = 1</script>',
  ];

  it.each(hostile)("stays inside its string: %j", (label) => {
    const rules = labelColorRules([
      { color: "#ff0000", label, textColor: "auto" },
    ]);
    const css = cssOf(rules);

    expect(css.split("\n")).toHaveLength(rules.length);
    for (const rule of rules) {
      expect(rule.selector).not.toMatch(/[\p{Cc}\u2028\u2029]/u);
      // What is left once every quoted string is taken out is the selector Gmail sees.
      const outside = rule.selector.replaceAll(/"(?:\\.|[^"\\])*"/gu, "");
      expect(outside).not.toMatch(/["{}<]/u);
    }
  });
});
