import type { LogPort } from "../../core/log.ts";
import type { BlankPopupWindow, Clock, PageRoutes } from "../../core/ports.ts";

/** How long a blank popup may wait for its first navigation; Google's sign-in points its window at accounts.google.com in the same task that opens it. */
export const BLANK_POPUP_TIMEOUT = 5000;

interface BlankPopupOptions {
  readonly clock: Pick<Clock, "schedule">;
  readonly log: LogPort;
}

/**
 * The routes of a blank popup, which its first navigation decides: shown when the opener takes it
 * as sign-in, and destroyed when the opener sends it elsewhere, when it never navigates, such as a
 * page that writes into it, and when its renderer ends.
 */
export const holdBlankPopup = (
  popup: BlankPopupWindow,
  opener: PageRoutes,
  { clock, log }: BlankPopupOptions
): PageRoutes => {
  let decided = false;
  // A navigation is decided inside Electron's will-navigate, whose navigation throttle goes on using the web contents once the listener returns, so the window goes on a turn of its own.
  const takeDown = () => {
    unused();
    clock.schedule(0, () => {
      popup.destroy();
    });
  };
  const unused = clock.schedule(BLANK_POPUP_TIMEOUT, takeDown);
  const unwatch = popup.onGone((reason) => {
    if (reason !== "clean-exit") {
      log.warn("A popup's page ended", { reason });
    }
    decided = true;
    takeDown();
  });
  const unclose = popup.onClosed(() => {
    unused();
    unwatch();
    unclose();
  });
  return {
    ...opener,
    open: (url, disposition) => {
      if (decided || disposition !== "inPlace") {
        return opener.open(url, disposition);
      }
      decided = true;
      unused();
      if (opener.popup(url)) {
        popup.show();
        return false;
      }
      takeDown();
      return true;
    },
  };
};
