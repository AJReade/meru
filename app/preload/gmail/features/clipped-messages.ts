import { gmail } from "../../../shared/channels/gmail.ts";
import type { ClippedFailure } from "../../../shared/channels/gmail.ts";
import type { SelectorEntry } from "../../content/selectors.ts";
import type { GmailFeature } from "../feature.ts";
import { parseHtml } from "../html.ts";
import { HttpTooLargeError } from "../http.ts";
import { sanitise } from "../sanitise.ts";

// Gmail cuts a body over about 102 KB on the server, so the rest is never in the page; the "View entire message" link opens the print view of that one message, which holds the whole body.
const clippedEntry: SelectorEntry = {
  anchor: '.iX > a[href*="view=lg"]',
  id: "clippedMessages",
};

/** How many whole messages a page keeps, so going back to a long thread does not fetch them again. */
const CLIPPED_CACHE = 5;

/** The most of a print view a page reads; Gmail clips a body at about 102 KB, so a whole one past this is not mail a page should hold. */
export const PRINT_VIEW_LIMIT = 5 * 1024 * 1024;

class ClippedError extends Error {
  readonly reason: ClippedFailure;
  readonly status: number | null;

  constructor(reason: ClippedFailure, status: number | null = null) {
    super(`The print view did not load: ${reason}`);
    this.name = "ClippedError";
    this.reason = reason;
    this.status = status;
  }
}

const failureOf = (error: unknown): ClippedError => {
  if (error instanceof ClippedError) {
    return error;
  }
  return new ClippedError(
    error instanceof HttpTooLargeError ? "tooLarge" : "threw"
  );
};

/** The body of the print view's last message, sanitised. */
export const bodyOf = (html: string, base: string): Element => {
  const table = [...parseHtml(html).querySelectorAll("table.message")].at(-1);
  const body = [...(table?.querySelectorAll('font[size="-1"]') ?? [])].at(-1);
  if (body === undefined) {
    throw new ClippedError("noBody");
  }
  sanitise(body, base);
  return body;
};

/** The body's content in a box of its own on Gmail's page: a stacking context, so nothing in it rises above Gmail's own layers, that clips what a margin pulls outside it and scrolls what is wider. */
const contained = (document: Document, body: Element): HTMLElement => {
  const box = document.createElement("div");
  box.dataset.meruClipped = "";
  box.style.setProperty("position", "relative");
  box.style.setProperty("isolation", "isolate");
  box.style.setProperty("overflow", "auto");
  box.append(...document.importNode(body, true).childNodes);
  return box;
};

/** Replaces a clipped message's "View entire message" with the whole message, fetched from Gmail's print view in the page's own session. */
export const clippedMessages: GmailFeature = {
  apply: ({
    bridge,
    document,
    http,
    location,
    once,
    scheduler,
    settings,
    undo,
  }) => {
    if (!settings.switches.loadClippedMessages) {
      return;
    }
    const loaded = new Map<string, Promise<Element>>();
    const load = async (url: URL): Promise<Element> => {
      const key = url.searchParams.get("permmsgid") ?? url.href;
      const cached = loaded.get(key);
      if (cached !== undefined) {
        return await cached;
      }
      const request = (async () => {
        const page = await http.get(url.href, PRINT_VIEW_LIMIT);
        // Signed out, Gmail redirects the print view to its sign-in page.
        if (page.redirected) {
          throw new ClippedError("signIn");
        }
        if (page.status < 200 || page.status > 299) {
          throw new ClippedError("status", page.status);
        }
        return bodyOf(page.text, url.href);
      })();
      loaded.set(key, request);
      request.catch(() => {
        if (loaded.get(key) === request) {
          loaded.delete(key);
        }
      });
      if (loaded.size > CLIPPED_CACHE) {
        const [oldest] = loaded.keys();
        if (oldest !== undefined) {
          loaded.delete(oldest);
        }
      }
      return await request;
    };
    const fail = (error: unknown) => {
      const { reason, status } = failureOf(error);
      if (once(`clippedMessages ${reason}`)) {
        bridge.send(gmail.clippedFailed, { reason, status });
      }
    };
    undo(
      scheduler.register(clippedEntry, (link) => {
        const href = link.getAttribute("href");
        const page = new URL(location.href());
        if (href === null) {
          return;
        }
        const url = new URL(href, page);
        const clipped = link.closest(".iX")?.parentElement;
        if (
          url.origin !== page.origin ||
          url.searchParams.get("view") !== "lg" ||
          url.searchParams.get("permmsgid") === null ||
          clipped === null ||
          clipped === undefined ||
          clipped.closest(".a3s") === null
        ) {
          return;
        }
        const replace = async () => {
          try {
            const body = await load(url);
            if (link.isConnected) {
              clipped.replaceChildren(contained(document, body));
            }
          } catch (error) {
            fail(error);
          }
        };
        void replace();
      })
    );
  },
  id: "clippedMessages",
};
