import { gmail, gmailPushes } from "../../../shared/channels/gmail.ts";
import type { GmailFeature } from "../feature.ts";

/** Takes the page where main says, which Gmail reaches through its address's fragment alone, and answers whether it could: a page off the mailbox, such as sign-in, leaves main to load the address itself. */
export const navigate: GmailFeature = {
  anywhere: true,
  apply: ({ bridge, location, settings, undo }) => {
    undo(
      bridge.on(gmailPushes.navigate, ({ hash, id }) => {
        const navigated = location.href().startsWith(settings.mailbox);
        if (navigated) {
          location.setHash(hash);
        }
        bridge.send(gmail.navigated, { id, navigated });
      })
    );
  },
  id: "navigate",
};
