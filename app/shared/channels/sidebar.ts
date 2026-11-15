import { z } from "zod";

import { sidebarSchema } from "../../core/engines/sidebar.ts";
import { idSchema } from "../../core/records/id.ts";
import { pointSchema } from "../../core/records/rect.ts";
import {
  defineChannels,
  definePushes,
  event,
  noPayload,
  push,
  sync,
} from "./define.ts";

/** The selected profile's sidebar, which main lays the panes out beside. */
export const sidebar = defineChannels("sidebar", {
  snapshot: sync(noPayload, sidebarSchema),
  /** Shows the native menu of the tab's row in the sender's window, at `at` in its content, else at the pointer. */
  showTabMenu: event(z.object({ at: pointSchema.optional(), tabId: idSchema })),
});

export const sidebarPushes = definePushes("sidebar", {
  changed: push(sidebarSchema),
});
