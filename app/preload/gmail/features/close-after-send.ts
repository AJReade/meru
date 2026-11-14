import { gmail, gmailPushes } from "../../../shared/channels/gmail.ts";
import { isHtmlElement } from "../../content/query.ts";
import type { SelectorEntry } from "../../content/selectors.ts";
import type { GmailFeature } from "../feature.ts";

// Gmail's "Message sent" bar, `.vh`, holds Undo, `#link_undo`, beside View message, `#link_vsm`; Undo alone also follows other actions, such as archiving.
export const messageSentEntry: SelectorEntry = {
  anchor: "#link_undo",
  id: "messageSent",
};

/** Under `gmail.closeComposeWindowAfterSend`, tells main each time Gmail says a message was sent, which main heeds only from a pop-out, and clicks Gmail's own Undo when main says the toast's Undo was clicked. */
export const closeAfterSend: GmailFeature = {
  apply: ({ bridge, document, scheduler, settings, undo }) => {
    if (!settings.switches.closeComposeWindowAfterSend) {
      return;
    }
    undo(
      scheduler.register(messageSentEntry, (undoLink) => {
        const bar = undoLink.closest(".vh") ?? undoLink.parentElement;
        if (bar !== null && bar.querySelector("#link_vsm") !== null) {
          bridge.send(gmail.messageSent, {});
        }
      })
    );
    undo(
      bridge.on(gmailPushes.undoSend, () => {
        const undoLink = document.querySelector("#link_undo");
        if (undoLink !== null && isHtmlElement(undoLink)) {
          undoLink.click();
        }
      })
    );
  },
  id: "closeAfterSend",
};
