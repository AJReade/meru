import { z } from "zod";

import { msg } from "../../../shared/msg.ts";
import {
  defineSetting,
  defineSettingsPage,
} from "../../../shared/settings/define.ts";

export const downloadsPage = defineSettingsPage("downloads", {
  icon: "download",
  label: msg`Downloads`,
  order: 22,
});

export const downloadsSettings = [
  defineSetting("downloads.saveAs", {
    default: false,
    description: msg`Otherwise each file goes straight to the download folder.`,
    label: msg`Ask where to save each file`,
    page: "downloads",
    restart: false,
    schema: z.boolean(),
    scope: "global",
    tier: "free",
  }),
  defineSetting("downloads.openFolderWhenDone", {
    default: false,
    label: msg`Show each file in its folder once it has downloaded`,
    page: "downloads",
    restart: false,
    schema: z.boolean(),
    scope: "global",
    tier: "free",
  }),
  // Null keeps to the system's Downloads folder wherever it is; the page edits it with a folder picker rather than a field.
  defineSetting("downloads.location", {
    default: null,
    label: msg`Download folder`,
    page: "downloads",
    restart: false,
    schema: z.string().min(1).nullable(),
    scope: "global",
    tier: "free",
  }),
  defineSetting("notifications.downloadCompleted", {
    default: true,
    description: msg`Show a notification when a download finishes.`,
    label: msg`Downloads`,
    page: "inbox",
    restart: false,
    schema: z.boolean(),
    scope: "global",
    section: msg`Notifications`,
    tier: "free",
  }),
  defineSetting("notifications.onClickDownloadCompleted", {
    default: "showInFolder",
    label: msg`A download's notification offers to`,
    options: {
      openFile: msg`Open the file`,
      showInFolder: msg`Show it in its folder`,
    },
    page: "inbox",
    restart: false,
    schema: z.enum(["showInFolder", "openFile"]),
    scope: "global",
    section: msg`Notifications`,
    tier: "free",
  }),
] as const;
