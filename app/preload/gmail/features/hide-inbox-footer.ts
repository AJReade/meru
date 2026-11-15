import type { StyleRule } from "../../content/styles.ts";
import { cssFeature } from "../feature.ts";

// The footer is the one content-info region in Gmail's main area, under the list or the open conversation; its links and wording change with the locale and the account, so it is found by where it sits.
const FOOTER = '[role="main"] [role="contentinfo"]';

export const hideInboxFooterRules: readonly StyleRule[] = [
  { declarations: "display: none !important;", selector: FOOTER },
];

export const hideInboxFooter = cssFeature({
  entry: { anchor: FOOTER, context: '[role="main"]', id: "hideInboxFooter" },
  id: "hideInboxFooter",
  rules: hideInboxFooterRules,
});
