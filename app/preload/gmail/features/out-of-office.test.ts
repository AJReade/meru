import { describe, expect, it } from "vitest";

import { gmail } from "../../../shared/channels/gmail.ts";
import { mountGmail, reached, stylesWith } from "../testing.ts";
import attachments from "./fixtures/attachments.html?raw";
import clipped from "./fixtures/clipped.html?raw";
import inboxRows from "./fixtures/inbox-rows.html?raw";
import outOfOfficeBanner from "./fixtures/out-of-office.html?raw";
import {
  NOTICE_BAR,
  OUT_OF_OFFICE_BANNER,
  bannerOf,
  hideOutOfOfficeBannerRules,
  outOfOffice,
} from "./out-of-office.ts";

const missesAfterGrace = async (html: string) => {
  let now = 0;
  const page = mountGmail({
    features: [outOfOffice()],
    grace: 10,
    html,
    now: () => now,
  });
  page.run();
  now = 100_000;
  document.body.append(document.createElement("p"));
  await page.settle();
  const misses = page.bridge.sentOn(gmail.selectorMiss);
  page.app.dispose();
  return misses;
};

describe(outOfOffice, () => {
  it("says the profile is out of office while the banner shows, and only when that changes", async () => {
    const page = mountGmail({
      features: [outOfOffice()],
      html: outOfOfficeBanner,
    });
    page.run();
    document.body.append(document.createElement("p"));
    await page.settle();

    expect(page.bridge.sentOn(gmail.outOfOffice)).toStrictEqual([{ on: true }]);

    // Gmail empties the bar when the reply is turned off.
    document.querySelector(OUT_OF_OFFICE_BANNER)?.replaceChildren();
    await page.settle();

    expect(page.bridge.sentOn(gmail.outOfOffice)).toStrictEqual([
      { on: true },
      { on: false },
    ]);
    page.app.dispose();
  });

  it("takes no other alert linking to the general settings for the banner", () => {
    const page = mountGmail({
      features: [outOfOffice()],
      html: `<div role="alert">Enable desktop notifications for Gmail. <a href="https://mail.google.com/mail/u/0/#settings/general">OK</a></div><div role="main"></div>`,
    });
    page.run();

    expect(page.bridge.sentOn(gmail.outOfOffice)).toStrictEqual([
      { on: false },
    ]);
    page.app.dispose();
  });

  it("takes the empty bar of a page whose reply is off for no banner", () => {
    const page = mountGmail({ features: [outOfOffice()], html: inboxRows });
    page.run();

    expect(document.querySelector(NOTICE_BAR)?.childElementCount).toBe(0);
    expect(page.bridge.sentOn(gmail.outOfOffice)).toStrictEqual([
      { on: false },
    ]);
    page.app.dispose();
  });

  it("hides the banner under gmail.hideOutOfOfficeBanner and still sees it", () => {
    const page = mountGmail({
      features: [outOfOffice()],
      html: outOfOfficeBanner,
      settings: { styles: stylesWith("hideOutOfOfficeBanner") },
    });
    page.run();

    expect(page.sheet("hideOutOfOfficeBanner")).toContain("display: none");
    expect(
      reached(hideOutOfOfficeBannerRules).map((element) => element.id)
    ).toContain(":7");
    expect(page.bridge.sentOn(gmail.outOfOffice)).toStrictEqual([{ on: true }]);
    page.app.dispose();
  });

  it("says once that a page without the banner is not out of office", () => {
    const page = mountGmail({
      features: [outOfOffice()],
      html: "<div role=main></div>",
    });
    page.run();
    page.change({});
    page.run();

    expect(page.bridge.sentOn(gmail.outOfOffice)).toStrictEqual([
      { on: false },
    ]);
    page.app.dispose();
  });

  it("finds the banner the style rule hides, and nothing on the captured pages without it", () => {
    expect(
      [outOfOfficeBanner, inboxRows, attachments, clipped].map((html) => {
        document.body.innerHTML = html;
        const found = bannerOf(document);
        return [
          found?.id,
          found === (document.querySelector(OUT_OF_OFFICE_BANNER) ?? undefined),
        ];
      })
    ).toStrictEqual([
      [":7", true],
      [undefined, true],
      [undefined, true],
      [undefined, true],
    ]);
  });

  it("reports no miss while the bar is on the page, and one once it has rotted", async () => {
    await expect(missesAfterGrace(inboxRows)).resolves.toStrictEqual([]);
    await expect(
      missesAfterGrace(inboxRows.replace('<h1 class="qp">', '<h2 class="qp">'))
    ).resolves.toStrictEqual([{ selector: "outOfOfficeBar" }]);
  });
});
