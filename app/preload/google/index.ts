import { google, googlePushes } from "../../shared/channels/google.ts";
import { namesContentSurface } from "../../shared/channels/surfaces.ts";
import { contentBridge } from "../content/bridge.ts";
import { failureReporter } from "../content/failures.ts";
import { grantDocsClipboard, sendNotificationsToDocument } from "./bridge.ts";
import { isDocsHost, isMeetHost } from "./hosts.ts";
import { toggleMeet } from "./meet.ts";
import { listenForNotifications, NOTIFICATION_EVENT } from "./notifications.ts";

if (namesContentSurface(process.argv, "google")) {
  const bridge = contentBridge("google");
  const fail = failureReporter((failure) => {
    bridge.send(google.failed, failure);
  });
  listenForNotifications(
    document,
    (notification) => {
      bridge.send(google.notify, notification);
    },
    fail
  );
  // Listening comes first, so a page that raises a notification as it loads is still heard.
  const patch = async () => {
    try {
      await sendNotificationsToDocument(NOTIFICATION_EVENT);
    } catch (error) {
      fail("sendNotificationsToDocument", error);
    }
  };
  void patch();
  if (isDocsHost(window.location.hostname)) {
    const grant = async () => {
      try {
        await grantDocsClipboard();
      } catch (error) {
        fail("grantDocsClipboard", error);
      }
    };
    void grant();
  }
  if (isMeetHost(window.location.hostname)) {
    bridge.on(googlePushes.meetToggle, ({ toggle }) => {
      try {
        toggleMeet(document, toggle);
      } catch (error) {
        fail("meetToggle", error);
      }
    });
  }
}
