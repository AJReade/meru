import { gmail } from "../../../shared/channels/gmail.ts";
import type { GmailFeature } from "../feature.ts";
import { INBOX_LINK } from "./refresh.ts";

// The count sits beside the inbox's link in its row, and only the row's tooltip holder wraps both; the link's label and the count's class are Gmail's own words and names, which change with the language and the build.
const INBOX_ROW = "[data-tooltip]";

/** The inbox's unread count as Gmail shows it beside the link, which is all a change needs; undefined while the navigation is not drawn. */
const shownCount = (document: Document): string | undefined => {
  const link = document.querySelector(INBOX_LINK);
  const row = link?.closest(INBOX_ROW);
  if (
    link === null ||
    link === undefined ||
    row === null ||
    row === undefined
  ) {
    return undefined;
  }
  return (row.textContent ?? "").replace(link.textContent ?? "", "").trim();
};

/** Tells main when the inbox's unread count Gmail shows changes, so the feed, which stays the one count, is read at once rather than up to an interval later; made once per page load, so the count it last saw outlives a change of settings. */
export const unreadChanged = (): GmailFeature => {
  let seen: string | undefined;
  return {
    apply: ({ bridge, document, scheduler, undo }) => {
      undo(
        scheduler.everyBatch(() => {
          const count = shownCount(document);
          if (count === undefined || count === seen) {
            return;
          }
          if (seen !== undefined) {
            bridge.send(gmail.unreadChanged, {});
          }
          seen = count;
        })
      );
    },
    id: "unreadChanged",
  };
};
