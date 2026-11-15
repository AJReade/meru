import { describe, expect, it } from "vitest";

import { capitalsOutOfPlace, INTERFACE_NAMES } from "../core/text.ts";
import { apps } from "./apps.ts";
import { commands, commandSections } from "./commands/registry.ts";
import { registry, settingsPages } from "./settings/registry.ts";

const names = [...INTERFACE_NAMES, ...apps.map((app) => app.name)];

const settingLabels = registry.flatMap((setting) => [
  setting.label,
  ...(setting.section === undefined ? [] : [setting.section]),
  ...Object.values(setting.options ?? {}),
  ...Object.values(setting.platformWording ?? {}).flatMap((wording) => [
    ...(wording.label === undefined ? [] : [wording.label]),
    ...(wording.section === undefined ? [] : [wording.section]),
  ]),
]);

const labels = [
  ...commands.map((command) => command.label),
  ...commandSections.map((section) => section.label),
  ...settingsPages.map((page) => page.label),
  ...settingLabels,
];

describe("interface text", () => {
  it.each(labels)("puts %s in sentence case", (label) => {
    expect(capitalsOutOfPlace(label, names)).toStrictEqual([]);
  });
});
