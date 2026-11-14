import { z } from "zod";

import { gateRefusalSchema } from "../../core/entitlement/gate.ts";
import { labelColorSchema } from "../../core/records/label-color.ts";
import { contentFailureSchema } from "./content.ts";
import {
  defineChannels,
  definePushes,
  event,
  noPayload,
  push,
  sync,
} from "./define.ts";

/** The Gmail page's style sheets the settings turn on and off, one per feature, by its setting's name under `gmail.`. */
export const gmailStylesSchema = z.object({
  hideGmailLogo: z.boolean(),
  hideOutOfOfficeBanner: z.boolean(),
  hidePromoBanner: z.boolean(),
  hideUpgradeButton: z.boolean(),
  reverseConversation: z.boolean(),
  showTrimmedContent: z.boolean(),
});

export type GmailStyles = z.infer<typeof gmailStylesSchema>;

/** The Gmail page's features that change its markup or how it behaves, each by its setting's name under `gmail.`. */
export const gmailSwitchesSchema = z.object({
  closeComposeWindowAfterSend: z.boolean(),
  loadClippedMessages: z.boolean(),
  moveAttachmentsToTop: z.boolean(),
  openComposeInNewWindow: z.boolean(),
  replyForwardInPopOut: z.boolean(),
  showSenderIcons: z.boolean(),
});

export type GmailSwitches = z.infer<typeof gmailSwitchesSchema>;

/** What the Gmail pane's preload applies, whole, each time it changes. */
export const gmailPageSettingsSchema = z.object({
  /** Counts up with every change, so a page can say which it applied. */
  version: z.number().int().min(0),
  /** The address of the mailbox the pane shows; the preload's features run only under it. */
  mailbox: z.string(),
  /** The address Google's sign-in starts with, where the pane lands once its session is signed out. */
  signIn: z.string(),
  styles: gmailStylesSchema,
  switches: gmailSwitchesSchema,
  /** Where a sender's icon is asked for by its domain: Google's favicon service, or the stand-in mailbox's in a run against one. */
  favicons: z.string(),
  labelColors: z.array(labelColorSchema),
  /** The user's own style sheet, empty while there is none or Pro does not allow it. */
  userStyles: z.string(),
});

export type GmailPageSettings = z.infer<typeof gmailPageSettingsSchema>;

/** What a page can do to a message through Gmail's own action endpoint. */
export const mailActionSchema = z.enum(["archive", "markRead"]);

export type MailAction = z.infer<typeof mailActionSchema>;

/** Why an action did not reach Gmail: the page carries no version marker or no action token, Gmail answered with a status or with its sign-in script, or the request threw. */
export const mailActionRefusalSchema = z.enum([
  "noMarker",
  "noToken",
  "status",
  "signIn",
  "threw",
]);

export type MailActionRefusal = z.infer<typeof mailActionRefusalSchema>;

/** What a Gmail pane's page asks of main; the profile is the sender's, never the payload's. */
export const gmail = defineChannels("gmail", {
  /** The settings the page paints its first frame with, read once as the preload starts. */
  settings: sync(noPayload, gmailPageSettingsSchema),
  /** The page applied the settings of this version. */
  settingsAck: event(z.object({ version: z.number().int().min(0) })),
  /** The page is Google's sign-in, so the profile's session was signed out. */
  needsSignIn: event(noPayload),
  /** A selector entry found nothing where it should have, once per entry per page load. */
  selectorMiss: event(z.object({ selector: z.string().min(1).max(100) })),
  /** The preload failed at something of its own, which main logs. */
  failed: event(contentFailureSchema),
  /** Whether Gmail shows the out-of-office banner, sent when that changes. */
  outOfOffice: event(z.object({ on: z.boolean() })),
  /** Gmail said "Message sent" in this page, which counts only from a pop-out window. */
  messageSent: event(noPayload),
  /** The Undo of the message-sent toast of this id was clicked. */
  undoSend: event(z.object({ id: z.number().int().min(0) })),
  /** Whether the page took the address of the `navigate` push of this id, which it does only while it shows the mailbox. */
  navigated: event(
    z.object({ id: z.number().int().min(0), navigated: z.boolean() })
  ),
  /** Whether Gmail took the action of the `mailAction` push of this id. */
  mailActed: event(
    z.object({ acted: z.boolean(), id: z.number().int().min(0) })
  ),
  /** An action Gmail refused, once per reason per page load, which main logs as a warning. */
  mailActionFailed: event(z.object({ reason: mailActionRefusalSchema })),
});

export const gmailPushes = definePushes("gmail", {
  settingsChanged: push(gmailPageSettingsSchema),
  /** Shows the message-sent toast of this id, whose Undo answers `undoSend` with it. */
  showSentToast: push(z.object({ id: z.number().int().min(0) })),
  /** Takes the message-sent toast of this id down. */
  dismissSentToast: push(z.object({ id: z.number().int().min(0) })),
  /** Clicks Gmail's own Undo of the message last sent in this page. */
  undoSend: push(noPayload),
  /** Takes the page to a place in the mailbox, such as a message, by its address's fragment; the page answers `navigated` with the id. */
  navigate: push(
    z.object({
      hash: z.string().startsWith("#").max(2000),
      id: z.number().int().min(0),
    })
  ),
  /** Acts on a message through Gmail's own action endpoint, which only a page holds the credentials for; the page answers `mailActed` with the id. */
  mailAction: push(
    z.object({
      action: mailActionSchema,
      id: z.number().int().min(0),
      messageId: z.string().min(1).max(100),
    })
  ),
});

/** What the settings page says of the user styles: the gate's refusal while Pro does not allow them, and the file's size while it is past the limit and so not applied. */
export const userStylesStateSchema = z.object({
  refusal: gateRefusalSchema.nullable(),
  tooLarge: z
    .object({ bytes: z.number().int().min(0), limit: z.number().int().min(0) })
    .nullable(),
});

export type UserStylesState = z.infer<typeof userStylesStateSchema>;

export const userStyles = defineChannels("userStyles", {
  snapshot: sync(noPayload, userStylesStateSchema),
});

export const userStylesPushes = definePushes("userStyles", {
  changed: push(userStylesStateSchema),
});
