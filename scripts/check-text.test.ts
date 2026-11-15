import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Platform } from "../app/core/records/platform.ts";
import { INTERFACE_NAMES, outOfSentenceCase } from "../app/core/text.ts";
import { contextMenuLabels } from "../app/main/features/context-menu/index.ts";
import {
  DOWNLOAD_NOTICES,
  revealLabel,
} from "../app/main/features/downloads/index.ts";
import {
  MAIL_ACTIONS,
  NOTICE_TITLES,
} from "../app/main/features/notifications/index.ts";
import { tabMenuLabels } from "../app/main/features/sidebar/tab-menu.ts";
import { trayLabels } from "../app/main/features/tray/index.ts";
import { menuLabels } from "../app/main/shell/menu.ts";
import { apps } from "../app/shared/apps.ts";

const names = [...INTERFACE_NAMES, ...apps.map((app) => app.name)];

const PLATFORMS: readonly Platform[] = ["darwin", "linux", "win32"];

const textOf = (value: string | ((input: string) => string)): string =>
  typeof value === "string" ? value : value("{}");

const tables: readonly string[] = [
  ...PLATFORMS.flatMap((platform) => [
    ...Object.values(menuLabels(platform)),
    ...Object.values(trayLabels(platform)),
    revealLabel(platform),
  ]),
  ...Object.values(contextMenuLabels()).map(textOf),
  ...Object.values(tabMenuLabels()),
  ...MAIL_ACTIONS.map((action) => action.label),
  NOTICE_TITLES.heldBack,
  NOTICE_TITLES.newEmails(6),
  ...Object.values(DOWNLOAD_NOTICES).map(textOf),
];

const app = path.join(import.meta.dirname, "../app");

// A Node test cannot load the DOM modules of the renderer and the preloads, such as the sent toast's, so it reads their msg literals from the source, a placeholder standing for each interpolation.
const literals = globSync(["renderer/**/*.{ts,tsx}", "preload/**/*.ts"], {
  cwd: app,
  exclude: (file) => /\.test\.tsx?$/u.test(file),
}).flatMap((file) =>
  [
    ...readFileSync(path.join(app, file), "utf-8").matchAll(
      /\bmsg`(?<text>(?:[^`\\]|\\.)*)`/gu
    ),
  ].map((match) => (match.groups?.text ?? "").replaceAll(/\$\{[^}]*\}/gu, "{}"))
);

describe("interface text outside the registries", () => {
  it("finds the literals of the renderer and the preloads", () => {
    expect(literals.length).toBeGreaterThan(0);
  });

  it.each([...new Set([...tables, ...literals])])(
    "puts %s in sentence case",
    (text) => {
      expect(outOfSentenceCase(text, names)).toStrictEqual([]);
    }
  );
});
