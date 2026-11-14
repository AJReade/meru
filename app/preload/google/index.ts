import { googlePushes } from "../../shared/channels/google.ts";
import { namesContentSurface } from "../../shared/channels/surfaces.ts";
import { contentBridge } from "../content/bridge.ts";
import { grantDocsClipboard } from "./bridge.ts";
import { isDocsHost, isMeetHost } from "./hosts.ts";
import { toggleMeet } from "./meet.ts";

if (namesContentSurface(process.argv, "google")) {
  if (isDocsHost(window.location.hostname)) {
    void grantDocsClipboard();
  }
  if (isMeetHost(window.location.hostname)) {
    contentBridge("google").on(googlePushes.meetToggle, ({ toggle }) => {
      toggleMeet(document, toggle);
    });
  }
}
