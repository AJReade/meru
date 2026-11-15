import { describe, expect, it } from "vitest";

import { mountGmail, reached, stylesWith } from "../testing.ts";
import promoBanner from "./fixtures/promo-banner.html?raw";
import { hidePromoBanner, hidePromoBannerRules } from "./hide-promo-banner.ts";

describe(hidePromoBanner.id, () => {
  it("reaches the promotion in Gmail's banner and above the list, and leaves Gmail's other banners", () => {
    const page = mountGmail({
      features: [hidePromoBanner],
      html: promoBanner,
      settings: { styles: stylesWith("hidePromoBanner") },
    });

    const found = reached(hidePromoBannerRules);
    expect(found.map((element) => element.textContent.trim())).toStrictEqual([
      "Get more storage",
      "Get more storage",
      "Using Gmail to run your business?",
    ]);
    expect(page.sheet("hidePromoBanner")).toContain("display: none !important");
    page.app.dispose();
  });
});
