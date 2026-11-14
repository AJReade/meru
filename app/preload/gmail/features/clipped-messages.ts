import { gmail } from "../../../shared/channels/gmail.ts";
import type { SelectorEntry } from "../../content/selectors.ts";
import type { GmailFeature } from "../feature.ts";
import { parseHtml } from "../html.ts";

// Gmail cuts a body over about 102 KB on the server, so the rest is never in the page; the "View entire message" link opens the print view of that one message, which holds the whole body.
export const clippedEntry: SelectorEntry = {
  anchor: '.iX > a[href*="view=lg"]',
  id: "clippedMessages",
};

const REMOVED =
  "script, iframe, frame, object, embed, applet, form, base, meta, link, noscript, template";
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
]);
/** How many whole messages a page keeps, so going back to a long thread does not fetch them again. */
export const CLIPPED_CACHE = 5;

const allowedUrl = (name: string, value: string, base: string): boolean => {
  let protocol: string;
  try {
    ({ protocol } = new URL(value, base));
  } catch {
    return false;
  }
  return (
    ALLOWED_PROTOCOLS.has(protocol) ||
    (name === "src" &&
      protocol === "data:" &&
      /^data:image\//iu.test(value.trim()))
  );
};

// Gmail's server sanitises the print view as it does the inline one; this keeps anything that runs code out of the page should that ever change.
const sanitise = (root: Element, base: string): void => {
  for (const element of root.querySelectorAll(REMOVED)) {
    element.remove();
  }
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const name of element.getAttributeNames()) {
      if (
        name.startsWith("on") ||
        (URL_ATTRIBUTES.has(name) &&
          !allowedUrl(name, element.getAttribute(name) ?? "", base))
      ) {
        element.removeAttribute(name);
      }
    }
  }
  // A link with no target would replace Gmail itself, which has no guard against it, rather than open through the window-open handler.
  for (const link of root.querySelectorAll("a[href]")) {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
};

/** The body of the print view's last message, sanitised. */
export const bodyOf = (html: string, base: string): Element => {
  const table = [...parseHtml(html).querySelectorAll("table.message")].at(-1);
  const body = [...(table?.querySelectorAll('font[size="-1"]') ?? [])].at(-1);
  if (body === undefined) {
    throw new Error("The print view holds no message body");
  }
  sanitise(body, base);
  return body;
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
        const page = await http.get(url.href);
        // Signed out, Gmail answers the print view with its sign-in page and a 200.
        if (
          page.status < 200 ||
          page.status > 299 ||
          new URL(page.url).origin !== url.origin
        ) {
          throw new Error(`The print view answered ${page.status}`);
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
    const fail = () => {
      if (once("clippedMessages.failed")) {
        bridge.send(gmail.selectorMiss, { selector: clippedEntry.id });
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
              clipped.replaceChildren(
                ...document.importNode(body, true).childNodes
              );
            }
          } catch {
            fail();
          }
        };
        void replace();
      })
    );
  },
  id: "clippedMessages",
};
