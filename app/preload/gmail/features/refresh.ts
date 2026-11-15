import { gmailPushes } from "../../../shared/channels/gmail.ts";
import type { GmailFeature } from "../feature.ts";

// Gmail's command id for Refresh, which unlike the button's label does not change with the interface language.
export const REFRESH_BUTTON = 'div[role="button"][act="20"]';

// The Gmail logo links to the inbox too, outside the navigation.
export const INBOX_LINK = '[role="navigation"] a[href$="#inbox"]';

// The least time between two refreshes of one page, as Gmail's own list takes a moment to fetch and a burst of callers, such as several notifications' actions, wants one.
export const REFRESH_INTERVAL = 3000;

const click = (button: HTMLElement): void => {
  const { height, left, top, width } = button.getBoundingClientRect();
  const init = {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: left + width / 2,
    clientY: top + height / 2,
  };
  const view = button.ownerDocument.defaultView;
  if (view === null) {
    return;
  }
  const focused = button.ownerDocument.activeElement;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    button.dispatchEvent(new view.MouseEvent(type, init));
  }
  button.dispatchEvent(new view.MouseEvent("click", init));
  // Gmail clears the pressed look only on leave, which no real pointer is there to send after a synthetic click.
  for (const type of ["pointerout", "pointerleave", "mouseout", "mouseleave"]) {
    button.dispatchEvent(
      new view.MouseEvent(type, { ...init, relatedTarget: null })
    );
  }
  // Gmail focuses the button on mousedown, which would take the caret out of a reply being written.
  if (button.ownerDocument.activeElement === button) {
    if (
      focused instanceof view.HTMLElement &&
      focused !== focused.ownerDocument.body
    ) {
      focused.focus();
    } else {
      button.blur();
    }
  }
};

/** Presses Refresh, or on the inbox's own list the inbox's link; false when the page shows neither yet. */
const press = (document: Document, href: string): boolean => {
  const view = document.defaultView;
  if (view === null) {
    return false;
  }
  const button = document.querySelector(REFRESH_BUTTON);
  if (button instanceof view.HTMLElement) {
    click(button);
    return true;
  }
  const link = document.querySelector(INBOX_LINK);
  if (new URL(href).hash === "#inbox" && link instanceof view.HTMLElement) {
    link.click();
    return true;
  }
  return false;
};

/** Has Gmail fetch its list again when main asks, by its own Refresh button, or, on the inbox's list where Gmail shows none, by the inbox's link, at most once per `REFRESH_INTERVAL`; a push that finds nothing to press, as while Gmail loads, does not count, and an open message is left open. */
export const refresh = (now: () => number = Date.now): GmailFeature => {
  let last: number | undefined;
  return {
    apply: ({ bridge, document, location, undo }) => {
      undo(
        bridge.on(gmailPushes.refresh, () => {
          const at = now();
          if (last !== undefined && at - last < REFRESH_INTERVAL) {
            return;
          }
          if (press(document, location.href())) {
            last = at;
          }
        })
      );
    },
    id: "refresh",
  };
};
