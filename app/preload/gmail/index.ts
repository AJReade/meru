import { namesContentSurface } from "../../shared/channels/surfaces.ts";
import { contentBridge } from "../content/bridge.ts";
import { startGmail } from "./app.ts";

if (namesContentSurface(process.argv, "gmail")) {
  startGmail({
    bridge: contentBridge("gmail"),
    document,
    location: {
      href: () => window.location.href,
      setHash: (hash) => {
        window.location.hash = hash;
      },
    },
  });
}
