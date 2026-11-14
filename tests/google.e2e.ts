import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  entitlementKindOf,
  expect,
  inspect,
  must,
  pickApp,
  test,
} from "./app.ts";
import { startGoogleStub } from "./google-stub.ts";

test("shows what a Google app's page raises through Notification and its registration's showNotification, composed by main, and loads without a failure of the preload's", async ({
  launch,
  stub,
  userData,
}) => {
  const page = await startGoogleStub();
  try {
    // The setting is Pro, so the pane is opened only once the trial has arrived; a page that raised a notification before it would be refused.
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GOOGLE_URL: page.url },
    });
    await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");

    await chrome.locator("[data-launcher-button]").click();
    await pickApp(app, "Calendar");

    await expect
      .poll(async () => {
        const { notifications } = await inspect(app);
        return notifications.length;
      })
      .toBe(2);
    const { notifications } = await inspect(app);
    const constructed = must(notifications[0], "The constructed notification");
    const fromWorker = must(notifications[1], "The worker's notification");
    // The app's name is the title whatever the page called itself, and Calendar is silent because it plays its own sound.
    expect([constructed, fromWorker]).toMatchObject([
      { silent: true, title: "Calendar" },
      { silent: true, title: "Calendar" },
    ]);
    // macOS has a subtitle for what the page called the notification; elsewhere it goes above the body in it.
    const said = (shown: typeof constructed) =>
      [shown.subtitle, shown.body]
        .filter((line) => line !== undefined)
        .join(" ")
        .replaceAll("\n", " ");
    expect([said(constructed), said(fromWorker)]).toStrictEqual([
      "Standup Starts in ten minutes",
      "Lunch At noon",
    ]);
    const log = await readFile(
      path.join(userData, "logs", "main.log"),
      "utf-8"
    );
    expect(
      log.split("\n").filter((line) => line.includes('"level":"error"'))
    ).toStrictEqual([]);
  } finally {
    await page.stop();
  }
});
