import { isHtmlElement, queryAll } from "../../content/query.ts";
import type { SelectorEntry } from "../../content/selectors.ts";
import type { GmailFeature } from "../feature.ts";

const ICON = 16;

const SENDER_ICONS_CSS = `
.meru-sender-icons { display: flex; align-items: center; justify-content: flex-end; min-width: ${ICON * 1.5}px; margin-right: ${ICON / 2}px; }
.meru-sender-icons img { width: ${ICON}px; height: ${ICON}px; border-radius: 50%; background-color: #ffffff; }
.meru-sender-icons img + img { margin-left: -${ICON / 2}px; }`;

const SENDER = 'span[email*="@"]';

// A thread row carries each sender as a span with the address in `email`; `tr.zA` is Gmail's class for a thread row, which says the list shows while no sender is found.
const senderIconsEntry: SelectorEntry = {
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
    const decorate = (
      row: HTMLElement,
      column: HTMLElement,
      domains: ReadonlySet<string>
    ) => {
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
    };
    // Gmail keeps a row's element when new mail moves the list and redraws its cells, taking the icons with them, so every batch looks at every row again rather than at each row once; one query finds every row's senders and the icons it still has, since a list of a hundred rows would otherwise run several queries a row on every change of the page.
    undo(
      scheduler.everyBatch(() => {
        const columns = new Map<
          HTMLElement,
          { row: HTMLElement; domains: Set<string>; drawn: boolean }
        >();
        const rows = new Set<HTMLElement>();
        for (const found of queryAll(
          document,
          `tr.zA[id] ${SENDER}, tr.zA[id] .meru-sender-icons`,
          isHtmlElement
        )) {
          const column = found.closest("td");
          const row = column?.closest("tr");
          if (column === null || row === null || row === undefined) {
            continue;
          }
          let entry = columns.get(column);
          if (entry === undefined) {
            // A row's icons go beside its first sender, in that sender's cell.
            if (rows.has(row)) {
              continue;
            }
            rows.add(row);
            entry = { domains: new Set(), drawn: false, row };
            columns.set(column, entry);
          }
          if (found.classList.contains("meru-sender-icons")) {
            entry.drawn = true;
          } else {
            const domain = domainOf(found);
            if (domain !== undefined) {
              entry.domains.add(domain);
            }
          }
        }
        for (const [column, { domains, drawn, row }] of columns) {
          if (!drawn && domains.size > 0) {
            decorate(row, column, domains);
          }
        }
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
  entry: senderIconsEntry,
  id: "senderIcons",
};
