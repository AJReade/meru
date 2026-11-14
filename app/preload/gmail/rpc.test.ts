import { beforeEach, describe, expect, it } from "vitest";

import { FakeGmailHttp } from "./fake-http.ts";
import mailbox from "./features/fixtures/mailbox-key.html?raw";
import { GmailRpc } from "./rpc.ts";
import { MAILBOX, testSettings } from "./testing.ts";

const MARKER = "abc123def";
const MESSAGE = "18c1a2b3c4d5e6f7";
const COOKIE = "SID=x; GMAIL_AT=at-token; OTHER=1";
/** What Gmail answers a refused action with: 200, and a script taking the page to sign-in. */
const REFUSAL = `top.location="${testSettings.signIn}/ServiceLogin?service=mail";`;

const setup = (
  options: { html?: string; cookie?: string } = {}
): { http: FakeGmailHttp; rpc: GmailRpc } => {
  document.body.innerHTML = options.html ?? mailbox;
  const http = new FakeGmailHttp();
  const rpc = new GmailRpc({
    cookie: () => options.cookie ?? COOKIE,
    http,
    mailbox: () => MAILBOX,
    markup: () => document.documentElement.outerHTML,
    now: () => 1700,
    signIn: () => testSettings.signIn,
  });
  return { http, rpc };
};

const asked = (field: string): unknown => JSON.parse(field);

/** The form Gmail's endpoint takes the action of this code in, as 3.x sent it. */
const body = (code: number): unknown => [
  null,
  [
    [null, null, null, [null, code, MESSAGE, MESSAGE, "l:all", [], [], []]],
    [null, null, null, null, null, null, [null, true, false]],
    [null, null, null, null, null, null, [null, true, false]],
  ],
  2,
  null,
  null,
  null,
  MARKER,
];

describe(GmailRpc, () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("archives a message with the marker the page carries and the token its cookies do", async () => {
    const { http, rpc } = setup();
    http.answer(`${MAILBOX}/s/`, { status: 200, text: "" });

    await expect(rpc.archive(MESSAGE)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(http.posted).toHaveLength(1);
    expect(http.posted[0]?.url).toBe(
      `${MAILBOX}/s/?v=or&ik=${MARKER}&at=at-token&subui=chrome&hl=en&ts=1700`
    );
    expect(asked(http.posted[0]?.field ?? "")).toStrictEqual(body(1));
    // The mailbox is asked for nothing: the page it is loaded in carries the marker.
    expect(http.asked).toStrictEqual([]);
  });

  it("marks a message read under Gmail's own code for it, reading the marker once however many actions follow", async () => {
    const { http, rpc } = setup();
    http.answer(`${MAILBOX}/s/`, { status: 200, text: "" });

    await expect(rpc.markRead(MESSAGE)).resolves.toMatchObject({ ok: true });
    await expect(rpc.markRead(MESSAGE)).resolves.toMatchObject({ ok: true });
    expect(http.posted.map((post) => asked(post.field))).toStrictEqual([
      body(3),
      body(3),
    ]);
    expect(http.asked).toStrictEqual([]);
  });

  it("asks the mailbox for the marker when the page it is loaded in carries none", async () => {
    const { http, rpc } = setup({ html: "<div role='main'></div>" });
    http.answer(`${MAILBOX}/`, { status: 200, text: mailbox });
    http.answer(`${MAILBOX}/s/`, { status: 200, text: "" });

    await expect(rpc.archive(MESSAGE)).resolves.toMatchObject({ ok: true });
    expect(http.asked).toStrictEqual([`${MAILBOX}/`]);
    expect(http.posted[0]?.url).toContain(`ik=${MARKER}`);
  });

  it("refuses when neither the page nor the mailbox carries a marker, and when the cookies carry no token", async () => {
    const { http, rpc } = setup({ html: "<div role='main'></div>" });
    http.answer(`${MAILBOX}/`, { status: 200, text: "<title>Sign in</title>" });

    await expect(rpc.archive(MESSAGE)).resolves.toStrictEqual({
      error: "noMarker",
      ok: false,
    });
    expect(http.posted).toStrictEqual([]);

    const tokenless = setup({ cookie: "SID=x" });
    await expect(tokenless.rpc.archive(MESSAGE)).resolves.toStrictEqual({
      error: "noToken",
      ok: false,
    });
    expect(tokenless.http.posted).toStrictEqual([]);
  });

  it("reads Gmail's sign-in script as a refusal, though it comes with 200, and reads the marker again after one", async () => {
    const { http, rpc } = setup();
    http.answer(`${MAILBOX}/s/`, { status: 200, text: REFUSAL });

    await expect(rpc.archive(MESSAGE)).resolves.toStrictEqual({
      error: "signIn",
      ok: false,
    });

    document.body.innerHTML = "<div role='main'></div>";
    http.answer(`${MAILBOX}/`, { status: 200, text: mailbox });
    await expect(rpc.archive(MESSAGE)).resolves.toMatchObject({ ok: false });
    expect(http.asked).toStrictEqual([`${MAILBOX}/`]);
  });

  it("refuses an answer that is not a 2xx, and a request that threw", async () => {
    const { http, rpc } = setup();
    http.answer(`${MAILBOX}/s/`, { status: 500, text: "" });

    await expect(rpc.archive(MESSAGE)).resolves.toStrictEqual({
      error: "status",
      ok: false,
    });

    http.throwOn(new Error("the network is gone"));
    await expect(rpc.archive(MESSAGE)).resolves.toStrictEqual({
      error: "threw",
      ok: false,
    });
  });
});
