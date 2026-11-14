import { namesContentSurface } from "../../shared/channels/surfaces.ts";
import { contentBridge } from "../content/bridge.ts";
import { startGmail } from "./app.ts";
import { pageHttp } from "./http.ts";

if (namesContentSurface(process.argv, "gmail")) {
  startGmail({
    bridge: contentBridge("gmail"),
    cookie: () => document.cookie,
    document,
    http: pageHttp(),
    location: {
      href: () => window.location.href,
      setHash: (hash) => {
        window.location.hash = hash;
      },
    },
  });
}
