import { z } from "zod";

/** How much of a page's notification is kept: a title is a sender or a heading and a body a line or two, and the page's own notification is forged as easily as this one, so anything longer is refused rather than shown. */
const TITLE_CAP = 200;
const BODY_CAP = 2000;

/** What a Google app's page asked to show, as the page itself gave it to `Notification` or `showNotification`. */
export const pageNotificationSchema = z.object({
  /** The page's own notification body, which it may leave out. */
  body: z.string().max(BODY_CAP).optional(),
  /** The page asked for a notification that stays until it is answered. */
  requireInteraction: z.boolean().optional(),
  silent: z.boolean().optional(),
  title: z.string().max(TITLE_CAP),
});

export type PageNotification = z.infer<typeof pageNotificationSchema>;
