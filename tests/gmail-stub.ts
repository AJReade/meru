import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";

import { NONE_UNREAD } from "../app/core/fixtures/gmail-feeds.ts";

export interface GmailStub {
  /** The mailbox, as the app takes it in `MERU_GMAIL_URL`. */
  readonly url: string;
  /** The stand-in sign-in page, where the app takes a page that lands to be signed out. */
  readonly signIn: string;
  /** Each action posted to the endpoint, in order: the token it named and the body it sent. */
  readonly actions: { at: string | null; body: string }[];
  /** The domains the senders' icons were asked for, in order. */
  readonly favicons: readonly string[];
  /** Answers the inbox feed with this text from now on. */
  readonly answer: (text: string) => void;
  readonly stop: () => Promise<void>;
}

/** An answer with no page: a status, and for a redirect, the stand-in's sign-in page as where it sends the request. */
export interface StubRefusal {
  readonly status: number;
  readonly toSignIn?: boolean;
}

/** What the mailbox answers besides its page: the print view of a message, `?view=lg`, and a pop-out, any other `?view=`. */
export interface GmailStubPages {
  readonly printView?: string | StubRefusal;
  readonly popOut?: string;
  /** A `?view=` the mailbox answers with a 302 to `path`, on the stand-in's own origin or, when `foreign`, on `localhost`, which is another origin to the page. */
  readonly redirects?: Readonly<
    Record<string, { readonly path: string; readonly foreign?: boolean }>
  >;
}

const MAILBOX_PATH = "/mail/u/0";

/** The token Gmail's action endpoint takes, which its page reads out of its own cookies. */
export const ACTION_TOKEN = "at-token";

// The smallest PNG, one transparent pixel, which is all an icon request needs.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

/** Where the mailbox redirects a `?view=`, if it does. */
const locationOf = (
  request: IncomingMessage,
  pages: GmailStubPages,
  view: string | null
): string | undefined => {
  const redirect = view === null ? undefined : pages.redirects?.[view];
  if (redirect === undefined) {
    return undefined;
  }
  const { port } = new URL(`http://${request.headers.host ?? ""}`);
  const host = redirect.foreign === true ? "localhost" : "127.0.0.1";
  return `http://${host}:${port}${redirect.path}`;
};

/** A loopback stand-in for Gmail: the mailbox page, which is `page`, its print view and pop-out when given, its action endpoint and the cookie that endpoint asks for, its feed, the senders' icons, and the sign-in page beside it. */
export const startGmailStub = async (
  page: string,
  pages: GmailStubPages = {}
): Promise<GmailStub> => {
  const actions: { at: string | null; body: string }[] = [];
  const favicons: string[] = [];
  let feed = NONE_UNREAD;
  const server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(
      request.url ?? "/",
      "http://stub"
    );
    const view = searchParams.get("view");
    const other = view === "lg" ? pages.printView : pages.popOut;
    const shown = view === null ? page : other;
    const redirect = locationOf(request, pages, view);
    if (pathname === `${MAILBOX_PATH}/` && redirect !== undefined) {
      response.writeHead(302, { location: redirect }).end();
    } else if (pathname === `${MAILBOX_PATH}/` && typeof shown === "object") {
      response
        .writeHead(
          shown.status,
          shown.toSignIn === true
            ? { location: `http://${request.headers.host ?? ""}/signin` }
            : {}
        )
        .end();
    } else if (pathname === `${MAILBOX_PATH}/` && shown !== undefined) {
      response
        .writeHead(200, {
          "content-type": "text/html",
          "set-cookie": `GMAIL_AT=${ACTION_TOKEN}; Path=/`,
        })
        .end(shown);
    } else if (pathname === `${MAILBOX_PATH}/s/`) {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        actions.push({
          at: searchParams.get("at"),
          body: Buffer.concat(chunks).toString(),
        });
        response.writeHead(200, { "content-type": "text/plain" }).end(")]}'\n");
      });
    } else if (pathname === "/favicons") {
      favicons.push(searchParams.get("domain") ?? "");
      response.writeHead(200, { "content-type": "image/png" }).end(PIXEL);
    } else if (pathname === `${MAILBOX_PATH}/feed/atom`) {
      response
        .writeHead(200, { "content-type": "application/atom+xml" })
        .end(feed);
    } else if (pathname === "/signin") {
      response
        .writeHead(200, { "content-type": "text/html" })
        .end("<!doctype html><title>Sign in</title>");
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The Gmail stub has no port");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    actions,
    answer: (text) => {
      feed = text;
    },
    favicons,
    signIn: `${origin}/signin`,
    stop: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
    url: `${origin}${MAILBOX_PATH}`,
  };
};
