import type { Unsubscribe } from "../../../core/ports.ts";
import { isHtmlElement, queryAll } from "../../content/query.ts";
import type { SelectorEntry } from "../../content/selectors.ts";
import type { GmailFeature } from "../feature.ts";

// Gmail tags the Compose button with `gh="cm"`, its compose action.
export const composeEntry: SelectorEntry = {
  anchor: '[gh="cm"][role="button"]',
  context: '[role="navigation"]',
  id: "composeButton",
};

// Below the last message of a conversation, `.amn` holds Reply and Forward, each a `span.ams` with the link role.
export const replyForwardEntry: SelectorEntry = {
  anchor: 'span.ams[role="link"]',
  cacheClass: true,
  hop: ".amn",
  id: "replyForward",
};

/** Turns a plain click on `element` into a Shift-click, which Gmail answers by opening the compose in a window of its own, and marks the element while it does; a click with Shift held already goes through as it is. */
export const shiftClicks = (element: HTMLElement): Unsubscribe => {
  const click = (event: MouseEvent) => {
    if (event.shiftKey) {
      return;
    }
    event.stopPropagation();
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
        view: element.ownerDocument.defaultView,
      })
    );
  };
  element.addEventListener("click", click);
  element.dataset.meruShiftClick = "";
  return () => {
    element.removeEventListener("click", click);
    delete element.dataset.meruShiftClick;
  };
};

/** Opens a new compose under `gmail.openComposeInNewWindow`, and a reply or a forward under `gmail.replyForwardInPopOut`, in a pop-out window, as 3.x does. */
export const popOuts: GmailFeature = {
  apply: ({ scheduler, settings, undo }) => {
    const { openComposeInNewWindow, replyForwardInPopOut } = settings.switches;
    if (openComposeInNewWindow) {
      undo(
        scheduler.register(composeEntry, (button) => {
          undo(shiftClicks(button));
        })
      );
    }
    if (replyForwardInPopOut) {
      undo(
        scheduler.register(replyForwardEntry, (strip) => {
          const links = queryAll(strip, 'span[role="link"]', isHtmlElement);
          // Anything but the two is a strip Gmail changed, which a wrong Shift-click would make worse.
          if (links.length !== 2) {
            return;
          }
          for (const link of links) {
            undo(shiftClicks(link));
          }
        })
      );
    }
  },
  id: "popOuts",
};
