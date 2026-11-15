import { describe, expect, it } from "vitest";

import { renameGlobalKeys, renameGoogleAppsKey } from "./migrations.ts";

describe(renameGlobalKeys, () => {
  it("moves the badge and tray keys to their new names, the menu bar's value winning, and leaves the rest", () => {
    expect([
      renameGlobalKeys({
        global: {
          "inbox.dockBadge": false,
          "stage.zoom": 1.5,
          "tray.enabled": false,
          "tray.menuBar": true,
        },
        profiles: { p1: { "stage.zoom": 2 } },
      }),
      renameGlobalKeys({ global: { "tray.enabled": false }, profiles: {} }),
      renameGlobalKeys("not settings"),
    ]).toStrictEqual([
      {
        global: {
          "inbox.unreadBadge": false,
          "stage.zoom": 1.5,
          "tray.icon": true,
        },
        profiles: { p1: { "stage.zoom": 2 } },
      },
      { global: { "tray.icon": false }, profiles: {} },
      "not settings",
    ]);
  });
});

describe(renameGoogleAppsKey, () => {
  it("moves what was stored for the workspace apps key to the Google apps one unless that is stored too, and leaves a file that never held it", () => {
    expect([
      renameGoogleAppsKey({
        global: {
          "notifications.allowFromWorkspaceApps": false,
          "stage.zoom": 1.5,
        },
        profiles: { p1: { "stage.zoom": 2 } },
      }),
      renameGoogleAppsKey({
        global: {
          "notifications.allowFromGoogleApps": true,
          "notifications.allowFromWorkspaceApps": false,
        },
        profiles: {},
      }),
      renameGoogleAppsKey({ global: { "stage.zoom": 1.5 }, profiles: {} }),
      renameGoogleAppsKey("not settings"),
    ]).toStrictEqual([
      {
        global: {
          "notifications.allowFromGoogleApps": false,
          "stage.zoom": 1.5,
        },
        profiles: { p1: { "stage.zoom": 2 } },
      },
      { global: { "notifications.allowFromGoogleApps": true }, profiles: {} },
      { global: { "stage.zoom": 1.5 }, profiles: {} },
      "not settings",
    ]);
  });
});
