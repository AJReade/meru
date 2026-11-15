import { z } from "zod";

import {
  activeDownloadSchema,
  downloadSchema,
} from "../../core/records/download.ts";
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

/** The downloads under way and the history, each newest first. */
const downloadsSnapshotSchema = z.object({
  active: z.array(activeDownloadSchema),
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
  /** Calls off a download under way, which is then recorded as cancelled. */
  cancel: invoke(byId, z.null()),
  /** Starts a drag of a finished download's file out of the page, for the Finder or another app to take. */
  dragOut: event(byId),
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
