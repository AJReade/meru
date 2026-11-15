import { describe, expect, it } from "vitest";

import { mountGmail, reached, stylesWith } from "../testing.ts";
import header from "./fixtures/inbox-rows.html?raw";
import { hideGmailLogo, hideGmailLogoRules } from "./hide-gmail-logo.ts";

describe(hideGmailLogo.id, () => {
  it("reaches the box the logo sits in", () => {
    const page = mountGmail({
      features: [hideGmailLogo],
      html: header,
      settings: { styles: stylesWith("hideGmailLogo") },
    });

    // happy-dom matches `:has(> a > b > c)` on elements the chain does not start from, which Chromium does not: on Gmail's own header Chromium reaches this one box alone, while happy-dom reaches others, so the test asks only that the logo's box is reached.
    const found = reached(hideGmailLogoRules);
    const logo = document.querySelector('header a[href="#inbox"] > img');
    expect(found).toContain(logo?.parentElement?.parentElement?.parentElement);
    expect(page.sheet("hideGmailLogo")).toContain("display: none !important");

    page.change({ styles: stylesWith() });
    expect(page.sheet("hideGmailLogo")).toBeUndefined();
    page.app.dispose();
  });
});
