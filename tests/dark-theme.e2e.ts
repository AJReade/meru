import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ElectronApplication, Page } from "@playwright/test";
import { z } from "zod";

import { settings } from "../app/shared/channels/settings.ts";
import { settingSet } from "../app/shared/settings/schema.ts";
import { invokeIn } from "../scripts/lib/app.ts";
import { entitlementKindOf, expect, must, panesOf, test } from "./app.ts";
import { startGmailStub } from "./gmail-stub.ts";

const FIXTURES = path.join(
  import.meta.dirname,
  "..",
  "app/preload/gmail/features/fixtures"
);

/** A conversation under Gmail's dark theme, its sheet light, holding one mail of the corpus. */
const mailbox = async (mail: string): Promise<string> => {
  const conversation = await readFile(
    path.join(FIXTURES, "conversation-dark.html"),
    "utf-8"
  );
  const body = await readFile(path.join(FIXTURES, "corpus", mail), "utf-8");
  const style = must(
    /<style>[\s\S]*?<\/style>/u.exec(conversation)?.[0],
    "the fixture's style sheet"
  );
  return `<!doctype html><title>Gmail</title>${style}<div role="main"><div class="nH"><div class="nH a98 iY"><h2 class="hP" data-legacy-thread-id="thread-1">Subject</h2><div role="list"><div role="listitem" class="adn ads" data-message-id="m1"><div class="gs"><div class="ii gt">${body}</div></div></div></div></div></div></div>`;
};

const inPane = async (app: ElectronApplication, code: string) => {
  const [pane] = await panesOf(app);
  const { contentsId } = must(pane, "a pane");
  return await app.evaluate(
    async ({ webContents }, [id, script]) => {
      const answer: unknown = await webContents
        .fromId(id)
        ?.executeJavaScript(script, true);
      return answer;
    },
    [contentsId, code] as const
  );
};

const setTo = async (chrome: Page, value: boolean) => {
  await invokeIn(
    chrome,
    settings.set,
    must(settingSet("gmail.extendDarkTheme", value), "the setting as a switch")
  );
};

// The sheet's ground as Chromium paints it, and how many elements carry the theme's mark, whose name ends in a suffix drawn for the page load.
const STATE = `[getComputedStyle(document.querySelector(".iY")).backgroundColor, [...document.querySelectorAll("*")].filter((element) => element.getAttributeNames().some((name) => name.startsWith("data-meru-dark-"))).length]`;
const STATE_SCHEMA = z.tuple([z.string(), z.number()]);

test("darkens a mail under Gmail's dark theme while the setting is on, and gives it back as it was", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(await mailbox("13-receipt.html"));
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");
    await expect
      .poll(async () => await inPane(app, STATE))
      .toStrictEqual(["rgb(255, 255, 255)", 0]);
    const before = await inPane(
      app,
      `document.querySelector(".a3s").outerHTML`
    );

    await setTo(chrome, true);
    await expect
      .poll(async () => {
        const [ground, marked] = STATE_SCHEMA.parse(await inPane(app, STATE));
        return [ground !== "rgb(255, 255, 255)", marked > 0];
      })
      .toStrictEqual([true, true]);

    await setTo(chrome, false);
    await expect
      .poll(async () => await inPane(app, STATE))
      .toStrictEqual(["rgb(255, 255, 255)", 0]);
    expect(await inPane(app, `document.querySelector(".a3s").outerHTML`)).toBe(
      before
    );
  } finally {
    await gmail.stop();
  }
});
