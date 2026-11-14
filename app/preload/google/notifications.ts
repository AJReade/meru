import type { Unsubscribe } from "../../core/ports.ts";
import { pageNotificationSchema } from "../../core/records/notification.ts";
import type { PageNotification } from "../../core/records/notification.ts";

/** The event the page's patched `Notification` dispatches on the document, which only this preload listens for. */
export const NOTIFICATION_EVENT = "meru:notification";

/** Hears each notification the page raised, as the patch in its world dispatched it; anything the schema refuses is reported and dropped, since the detail is the page's to write. */
export const listenForNotifications = (
  document: Document,
  raised: (notification: PageNotification) => void,
  fail: (what: string, error: unknown) => void
): Unsubscribe => {
  const listener = (event: Event) => {
    const detail: unknown =
      event instanceof CustomEvent ? event.detail : undefined;
    if (typeof detail !== "string") {
      fail("notify", new Error("A notification arrived with no detail"));
      return;
    }
    let read: unknown;
    try {
      read = JSON.parse(detail);
    } catch (error) {
      fail("notify", error);
      return;
    }
    const parsed = pageNotificationSchema.safeParse(read);
    if (parsed.success) {
      raised(parsed.data);
    } else {
      fail("notify", new Error(parsed.error.message));
    }
  };
  document.addEventListener(NOTIFICATION_EVENT, listener);
  return () => {
    document.removeEventListener(NOTIFICATION_EVENT, listener);
  };
};
