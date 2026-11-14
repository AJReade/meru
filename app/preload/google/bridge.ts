import { webFrame } from "electron";

/**
 * The "Docs Offline" extension injects a script that does nothing but set these globals, which tell Docs the clipboard permissions it has; without them the Edit menu's cut, copy and paste only offer to install the extension. The pane grants the clipboard itself, so only the globals are missing, and they have to be in the page's own world, which is the one thing a content preload writes there.
 */
const markDocsExtensionInstalled = () => {
  Reflect.set(window, "_docs_chrome_extension_exists", true);
  Reflect.set(window, "_docs_chrome_extension_permissions", [
    "clipboardRead",
    "clipboardWrite",
  ]);
};

export const grantDocsClipboard = async (): Promise<void> => {
  await webFrame.executeJavaScript(
    `(${markDocsExtensionInstalled.toString()})()`
  );
};

/**
 * Sends each notification the page raises to the preload's world as a `CustomEvent` on the document.
 * Context isolation gives the preload a realm of its own, so replacing `Notification` or patching `ServiceWorkerRegistration.prototype` there leaves the page's untouched: a probe on Electron 45.2.3 read neither patch from the page. The document is shared, though, and a listener in the preload's world hears what the page dispatches on it, so this runs in the page's world and the detail is a JSON string, since a primitive is all that crosses the realms unchanged.
 * It is written as one self-contained function because it reaches the page as its own source.
 */
const patchNotifications = (eventName: string) => {
  // What the page passes is taken as the interface says and parsed in main, which is where anything a page sends is checked.
  const raise = (title: string, options?: NotificationOptions) => {
    document.dispatchEvent(
      new CustomEvent(eventName, {
        detail: JSON.stringify({
          ...(options?.body === undefined ? {} : { body: options.body }),
          ...(options?.requireInteraction === undefined
            ? {}
            : { requireInteraction: options.requireInteraction }),
          ...(options?.silent === undefined || options.silent === null
            ? {}
            : { silent: options.silent }),
          title,
        }),
      })
    );
  };
  // A page that raises a notification goes on to read the permission, ask for one and hold the object it made, so the stand-in answers each rather than throwing where the real one would not.
  class PageNotification extends EventTarget {
    static readonly permission = "granted";
    static readonly maxActions = 0;
    static readonly requestPermission = async () =>
      await Promise.resolve("granted");
    readonly title: string;
    readonly body: string;
    closed = false;
    onclick: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    onshow: unknown = null;

    constructor(title: string, options?: NotificationOptions) {
      super();
      this.title = title;
      this.body = options?.body ?? "";
      raise(title, options);
    }

    close(): void {
      this.closed = true;
    }
  }
  Reflect.set(window, "Notification", PageNotification);
  Reflect.set(
    ServiceWorkerRegistration.prototype,
    "showNotification",
    async (title: string, options?: NotificationOptions) => {
      raise(title, options);
      await Promise.resolve();
    }
  );
};

/** Patches the page's own `Notification` and `ServiceWorkerRegistration.prototype.showNotification` to dispatch `eventName` on the document instead of showing anything. */
export const sendNotificationsToDocument = async (
  eventName: string
): Promise<void> => {
  await webFrame.executeJavaScript(
    `(${patchNotifications.toString()})(${JSON.stringify(eventName)})`
  );
};
