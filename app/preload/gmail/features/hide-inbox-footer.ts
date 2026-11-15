import type { StyleRule } from "../../content/styles.ts";
import { cssFeature } from "../feature.ts";

// Gmail draws its footer beside the main area as often as inside it, so the region is told by what only the footer holds: the storage meter's link and Google's policy links, whose addresses stay the same in every locale while their words do not.
const FOOTER =
  '[role="contentinfo"]:has(a[href*="/settings/storage"], a[href*="/policies/"])';

export const hideInboxFooterRules: readonly StyleRule[] = [
  { declarations: "display: none !important;", selector: FOOTER },
];

export const hideInboxFooter = cssFeature({
  entry: { anchor: FOOTER, context: '[role="main"]', id: "hideInboxFooter" },
  id: "hideInboxFooter",
  rules: hideInboxFooterRules,
});
