import { ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import type {
  ContentSurfaceName,
  contentSurfaces,
} from "../../shared/channels/surfaces.ts";
import { createBridge } from "./bridge-port.ts";
import type { Bridge } from "./bridge-port.ts";
import { contentAllowlist } from "./surface-allowlist.ts";

/** The bridge of the content preload named `name` to main, holding that surface's channels only when main named it on the command line. Nothing of it is handed to the page: the preload's own world talks to main, and the page sees only what the features do to its DOM. */
export const contentBridge = <N extends ContentSurfaceName>(
  name: N
): Bridge<(typeof contentSurfaces)[N]> =>
  createBridge<(typeof contentSurfaces)[N]>(
    contentAllowlist(process.argv, name),
    {
      on: (channel, listener) => {
        const forward = (_event: IpcRendererEvent, payload: unknown) => {
          listener(payload);
        };
        ipcRenderer.on(channel, forward);
        return () => {
          ipcRenderer.off(channel, forward);
        };
      },
      send: (channel, payload) => {
        ipcRenderer.send(channel, payload);
      },
      sendSync: (channel, payload) => {
        const answer: unknown = ipcRenderer.sendSync(channel, payload);
        return answer;
      },
    }
  );
