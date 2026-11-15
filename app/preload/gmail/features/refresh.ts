import { gmailPushes } from "../../../shared/channels/gmail.ts";
import type { GmailFeature } from "../feature.ts";

// Gmail's command id for Refresh, which unlike the button's label does not change with the interface language.
export const REFRESH_BUTTON = 'div[role="button"][act="20"]';

// The Gmail logo links to the inbox too, outside the navigation.
export const INBOX_LINK = '[role="navigation"] a[href$="#inbox"]';

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

/** Has Gmail fetch its list again when main asks, by its own Refresh button, or, in the inbox where Gmail shows none, such as while a message is open, by the inbox's link. */
export const refresh: GmailFeature = {
  apply: ({ bridge, document, location, undo }) => {
    undo(
      bridge.on(gmailPushes.refresh, () => {
        const view = document.defaultView;
        if (view === null) {
          return;
        }
        const button = document.querySelector(REFRESH_BUTTON);
        if (button instanceof view.HTMLElement) {
          click(button);
          return;
        }
        const link = document.querySelector(INBOX_LINK);
        if (
          new URL(location.href()).hash.startsWith("#inbox") &&
          link instanceof view.HTMLElement
        ) {
          link.click();
        }
      })
    );
  },
  id: "refresh",
};
