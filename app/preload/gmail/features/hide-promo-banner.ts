import type { StyleRule } from "../../content/styles.ts";
import { cssFeature } from "../feature.ts";

// Gmail puts the promotion's onramp either in its own banner container, which it also uses for banners that are not the promotion, or straight in the main area above the list, so the onramp is what tells it apart either way.
export const hidePromoBannerRules: readonly StyleRule[] = [
  {
    declarations: "display: none !important;",
    selector:
      '[data-elevated-container-view-type="timely_bump"]:has([data-rp-onramp-container])',
  },
  {
    declarations: "display: none !important;",
    selector: '[role="main"] [data-rp-onramp-container]',
  },
];

export const hidePromoBanner = cssFeature({
  id: "hidePromoBanner",
  rules: hidePromoBannerRules,
});
