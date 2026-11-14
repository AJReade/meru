import { Handled } from "../../content/handled.ts";
import type { SelectorEntry } from "../../content/selectors.ts";
import type { GmailFeature } from "../feature.ts";

// An attachment's chip carries the address it downloads from in `download_url`; `.hq` is the strip that holds a message's chips, and `.hq.gt` that strip by Gmail's classes, which says a message has attachments while the anchor finds none.
const attachmentsEntry: SelectorEntry = {
  anchor: "span[download_url]",
  cacheClass: true,
  context: ".hq.gt",
  hop: ".hq",
  id: "attachmentsToTop",
};

/** Puts each message's attachments above its body, under a rule as Gmail draws between parts, once per message, and back where they were when turned off. */
export const attachmentsToTop: GmailFeature = {
  apply: ({ document, scheduler, settings, undo }) => {
    if (!settings.switches.moveAttachmentsToTop) {
      return;
    }
    const handled = new Handled(document, "data-meru-moved-to-top");
    undo(handled.undoAll);
    undo(
      scheduler.register(attachmentsEntry, (strip) => {
        const parent = strip.parentElement;
        if (
          parent === null ||
          parent.firstElementChild === strip ||
          handled.has(strip)
        ) {
          return;
        }
        const next = strip.nextSibling;
        const rule = document.createElement("div");
        rule.className = "hp meru-attachments-rule";
        rule.style.marginTop = "16px";
        strip.append(rule);
        parent.prepend(strip);
        handled.add(strip, () => {
          rule.remove();
          if (strip.parentElement !== parent) {
            return;
          }
          if (next !== null && next.parentNode === parent) {
            next.before(strip);
          } else {
            parent.append(strip);
          }
        });
      })
    );
  },
  id: "attachmentsToTop",
};
