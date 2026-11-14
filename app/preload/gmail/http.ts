import { MAIL_ACTION_TIMEOUT } from "../../shared/channels/gmail.ts";
import type { GmailHttp, HttpAnswer } from "./rpc.ts";

/** An answer whose body ran past the limit it was asked with, read no further. */
export class HttpTooLargeError extends Error {
  constructor(limit: number) {
    super(`The answer ran past ${limit} bytes`);
    this.name = "HttpTooLargeError";
  }
}

const textOf = async (response: Response, limit: number): Promise<string> => {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new HttpTooLargeError(limit);
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return "";
  }
  const decoder = new TextDecoder();
  const rest = async (text: string, size: number): Promise<string> => {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    if (size + value.byteLength > limit) {
      await reader.cancel();
      throw new HttpTooLargeError(limit);
    }
    return await rest(
      text + decoder.decode(value, { stream: true }),
      size + value.byteLength
    );
  };
  return await rest("", 0);
};

interface PageHttpOptions {
  readonly fetch: typeof fetch;
  /** How long a request may take, its body included, before it is aborted. */
  readonly timeout: number;
}

/** Gmail's endpoints as the page reaches them: a request from the page's own world carries its cookies, which is what the action endpoint asks for and main cannot send. Each is aborted once main would stop waiting for it, so a hung endpoint holds nothing. */
export const pageHttp = (options: Partial<PageHttpOptions> = {}): GmailHttp => {
  const request = options.fetch ?? fetch;
  const timeout = options.timeout ?? MAIL_ACTION_TIMEOUT;
  const answer = async (
    url: string,
    init: RequestInit,
    limit = Number.POSITIVE_INFINITY
  ): Promise<HttpAnswer> => {
    const response = await request(url, {
      ...init,
      credentials: "include",
      signal: AbortSignal.timeout(timeout),
    });
    return {
      status: response.status,
      text: await textOf(response, limit),
      url: response.url,
    };
  };
  return {
    get: async (url, limit) => await answer(url, {}, limit),
    post: async (url, body) => await answer(url, { body, method: "POST" }),
  };
};
