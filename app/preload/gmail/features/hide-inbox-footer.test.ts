import { describe, expect, it } from "vitest";

import { mountGmail, reached, stylesWith } from "../testing.ts";
import inboxRows from "./fixtures/inbox-rows.html?raw";
import { hideInboxFooter, hideInboxFooterRules } from "./hide-inbox-footer.ts";

describe(hideInboxFooter.id, () => {
  it("reaches the footer under the list and no other content-info region of the page", () => {
    const page = mountGmail({
      features: [hideInboxFooter],
      html: inboxRows,
      settings: { styles: stylesWith("hideInboxFooter") },
    });

    const found = reached(hideInboxFooterRules);
    expect(found).toHaveLength(1);
    expect(found[0]?.closest('[gh="tl"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="contentinfo"]')).toHaveLength(2);
    expect(page.sheet("hideInboxFooter")).toContain("display: none !important");

    page.change({ styles: stylesWith() });
    expect(page.sheet("hideInboxFooter")).toBeUndefined();
    page.app.dispose();
  });
});
