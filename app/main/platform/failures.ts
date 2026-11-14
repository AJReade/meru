import { app } from "electron";
import type {
  Details,
  Event,
  RenderProcessGoneDetails,
  WebContents,
  WebContentsConsoleMessageEventParams,
} from "electron";

import { DisposableStore } from "../../core/disposable.ts";
import type { LifecyclePort } from "../../core/ports.ts";

/** Hears what goes wrong outside any feature's own handling: an exception or a rejection nothing caught, a process that ended, and an error a page wrote to its console, whose listener a page can be muted from. */
export const createFailureWatch = (): Pick<
  LifecyclePort,
  "onFailure" | "muteConsole"
> => {
  // Electron builds an event, with a frame object and the message, for every console message of a page while anything listens to it, however many a loop writes; muting takes the listener off, so a flood costs main nothing past what is heard.
  const mutes = new Map<number, (duration?: number) => void>();
  const onFailure: LifecyclePort["onFailure"] = (listener) => {
    const uncaught = (error: Error) => {
      listener({ error, kind: "uncaught" });
    };
    const rejection = (reason: unknown) => {
      listener({ error: reason, kind: "unhandledRejection" });
    };
    const renderGone = (
      _event: Event,
      contents: WebContents,
      details: RenderProcessGoneDetails
    ) => {
      listener({
        exitCode: details.exitCode,
        kind: "processGone",
        process: "renderer",
        reason: details.reason,
        url: contents.getURL(),
      });
    };
    const childGone = (_event: Event, details: Details) => {
      listener({
        exitCode: details.exitCode,
        kind: "processGone",
        process: details.type,
        reason: details.reason,
        url: "",
      });
    };
    const detach = new DisposableStore();
    const created = (_event: Event, contents: WebContents) => {
      const message = (event: Event<WebContentsConsoleMessageEventParams>) => {
        if (event.level === "error") {
          listener({
            contentsId: contents.id,
            kind: "consoleError",
            line: event.lineNumber,
            message: event.message,
            source: event.sourceId,
            url: contents.getURL(),
          });
        }
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const { id } = contents;
      contents.on("console-message", message);
      mutes.set(id, (duration) => {
        clearTimeout(timer);
        contents.off("console-message", message);
        if (duration !== undefined) {
          timer = setTimeout(() => {
            contents.on("console-message", message);
          }, duration);
        }
      });
      const off = detach.track(() => {
        clearTimeout(timer);
        mutes.delete(id);
        contents.off("console-message", message);
        contents.off("destroyed", off);
      });
      contents.once("destroyed", off);
    };
    process.on("uncaughtException", uncaught);
    process.on("unhandledRejection", rejection);
    app.on("render-process-gone", renderGone);
    app.on("child-process-gone", childGone);
    app.on("web-contents-created", created);
    return () => {
      process.off("uncaughtException", uncaught);
      process.off("unhandledRejection", rejection);
      app.off("render-process-gone", renderGone);
      app.off("child-process-gone", childGone);
      app.off("web-contents-created", created);
      detach.dispose();
    };
  };
  return {
    muteConsole: (contentsId, duration) => {
      mutes.get(contentsId)?.(duration);
    },
    onFailure,
  };
};
