import { once } from "node:events";
import { createServer } from "node:http";

import { NONE_UNREAD } from "../app/core/fixtures/gmail-feeds.ts";

export interface GmailStub {
  /** The mailbox, as the app takes it in `MERU_GMAIL_URL`. */
  readonly url: string;
  /** The stand-in sign-in page, where the app takes a page that lands to be signed out. */
  readonly signIn: string;
  /** Each action posted to the endpoint, in order: the token it named and the body it sent. */
  readonly actions: { at: string | null; body: string }[];
  /** Answers the inbox feed with this text from now on. */
  readonly answer: (text: string) => void;
  readonly stop: () => Promise<void>;
}

const MAILBOX_PATH = "/mail/u/0";

/** The token Gmail's action endpoint takes, which its page reads out of its own cookies. */
export const ACTION_TOKEN = "at-token";

/** A loopback stand-in for Gmail: the mailbox page, which is `page`, its action endpoint and the cookie that endpoint asks for, its feed, and the sign-in page beside it. */
export const startGmailStub = async (page: string): Promise<GmailStub> => {
  const actions: { at: string | null; body: string }[] = [];
  let feed = NONE_UNREAD;
  const server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(
      request.url ?? "/",
      "http://stub"
    );
    if (pathname === `${MAILBOX_PATH}/`) {
      response
        .writeHead(200, {
          "content-type": "text/html",
          "set-cookie": `GMAIL_AT=${ACTION_TOKEN}; Path=/`,
        })
        .end(page);
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
    signIn: `${origin}/signin`,
    stop: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
    url: `${origin}${MAILBOX_PATH}`,
  };
};
