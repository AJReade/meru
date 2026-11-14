import { google, googlePushes } from "../../shared/channels/google.ts";
import { namesContentSurface } from "../../shared/channels/surfaces.ts";
import { contentBridge } from "../content/bridge.ts";
import { failureReporter } from "../content/failures.ts";
import { grantDocsClipboard } from "./bridge.ts";
import { isDocsHost, isMeetHost } from "./hosts.ts";
import { toggleMeet } from "./meet.ts";

if (namesContentSurface(process.argv, "google")) {
  const bridge = contentBridge("google");
  const fail = failureReporter((failure) => {
    bridge.send(google.failed, failure);
  });
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
