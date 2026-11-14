import type { GmailHttp, HttpAnswer } from "./rpc.ts";

const MISSING: HttpAnswer = { status: 404, text: "" };

/** Gmail's endpoints as a test answers them: each request is kept, with the posted `s_jr` field, and each answer is the one it was given, or 404 with no body. */
export class FakeGmailHttp implements GmailHttp {
  readonly asked: string[] = [];
  readonly posted: { url: string; field: string }[] = [];
  readonly #answers = new Map<string, HttpAnswer>();
  #thrown: Error | undefined;

  /** Answers every request whose address starts with `prefix`, the longest prefix given winning. */
  answer(prefix: string, answer: HttpAnswer): void {
    this.#answers.set(prefix, answer);
  }

  /** Makes every request from now on reject, as a page whose network is gone does. */
  throwOn(error: Error): void {
    this.#thrown = error;
  }

  readonly get = async (url: string): Promise<HttpAnswer> => {
    this.asked.push(url);
    return await Promise.resolve(this.#answer(url));
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
    return (
      (matched === undefined ? undefined : this.#answers.get(matched)) ??
      MISSING
    );
  }
}
