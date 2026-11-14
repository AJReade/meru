import { describe, expect, it } from "vitest";

import { gmail } from "../../../shared/channels/gmail.ts";
import { mountGmail, reached, stylesWith } from "../testing.ts";
import outOfOfficeBanner from "./fixtures/out-of-office.html?raw";
import { hideOutOfOfficeBannerRules, outOfOffice } from "./out-of-office.ts";

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

    document.querySelector(`[id=":7"]`)?.remove();
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
});
