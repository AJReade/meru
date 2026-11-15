import { z } from "zod";

import { msg } from "../../../shared/msg.ts";
import { defineSetting } from "../../../shared/settings/define.ts";

export const traySettings = [
  defineSetting("tray.icon", {
    default: true,
    description: msg`Show the application icon in the system tray.`,
    label: msg`Show icon in system tray`,
    page: "inbox",
    // Off where the dock brings a closed window back, as in 3.x.
    platformDefaults: { darwin: false },
    platformWording: {
      darwin: {
        description: msg`Show the application icon in the menu bar.`,
        label: msg`Show icon in menu bar`,
      },
    },
    section: msg`Menu bar and system tray`,
    restart: false,
    schema: z.boolean(),
    scope: "global",
    tier: "free",
  }),
  defineSetting("tray.unreadCount", {
    default: true,
    description: msg`Show an unread count next to the menu bar icon when there are unread emails.`,
    label: msg`Show unread count`,
    page: "inbox",
    section: msg`Menu bar and system tray`,
    platforms: ["darwin"],
    restart: false,
    schema: z.boolean(),
    scope: "global",
    tier: "free",
  }),
  defineSetting("tray.iconColor", {
    default: "system",
    description: msg`Choose the color of the system tray icon.`,
    label: msg`Color`,
    options: { dark: msg`Dark`, light: msg`Light`, system: msg`System` },
    page: "inbox",
    section: msg`Menu bar and system tray`,
    platforms: ["linux", "win32"],
    restart: false,
    schema: z.enum(["system", "light", "dark"]),
    scope: "global",
    tier: "free",
  }),
  defineSetting("tray.selectUnread", {
    default: false,
    description: msg`Select the first profile with unread emails when the icon is clicked.`,
    label: msg`Select first unread profile on click`,
    page: "inbox",
    // Linux's tray sends no click.
    platforms: ["darwin", "win32"],
    section: msg`Menu bar and system tray`,
    restart: false,
    schema: z.boolean(),
    scope: "global",
    tier: "free",
  }),
] as const;
