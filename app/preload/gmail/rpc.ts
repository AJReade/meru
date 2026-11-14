import { isSignIn } from "../../core/engines/links.ts";
import { err, ok } from "../../core/result.ts";
import type { Result } from "../../core/result.ts";
import type {
  MailAction,
  MailActionRefusal,
} from "../../shared/channels/gmail.ts";

/** What Gmail answered: its status and the body, which says more than the status does. */
export interface HttpAnswer {
  readonly status: number;
  readonly text: string;
  /** The address the answer came from, after any redirect. */
  readonly url: string;
}

/** The two requests Gmail's own endpoints take, as the page's `fetch` makes them, with the page's cookies. */
export interface GmailHttp {
  readonly get: (url: string) => Promise<HttpAnswer>;
  readonly post: (url: string, body: FormData) => Promise<HttpAnswer>;
}

export interface GmailRpcOptions {
  readonly http: GmailHttp;
  /** The address of the mailbox, which the endpoints hang off, as the settings in force give it. */
  readonly mailbox: () => string;
  /** The address Google's sign-in starts with, which Gmail's refusal sends the page to. */
  readonly signIn: () => string;
  /** The page's own markup, where Gmail writes the marker of the build that served it. */
  readonly markup: () => string;
  /** The page's cookies, which carry the action token. */
  readonly cookie: () => string;
  readonly now: () => number;
}

/** Gmail's code for each action, which its endpoint takes in place of a name. */
const ACTION_CODES = { archive: 1, markRead: 3 } as const satisfies Record<
  MailAction,
  number
>;

// Gmail writes the key of the build that served the page into the mailbox's HTML, and its action endpoint refuses a request that names another.
const MARKER = /var GM_ID_KEY\s*=\s*["'](?<key>[a-z0-9]+)["']/iu;

const TOKEN_COOKIE = "GMAIL_AT=";

// Gmail answers a request it refuses with 200 and a script that takes the page to sign-in, so the body is the only thing that tells a refusal from success.
const REDIRECT = /top\.location\s*(?:\.href\s*)?=\s*["'](?<url>[^"']+)["']/u;

const tokenOf = (cookie: string): string | undefined =>
  cookie
    .split("; ")
    .find((pair) => pair.startsWith(TOKEN_COOKIE))
    ?.slice(TOKEN_COOKIE.length);

/** The one module that speaks Gmail's private action endpoint, which needs the page's cookies and the marker of the build that served it, and so cannot be spoken from main. Every refusal is answered, never swallowed: the marker is read again on the next action, since a refusal is what a stale one looks like. */
export class GmailRpc {
  readonly #options: GmailRpcOptions;
  /** Read once a page load, and again after a refusal. */
  #marker: string | undefined;

  constructor(options: GmailRpcOptions) {
    this.#options = options;
  }

  async archive(
    messageId: string
  ): Promise<Result<undefined, MailActionRefusal>> {
    return await this.act("archive", messageId);
  }

  async markRead(
    messageId: string
  ): Promise<Result<undefined, MailActionRefusal>> {
    return await this.act("markRead", messageId);
  }

  async act(
    action: MailAction,
    messageId: string
  ): Promise<Result<undefined, MailActionRefusal>> {
    try {
      return await this.#send(action, messageId);
    } catch {
      this.#marker = undefined;
      return err("threw");
    }
  }

  async #send(
    action: MailAction,
    messageId: string
  ): Promise<Result<undefined, MailActionRefusal>> {
    const { cookie, http, mailbox, now } = this.#options;
    const marker = this.#marker ?? (await this.#readMarker());
    if (marker === undefined) {
      return err("noMarker");
    }
    this.#marker = marker;
    const token = tokenOf(cookie());
    if (token === undefined) {
      return err("noToken");
    }
    const answer = await http.post(
      `${mailbox()}/s/?v=or&ik=${marker}&at=${token}&subui=chrome&hl=en&ts=${now()}`,
      actionBody(marker, ACTION_CODES[action], messageId)
    );
    if (answer.status < 200 || answer.status >= 300) {
      this.#marker = undefined;
      return err("status");
    }
    if (this.#refused(answer.text)) {
      this.#marker = undefined;
      return err("signIn");
    }
    return ok(undefined);
  }

  async #readMarker(): Promise<string | undefined> {
    const written = MARKER.exec(this.#options.markup())?.groups?.key;
    if (written !== undefined) {
      return written;
    }
    // Gmail's own navigation can replace the document the marker was written into, so the mailbox is asked for a page that still carries it.
    const answer = await this.#options.http.get(`${this.#options.mailbox()}/`);
    return MARKER.exec(answer.text)?.groups?.key;
  }

  #refused(text: string): boolean {
    const sent = REDIRECT.exec(text)?.groups?.url;
    return (
      sent !== undefined &&
      (isSignIn(sent) || sent.startsWith(this.#options.signIn()))
    );
  }
}

/** The form Gmail's endpoint takes an action in: one `s_jr` field holding the action's code, the message twice, the view it is taken in and the marker, as 3.x sends it. */
const actionBody = (
  marker: string,
  code: number,
  messageId: string
): FormData => {
  const body = new FormData();
  body.append(
    "s_jr",
    JSON.stringify([
      null,
      [
        [
          null,
          null,
          null,
          [null, code, messageId, messageId, "l:all", [], [], []],
        ],
        [null, null, null, null, null, null, [null, true, false]],
        [null, null, null, null, null, null, [null, true, false]],
      ],
      2,
      null,
      null,
      null,
      marker,
    ])
  );
  return body;
};
