import { HttpTooLargeError } from "./http.ts";
import type { GmailHttp, HttpAnswer } from "./rpc.ts";

type GivenAnswer = Omit<HttpAnswer, "url"> & { readonly url?: string };

const MISSING: GivenAnswer = { status: 404, text: "" };

/** Gmail's endpoints as a test answers them: each request is kept, with the posted `s_jr` field, and each answer is the one it was given, or 404 with no body, and a `get` past its limit rejects as the page's does. */
export class FakeGmailHttp implements GmailHttp {
  readonly asked: string[] = [];
  readonly posted: { url: string; field: string }[] = [];
  readonly #answers = new Map<string, GivenAnswer>();
  #thrown: Error | undefined;

  /** Answers every request whose address starts with `prefix`, the longest prefix given winning, from the address asked for unless the answer names where a redirect ended. */
  answer(prefix: string, answer: GivenAnswer): void {
    this.#answers.set(prefix, answer);
  }

  /** Makes every request from now on reject, as a page whose network is gone does. */
  throwOn(error: Error): void {
    this.#thrown = error;
  }

  readonly get = async (url: string, limit?: number): Promise<HttpAnswer> => {
    this.asked.push(url);
    const answer = this.#answer(url);
    if (limit !== undefined && new Blob([answer.text]).size > limit) {
      throw new HttpTooLargeError(limit);
    }
    return await Promise.resolve(answer);
  };

  readonly post = async (url: string, body: FormData): Promise<HttpAnswer> => {
    const field = body.get("s_jr");
    this.posted.push({ field: typeof field === "string" ? field : "", url });
    return await Promise.resolve(this.#answer(url));
  };

  #answer(url: string): HttpAnswer {
    if (this.#thrown !== undefined) {
      throw this.#thrown;
    }
    const matched = [...this.#answers.keys()]
      .filter((prefix) => url.startsWith(prefix))
      .toSorted((left, right) => right.length - left.length)
      .at(0);
    const given =
      (matched === undefined ? undefined : this.#answers.get(matched)) ??
      MISSING;
    return { ...given, url: given.url ?? url };
  }
}
