import type { GmailHttp } from "./rpc.ts";

const answer = async (response: Response) => ({
  status: response.status,
  text: await response.text(),
  url: response.url,
});

/** Gmail's endpoints as the page reaches them: a request from the page's own world carries its cookies, which is what the action endpoint asks for and main cannot send. */
export const pageHttp = (): GmailHttp => ({
  get: async (url) =>
    await answer(await fetch(url, { credentials: "include" })),
  post: async (url, body) =>
    await answer(
      await fetch(url, { body, credentials: "include", method: "POST" })
    ),
});
