import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { msg } from "../msg.ts";
import { defineSetting, wordedFor } from "./define.ts";

const entry = {
  default: false,
  label: msg`Flag`,
  page: "panes",
  restart: false,
  schema: z.boolean(),
  scope: "global",
  tier: "free",
} as const;

describe(defineSetting, () => {
  it("keeps the key and infers the value from the schema", () => {
    const setting = defineSetting("stage.flag", entry);
    expect(setting.key).toBe("stage.flag");
    expectTypeOf(setting.key).toEqualTypeOf<"stage.flag">();
    expectTypeOf(setting.default).toEqualTypeOf<boolean>();
  });

  it("takes only a feature.name key", () => {
    // @ts-expect-error: no feature
    defineSetting("flag", entry);
    // @ts-expect-error: a third level
    defineSetting("stage.pane.flag", entry);
    // @ts-expect-error: the name is camelCase
    defineSetting("stage.Flag", entry);
    // @ts-expect-error: the feature is lower case
    defineSetting("Stage.flag", entry);
    expect(defineSetting("stage.someFlag", entry).key).toBe("stage.someFlag");
  });

  it("checks the default against the schema", () => {
    const wrong = { ...entry, default: "no" };
    // @ts-expect-error: a string is not a boolean
    expect(defineSetting("stage.flag", wrong)).toBeDefined();
  });

  it("names each value of a choice, and nothing for any other kind", () => {
    const choice = {
      ...entry,
      default: "a" as const,
      schema: z.enum(["a", "b"]),
    };
    // @ts-expect-error: a choice names its values
    defineSetting("stage.pick", choice);
    // @ts-expect-error: every value is named
    defineSetting("stage.pick", { ...choice, options: { a: msg`A` } });
    // @ts-expect-error: a boolean has no values to name
    defineSetting("stage.flag", { ...entry, options: { on: msg`On` } });
    expect(
      defineSetting("stage.pick", {
        ...choice,
        options: { a: msg`A`, b: msg`B` },
      }).options
    ).toStrictEqual({ a: "A", b: "B" });
  });

  it("takes the platform's wording in the place of the label, the description and the section, each it gives", () => {
    const setting = defineSetting("tray.icon", {
      ...entry,
      description: msg`Show the icon in the system tray.`,
      label: msg`Show icon in system tray`,
      platformWording: {
        darwin: {
          description: msg`Show the icon in the menu bar.`,
          label: msg`Show icon in menu bar`,
          section: msg`Menu bar`,
        },
        win32: { section: msg`Taskbar` },
      },
      section: msg`System tray`,
    });
    expect({
      linux: wordedFor(setting, "linux"),
      mac: wordedFor(setting, "darwin"),
      windows: wordedFor(setting, "win32"),
    }).toMatchObject({
      linux: {
        description: "Show the icon in the system tray.",
        label: "Show icon in system tray",
        section: "System tray",
      },
      mac: {
        description: "Show the icon in the menu bar.",
        label: "Show icon in menu bar",
        section: "Menu bar",
      },
      windows: {
        description: "Show the icon in the system tray.",
        label: "Show icon in system tray",
        section: "Taskbar",
      },
    });
  });

  it("formats a message as its text until it is translated", () => {
    const count = 2;
    expect(msg`Split ${count} panes`).toBe("Split 2 panes");
  });
});
