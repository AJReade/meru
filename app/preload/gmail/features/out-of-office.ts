import { gmail } from "../../../shared/channels/gmail.ts";
import type { StyleRule } from "../../content/styles.ts";
import { cssOf } from "../../content/styles.ts";
import type { GmailFeature } from "../feature.ts";

// 3.x's selector, `:7` holding `:k`, rests on ids Gmail numbers in the order it builds the page, which rot with a build; nothing else on the banner is known to be its own without a capture of a signed-in session with the reply on, and its link to `#settings/general` is shared by other alerts, such as the one asking to enable desktop notifications.
const OUT_OF_OFFICE_BANNER = String.raw`#\:7:has(div#\:k)`;

export const hideOutOfOfficeBannerRules: readonly StyleRule[] = [
  { declarations: "display: none !important;", selector: OUT_OF_OFFICE_BANNER },
];

/** Tells main whether Gmail shows the out-of-office banner, which says the profile's reply is on, and hides the banner under `gmail.hideOutOfOfficeBanner`; made once per page load, so what it last said outlives a change of settings. */
export const outOfOffice = (): GmailFeature => {
  let said: boolean | undefined;
  return {
    apply: ({ bridge, document, scheduler, settings, style, undo }) => {
      style(
        settings.styles.hideOutOfOfficeBanner
          ? cssOf(hideOutOfOfficeBannerRules)
          : ""
      );
      undo(
        scheduler.everyBatch(() => {
          const on = document.querySelector(OUT_OF_OFFICE_BANNER) !== null;
          if (said !== on) {
            said = on;
            bridge.send(gmail.outOfOffice, { on });
          }
        })
      );
    },
    id: "hideOutOfOfficeBanner",
  };
};
