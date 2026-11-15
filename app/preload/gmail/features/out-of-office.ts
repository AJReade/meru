import { gmail } from "../../../shared/channels/gmail.ts";
import type { StyleRule } from "../../content/styles.ts";
import { cssOf } from "../../content/styles.ts";
import type { GmailFeature } from "../feature.ts";

// Gmail numbers its ids in the order it builds the page, so they rot with a build, and the banner holds nothing of its own to name it by but its words, which are the user's subject and Gmail's translated controls. It is the bar Gmail draws above Google's header, empty while the reply is off, holding an "End now" button followed by a link to the settings, `#`, as its last child, which no other bar there is known to hold.
export const OUT_OF_OFFICE_BANNER = `div:has(+ h1 > header[role="banner"]):has(> div > [role="button"] + a[href="#"]:last-child)`;

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
