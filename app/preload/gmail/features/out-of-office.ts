import { gmail } from "../../../shared/channels/gmail.ts";
import type { StyleRule } from "../../content/styles.ts";
import { cssOf } from "../../content/styles.ts";
import type { GmailFeature } from "../feature.ts";

// Gmail numbers its ids in the order it builds the page, so they rot with a build, and the banner holds nothing of its own to name it by but its words, which are the user's subject and Gmail's translated controls. It is the bar Gmail draws above Google's header, empty while the reply is off, holding an "End now" button followed by a link to the settings, `#`, as its last child, which no other bar there is known to hold.
export const OUT_OF_OFFICE_BANNER = `div:has(+ h1 > header[role="banner"]):has(> div > [role="button"] + a[href="#"]:last-child)`;

/** The bar the banner shows in, on every page of the mailbox whether the reply is on or off, so a rotted anchor is told from a reply that is off. */
export const NOTICE_BAR = 'div:has(+ h1 > header[role="banner"])';

const BANNER_SHAPE = ':scope > div > [role="button"] + a[href="#"]:last-child';

/** The banner, read off the bar before Google's header rather than through `OUT_OF_OFFICE_BANNER`, whose `:has()` asks every element of the page on every batch. */
export const bannerOf = (document: Document): Element | undefined => {
  const header =
    document.querySelector("#gb") ??
    document.querySelector('header[role="banner"]');
  const heading = header?.parentElement;
  const bar = heading?.tagName === "H1" ? heading.previousElementSibling : null;
  return bar?.tagName === "DIV" && bar.querySelector(BANNER_SHAPE) !== null
    ? bar
    : undefined;
};

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
          const on = bannerOf(document) !== undefined;
          if (said !== on) {
            said = on;
            bridge.send(gmail.outOfOffice, { on });
          }
        })
      );
    },
    entry: {
      anchor: NOTICE_BAR,
      context: '[role="main"]',
      id: "outOfOfficeBar",
    },
    id: "hideOutOfOfficeBanner",
  };
};
