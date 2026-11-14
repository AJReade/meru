import { z } from "zod";

import { downloadSchema } from "../../core/records/download.ts";
import { idSchema } from "../../core/records/id.ts";
import {
  defineChannels,
  definePushes,
  event,
  invoke,
  noPayload,
  push,
  sync,
} from "./define.ts";

/** The download history, newest first. */
const downloadsSnapshotSchema = z.object({
  items: z.array(downloadSchema),
});

export type DownloadsSnapshot = z.infer<typeof downloadsSnapshotSchema>;

const byId = z.object({ id: idSchema });

export const downloads = defineChannels("downloads", {
  /** Opens the downloads overlay over the panes of the sender's window. */
  open: event(noPayload),
  /** Takes the overlay down, from its own page. */
  close: event(noPayload),
  snapshot: sync(noPayload, downloadsSnapshotSchema),
  /** Opens a download's file in the application the system gives its type. */
  openFile: invoke(byId, z.null()),
  showInFolder: invoke(byId, z.null()),
  /** Takes a download off the history, leaving its file. */
  remove: invoke(byId, z.null()),
  clear: invoke(noPayload, z.null()),
  /** The folder downloads go to while `downloads.location` names none. */
  defaultFolder: sync(noPayload, z.string()),
  /** Asks for a folder and makes it `downloads.location`. */
  chooseFolder: invoke(noPayload, z.null()),
});

export const downloadsPushes = definePushes("downloads", {
  changed: push(downloadsSnapshotSchema),
});
