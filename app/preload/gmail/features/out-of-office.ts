import { gmail } from "../../../shared/channels/gmail.ts";
import type { StyleRule } from "../../content/styles.ts";
import { cssOf } from "../../content/styles.ts";
import type { GmailFeature } from "../feature.ts";

// 3.x's selector, `:7` holding `:k`, rests on ids Gmail numbers in the order it builds the page; the banner's link to the settings page it is turned off on, `#settings/general`, says the same thing without them.
const OUT_OF_OFFICE_BANNER = String.raw`#\:7:has(#\:k), [role="alert"]:has(a[href$="#settings/general"])`;

export const hideOutOfOfficeBannerRules: readonly StyleRule[] = [
  { declarations: "display: none !important;", selector: OUT_OF_OFFICE_BANNER },
];

// What each page last said, so it speaks only on a change; a page is known by its bridge, which lives as long as it does.
const said = new WeakMap<object, boolean>();

/** Tells main whether Gmail shows the out-of-office banner, which says the profile's reply is on, and hides the banner under `gmail.hideOutOfOfficeBanner`. */
export const outOfOffice: GmailFeature = {
  apply: ({ bridge, document, scheduler, settings, style, undo }) => {
    style(
      settings.styles.hideOutOfOfficeBanner
        ? cssOf(hideOutOfOfficeBannerRules)
        : ""
    );
    undo(
      scheduler.everyBatch(() => {
        const on = document.querySelector(OUT_OF_OFFICE_BANNER) !== null;
        if (said.get(bridge) !== on) {
          said.set(bridge, on);
          bridge.send(gmail.outOfOffice, { on });
        }
      })
    );
  },
  id: "hideOutOfOfficeBanner",
};
