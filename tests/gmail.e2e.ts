import type { ElectronApplication } from "@playwright/test";

import { ONE_UNREAD } from "../app/core/fixtures/gmail-feeds.ts";
import { E2E_ACT_NOTIFICATION } from "../app/main/shell/e2e.ts";
import { settings } from "../app/shared/channels/settings.ts";
import { invokeIn } from "../scripts/lib/app.ts";
import {
  callExposed,
  expect,
  inspect,
  issuedNow,
  panesOf,
  profilesOf,
  test,
  wake,
} from "./app.ts";
import { ACTION_TOKEN, startGmailStub } from "./gmail-stub.ts";

const HEADER = `<!doctype html><title>Gmail</title>
<header role="banner"><div><div><a href="#inbox" aria-label="Gmail"><img alt="Gmail" /></a></div></div></header>`;

/** The mailbox as Gmail serves it: the marker its action endpoint takes, written into the page. */
const MAILBOX = `<!doctype html><title>Gmail</title>
<script>var GM_ID_KEY = 'abc123def';</script>
<div role="main"></div>`;

// A header Gmail has changed under the logo's selector entry, so the entry misses.
const CHANGED_HEADER = `<!doctype html><title>Gmail</title>
<header role="banner"><div><span aria-label="Gmail">Gmail</span></div></header>`;

/** Runs `code` in the Gmail pane's page and gives back what it answered. */
const inPane = async (app: ElectronApplication, code: string) => {
  const [pane] = await panesOf(app);
  if (pane === undefined) {
    throw new Error("The window shows no pane");
  }
  return await app.evaluate(
    async ({ webContents }, [contentsId, script]) => {
      const answer: unknown = await webContents
        .fromId(contentsId)
        ?.executeJavaScript(script, true);
      return answer;
    },
    [pane.contentsId, code] as const
  );
};

const styleShown = async (app: ElectronApplication) =>
  await inPane(
    app,
    'document.querySelector(\'style[data-meru-style="hideGmailLogo"]\') !== null && getComputedStyle(document.querySelector("header > div")).display === "none"'
  );

test("styles the Gmail pane from the settings, following a change at once, and reports a sign-in page", async ({
  launch,
}) => {
  const stub = await startGmailStub(HEADER);
  try {
    const { app, chrome } = await launch({
      env: { MERU_GMAIL_URL: stub.url },
    });
    await expect.poll(async () => await styleShown(app)).toBe(true);

    await invokeIn(chrome, settings.set, {
      key: "gmail.hideGmailLogo",
      value: false,
    });
    await expect.poll(async () => await styleShown(app)).toBe(false);

    await inPane(app, `location.href = ${JSON.stringify(stub.signIn)}`);
    await expect
      .poll(async () => {
        const { profiles } = await profilesOf(chrome);
        return profiles[0]?.status;
      })
      .toStrictEqual({ kind: "needsSignIn" });
  } finally {
    await stub.stop();
  }
});

test("writes a warning when a selector entry finds nothing on Gmail's page", async ({
  launch,
}) => {
  test.setTimeout(40_000);
  const stub = await startGmailStub(CHANGED_HEADER);
  try {
    const { app } = await launch({ env: { MERU_GMAIL_URL: stub.url } });
    // A run from the repository mirrors its log to the console, a warning on standard error, which the suite reads alike on every platform.
    let written = "";
    app.process().stderr?.on("data", (chunk: Buffer) => {
      written += chunk.toString();
    });
    // The preload waits out a grace of ten seconds before it calls a selector missing.
    await expect
      .poll(() => written, { timeout: 25_000 })
      .toContain("A Gmail selector found nothing");
  } finally {
    await stub.stop();
  }
});

test("acts on a message from a notification's button through the Gmail page, which holds the marker and the token the action endpoint asks for", async ({
  launch,
}) => {
  const stub = await startGmailStub(MAILBOX);
  try {
    const { app, chrome } = await launch({ env: { MERU_GMAIL_URL: stub.url } });
    await invokeIn(chrome, settings.set, {
      key: "notifications.actions",
      value: true,
    });
    // A feed's first read only remembers what it lists, so the mail must arrive after it, or a slow launch reads it first and never calls it new.
    await expect
      .poll(async () => {
        const { profiles } = await profilesOf(chrome);
        return profiles[0]?.status;
      })
      .toStrictEqual({ kind: "ok", unreadCount: 0 });

    stub.answer(issuedNow(ONE_UNREAD));
    await wake(app);
    await expect
      .poll(async () => {
        const { notifications } = await inspect(app);
        return notifications.at(0)?.actions;
      })
      .toStrictEqual(["Archive", "Mark as read"]);

    await callExposed(app, E2E_ACT_NOTIFICATION, [0, 0]);
    await expect.poll(() => stub.actions).toHaveLength(1);
    const [posted] = stub.actions;
    // Gmail's own form, as 3.x sent it: the archive code and the message, named twice, beside the marker the page carries and the token its cookies do.
    expect(posted?.body).toContain(',1,"18c1a2b3c4d5e6f9","18c1a2b3c4d5e6f9"');
    expect(posted?.body).toContain("abc123def");
    expect(posted?.at).toBe(ACTION_TOKEN);
  } finally {
    await stub.stop();
  }
});
