import { describe, expect, it } from "vitest";

import { gmail } from "../../../shared/channels/gmail.ts";
import { MAILBOX, mountGmail, reached, stylesWith } from "../testing.ts";
import attachments from "./fixtures/attachments.html?raw";
import inboxRows from "./fixtures/inbox-rows.html?raw";
import { hideInboxFooter, hideInboxFooterRules } from "./hide-inbox-footer.ts";

const afterGrace = async (html: string, href = `${MAILBOX}/#inbox`) => {
  let now = 0;
  const page = mountGmail({
    features: [hideInboxFooter],
    grace: 10,
    href,
    html,
    now: () => now,
    settings: { styles: stylesWith("hideInboxFooter") },
  });
  page.run();
  now = 100_000;
  document.body.append(document.createElement("p"));
  await page.settle();
  const result = {
    misses: page.bridge.sentOn(gmail.selectorMiss),
    reached: reached(hideInboxFooterRules).length,
  };
  page.app.dispose();
  return result;
};

describe(hideInboxFooter.id, () => {
  it("reaches every copy of the footer on the inbox, the one under the list among them, and goes with the setting", () => {
    const page = mountGmail({
      features: [hideInboxFooter],
      html: inboxRows,
      settings: { styles: stylesWith("hideInboxFooter") },
    });

    const found = reached(hideInboxFooterRules);
    expect([
      found.length,
      found.some((footer) => footer.closest('[gh="tl"]') !== null),
      page.sheet("hideInboxFooter")?.includes("display: none !important"),
    ]).toStrictEqual([2, true, true]);

    page.change({ styles: stylesWith() });
    expect(page.sheet("hideInboxFooter")).toBeUndefined();
    page.app.dispose();
  });

  it("reaches the footer beside the main area of an open conversation and reports no miss", async () => {
    await expect(
      afterGrace(attachments, `${MAILBOX}/#inbox/FMfcgz`)
    ).resolves.toStrictEqual({ misses: [], reached: 2 });
  });

  it("leaves a content-info region that is not the footer, and reports the miss", async () => {
    const html = inboxRows
      .replaceAll("/settings/storage", "/elsewhere")
      .replaceAll("/policies/", "/elsewhere/");
    await expect(afterGrace(html)).resolves.toStrictEqual({
      misses: [{ selector: "hideInboxFooter" }],
      reached: 0,
    });
  });
});
