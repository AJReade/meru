import { describe, expect, it, vi } from "vitest";

import { gmail, gmailPushes } from "../../../shared/channels/gmail.ts";
import { mountGmail, testSettings } from "../testing.ts";
import mailbox from "./fixtures/mailbox-key.html?raw";
import { mailAction } from "./mail-action.ts";

const MESSAGE = "18c1a2b3c4d5e6f7";
const COOKIE = "GMAIL_AT=at-token";

const mount = () =>
  mountGmail({
    cookie: COOKIE,
    features: [mailAction],
    html: mailbox,
  });

describe(mailAction.id, () => {
  it("acts on the message main asks for and says Gmail took it", async () => {
    const page = mount();
    page.http.answer(`${testSettings.mailbox}/s/`, { status: 200, text: "" });

    page.bridge.push(gmailPushes.mailAction, {
      action: "archive",
      id: 7,
      messageId: MESSAGE,
    });

    await vi.waitFor(() => {
      expect(page.bridge.sentOn(gmail.mailActed)).toStrictEqual([
        { acted: true, id: 7 },
      ]);
    });
    expect(page.bridge.sentOn(gmail.mailActionFailed)).toStrictEqual([]);
    expect(page.http.posted).toHaveLength(1);
    page.app.dispose();
  });

  it("says Gmail refused and reports the reason once a page load, however many actions are refused for it", async () => {
    const page = mount();
    page.http.answer(`${testSettings.mailbox}/s/`, {
      status: 200,
      text: `top.location="${testSettings.signIn}/ServiceLogin";`,
    });

    for (const id of [1, 2]) {
      page.bridge.push(gmailPushes.mailAction, {
        action: "markRead",
        id,
        messageId: MESSAGE,
      });
    }

    await vi.waitFor(() => {
      expect(page.bridge.sentOn(gmail.mailActed)).toStrictEqual([
        { acted: false, id: 1 },
        { acted: false, id: 2 },
      ]);
    });
    expect(page.bridge.sentOn(gmail.mailActionFailed)).toStrictEqual([
      { reason: "signIn" },
    ]);
    page.app.dispose();
  });

  it("answers an action asked for while the page is off the mailbox, where no marker is to be had", async () => {
    const page = mountGmail({
      cookie: COOKIE,
      features: [mailAction],
      href: `${testSettings.signIn}/v3/signin/identifier`,
      html: "<div></div>",
    });

    page.bridge.push(gmailPushes.mailAction, {
      action: "archive",
      id: 0,
      messageId: MESSAGE,
    });

    await vi.waitFor(() => {
      expect(page.bridge.sentOn(gmail.mailActed)).toStrictEqual([
        { acted: false, id: 0 },
      ]);
    });
    expect(page.bridge.sentOn(gmail.mailActionFailed)).toStrictEqual([
      { reason: "noMarker" },
    ]);
    page.app.dispose();
  });
});
