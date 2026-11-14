import { gmail, gmailPushes } from "../../../shared/channels/gmail.ts";
import { msg } from "../../../shared/msg.ts";
import type { GmailFeature } from "../feature.ts";
import { Toaster } from "../toast.ts";

// One toaster per page, known by its bridge, so a change of settings keeps the toast on screen.
const toasters = new WeakMap<object, Toaster>();

/** Shows the "Message sent" toast main asks for once a pop-out that sent a message is hidden, whose Undo main hands back to that pop-out. */
export const sentToast: GmailFeature = {
  anywhere: true,
  apply: ({ bridge, document, undo }) => {
    let toaster = toasters.get(bridge);
    if (toaster === undefined) {
      toaster = new Toaster({ document });
      toasters.set(bridge, toaster);
    }
    const shown = toaster;
    undo(
      bridge.on(gmailPushes.showSentToast, ({ id }) => {
        shown.show({
          action: {
            label: msg`Undo`,
            run: () => {
              bridge.send(gmail.undoSend, { id });
            },
          },
          id,
          labels: { close: msg`Close`, toasts: msg`Notifications` },
          title: msg`Message sent.`,
        });
      })
    );
    undo(
      bridge.on(gmailPushes.dismissSentToast, ({ id }) => {
        shown.dismiss(id);
      })
    );
  },
  id: "sentToast",
};
