import { isHtmlElement, queryAll } from "../../content/query.ts";
import type { SelectorEntry } from "../../content/selectors.ts";
import type { GmailFeature } from "../feature.ts";

const ICON = 16;

export const SENDER_ICONS_CSS = `
.meru-sender-icons { display: flex; align-items: center; justify-content: flex-end; min-width: ${ICON * 1.5}px; margin-right: ${ICON / 2}px; }
.meru-sender-icons img { width: ${ICON}px; height: ${ICON}px; border-radius: 50%; background-color: #ffffff; }
.meru-sender-icons img + img { margin-left: -${ICON / 2}px; }`;

const SENDER = 'span[email*="@"]';

// A thread row carries each sender as a span with the address in `email`; `tr.zA` is Gmail's class for a thread row, which says the list shows while no sender is found.
export const senderIconsEntry: SelectorEntry = {
  anchor: SENDER,
  context: "tr.zA",
  hop: "tr[id]",
  id: "senderIcons",
};

const domainOf = (sender: Element): string | undefined => {
  const domain = sender.getAttribute("email")?.split("@")[1];
  return domain === undefined || domain === "" ? undefined : domain;
};

/** An icon for each domain the senders of a thread row write from, beside the senders, as 3.x drew them. */
export const senderIcons: GmailFeature = {
  apply: ({ document, scheduler, settings, style, undo }) => {
    if (!settings.switches.showSenderIcons) {
      style("");
      return;
    }
    style(SENDER_ICONS_CSS);
    const sources = new Map<string, string>();
    const sourceOf = (domain: string): string => {
      let source = sources.get(domain);
      if (source === undefined) {
        const url = new URL(settings.favicons);
        url.searchParams.set("domain", domain);
        url.searchParams.set("sz", String(ICON * 2));
        source = url.href;
        sources.set(domain, source);
      }
      return source;
    };
    undo(
      scheduler.register(senderIconsEntry, (row) => {
        const column = row.querySelector(SENDER)?.closest("td");
        if (
          column === null ||
          column === undefined ||
          column.querySelector(".meru-sender-icons") !== null
        ) {
          return;
        }
        const domains = new Set(
          queryAll(column, SENDER, isHtmlElement).flatMap(
            (sender) => domainOf(sender) ?? []
          )
        );
        if (domains.size === 0) {
          return;
        }
        const icons = document.createElement("div");
        icons.className = "meru-sender-icons";
        icons.id = `meru-sender-icons-${row.id}`;
        for (const domain of domains) {
          const icon = document.createElement("img");
          icon.alt = "";
          icon.src = sourceOf(domain);
          icon.title = domain;
          icons.append(icon);
        }
        column.append(icons);
      })
    );
    undo(() => {
      for (const icons of queryAll(
        document,
        ".meru-sender-icons",
        isHtmlElement
      )) {
        icons.remove();
      }
    });
  },
  id: "senderIcons",
};
