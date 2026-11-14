import type { LogPort } from "../../core/log.ts";
import type { Clock, LifecyclePort, Unsubscribe } from "../../core/ports.ts";

/** How many console errors a page may write in a window before the rest of the window's go unheard. */
export const PAGE_ERRORS_PER_WINDOW = 20;

export const PAGE_ERROR_WINDOW = 60_000;

interface FailureLogOptions {
  readonly lifecycle: Pick<LifecyclePort, "onFailure" | "muteConsole" | "quit">;
  readonly clock: Pick<Clock, "now">;
  readonly log: LogPort;
  /** Whether a page is one of the app's own; Google's pages write errors of their own all day, which say nothing about the app, so such a page's console is muted for good at its first. */
  readonly ownPage: (url: string) => boolean;
}

/** Writes each failure nothing else handled to the log, and quits after an uncaught exception. */
export const logFailures = ({
  clock,
  lifecycle,
  log,
  ownPage,
}: FailureLogOptions): Unsubscribe => {
  // A page that logs in a loop would otherwise fill the log, by web contents, since two pages can share an address.
  const pages = new Map<number, { readonly since: number; written: number }>();
  const pageError = (contentsId: number, url: string): void => {
    const now = clock.now();
    for (const [id, page] of pages) {
      if (now - page.since >= PAGE_ERROR_WINDOW) {
        pages.delete(id);
      }
    }
    const page = pages.get(contentsId) ?? { since: now, written: 0 };
    pages.set(contentsId, page);
    page.written += 1;
    if (page.written === PAGE_ERRORS_PER_WINDOW) {
      log.warn(
        "A page wrote too many errors, so the rest of the minute's go unheard",
        {
          url,
        }
      );
      lifecycle.muteConsole(contentsId, page.since + PAGE_ERROR_WINDOW - now);
    }
  };
  return lifecycle.onFailure((failure) => {
    switch (failure.kind) {
      case "uncaught": {
        log.error("An exception was not caught", { error: failure.error });
        // Node would have ended the process, and state an exception left half changed is not worth carrying on with; the quit still writes what it holds and flushes the log.
        lifecycle.quit();
        break;
      }
      case "unhandledRejection": {
        log.error("A rejected promise was not handled", {
          error: failure.error,
        });
        break;
      }
      case "processGone": {
        if (failure.reason !== "clean-exit") {
          const { exitCode, process, reason, url } = failure;
          log.error("A process ended", { exitCode, process, reason, url });
        }
        break;
      }
      case "consoleError": {
        const { contentsId, line, message, source, url } = failure;
        if (!ownPage(url)) {
          lifecycle.muteConsole(contentsId);
          break;
        }
        log.error("A page logged an error", {
          line,
          source,
          text: message,
          url,
        });
        pageError(contentsId, url);
        break;
      }
      default: {
        break;
      }
    }
  });
};
