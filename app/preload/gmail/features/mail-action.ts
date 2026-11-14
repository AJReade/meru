import { gmail, gmailPushes } from "../../../shared/channels/gmail.ts";
import type { GmailFeature } from "../feature.ts";

/** Acts on a message for main, which holds none of what Gmail's action endpoint asks of the page, and answers whether Gmail took it; a refusal is reported once per reason per page load, so a stale marker or a signed-out session is in the log rather than silent. */
export const mailAction: GmailFeature = {
  anywhere: true,
  apply: ({ bridge, once, rpc, undo }) => {
    undo(
      bridge.on(gmailPushes.mailAction, ({ action, id, messageId }) => {
        const answer = async () => {
          const acted = await rpc.act(action, messageId);
          if (!acted.ok && once(`mailAction ${acted.error}`)) {
            bridge.send(gmail.mailActionFailed, { reason: acted.error });
          }
          bridge.send(gmail.mailActed, { acted: acted.ok, id });
        };
        void answer();
      })
    );
  },
  id: "mailAction",
};
