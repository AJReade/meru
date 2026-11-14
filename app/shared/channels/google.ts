import { z } from "zod";

import { pageNotificationSchema } from "../../core/records/notification.ts";
import { contentFailureSchema } from "./content.ts";
import { defineChannels, definePushes, event, push } from "./define.ts";

export const meetToggleSchema = z.enum(["microphone", "camera"]);

export type MeetToggle = z.infer<typeof meetToggleSchema>;

/** What the page of a Google app's pane other than Gmail asks of main. */
export const google = defineChannels("google", {
  /** The preload failed at something of its own, which main logs. */
  failed: event(contentFailureSchema),
  /** The page raised a notification of its own, which main composes and shows. */
  notify: event(pageNotificationSchema),
});

/** What main tells the page of a Google app's pane other than Gmail. */
export const googlePushes = definePushes("google", {
  /** Turns Meet's microphone or camera on or off, as its own button does. */
  meetToggle: push(z.object({ toggle: meetToggleSchema })),
});
