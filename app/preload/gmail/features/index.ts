import type { GmailFeature } from "../feature.ts";
import { attachmentsToTop } from "./attachments-to-top.ts";
import { clippedMessages } from "./clipped-messages.ts";
import { closeAfterSend } from "./close-after-send.ts";
import { hideGmailLogo } from "./hide-gmail-logo.ts";
import { hidePromoBanner } from "./hide-promo-banner.ts";
import { hideUpgradeButton } from "./hide-upgrade-button.ts";
import { labelColors } from "./label-colors.ts";
import { mailAction } from "./mail-action.ts";
import { navigate } from "./navigate.ts";
import { needsSignIn } from "./needs-sign-in.ts";
import { outOfOffice } from "./out-of-office.ts";
import { popOuts } from "./pop-outs.ts";
import { refresh } from "./refresh.ts";
import { reverseConversation } from "./reverse-conversation.ts";
import { senderIcons } from "./sender-icons.ts";
import { sentToast } from "./sent-toast.ts";
import { showTrimmedContent } from "./show-trimmed-content.ts";
import { unreadChanged } from "./unread-changed.ts";
import { urlPreview } from "./url-preview.ts";
import { userStyles } from "./user-styles.ts";

/** Every feature, made anew for each page load, since a feature may hold what it last told main. */
export const gmailFeatures = (): readonly GmailFeature[] => [
  attachmentsToTop,
  clippedMessages,
  closeAfterSend,
  hideGmailLogo,
  hidePromoBanner,
  hideUpgradeButton,
  labelColors,
  mailAction,
  navigate,
  needsSignIn,
  outOfOffice(),
  popOuts,
  refresh,
  reverseConversation,
  senderIcons,
  sentToast(),
  showTrimmedContent,
  unreadChanged(),
  urlPreview,
  userStyles,
];
