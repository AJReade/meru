import { describe, expect, it } from "vitest";

import { HttpTooLargeError, pageHttp } from "./http.ts";

// An endpoint that never answers, as a hung one does, until the request is aborted.
const hanging: typeof fetch = async (_input, init) => {
  const { promise, reject } = Promise.withResolvers<Response>();
  const signal = init?.signal;
  signal?.addEventListener("abort", () => {
    const reason: unknown = signal.reason;
    reject(reason instanceof Error ? reason : new Error("Aborted"));
  });
  return await promise;
};

const answering =
  (body: string, headers: Record<string, string> = {}): typeof fetch =>
  async () =>
    await Promise.resolve(new Response(body, { headers, status: 200 }));

describe(pageHttp, () => {
  it("aborts a request the endpoint never answers once the timeout is out", async () => {
    const http = pageHttp({ fetch: hanging, timeout: 20 });
    await expect(
      http.post("https://mail.google.com/s/", new FormData())
    ).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(http.get("https://mail.google.com/")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("reads a body up to the limit and refuses one past it, whether or not its length is declared", async () => {
    const body = "é".repeat(600);
    await expect(
      pageHttp({ fetch: answering(body) }).get("https://mail.google.com/", 1200)
    ).resolves.toMatchObject({ status: 200, text: body });
    await expect(
      pageHttp({ fetch: answering(body) }).get("https://mail.google.com/", 1199)
    ).rejects.toBeInstanceOf(HttpTooLargeError);
    await expect(
      pageHttp({
        fetch: answering("", { "content-length": "9000000" }),
      }).get("https://mail.google.com/", 5_000_000)
    ).rejects.toBeInstanceOf(HttpTooLargeError);
  });
});
