import type { FeedEntry } from "../records/feed.ts";
import type { PageNotification } from "../records/notification.ts";
import type { Platform } from "../records/platform.ts";

/** Which of the mail that arrived to notify about: all of it, or only what the Important feed lists; without that feed, all, since a missed notification costs more than an extra one. */
export const notifiable = (
  arrived: readonly FeedEntry[],
  newEmails: "all" | "important",
  important: ReadonlySet<string> | undefined
): readonly FeedEntry[] =>
  newEmails === "all" || important === undefined
    ? arrived
    : arrived.filter((entry) => important.has(entry.id));

interface MailNotice {
  readonly title: string;
  readonly subtitle?: string;
  readonly body?: string;
}

interface MailNoticeOptions {
  readonly platform: Platform;
  readonly profileLabel: string;
  /** Names the profile before the sender, for someone with several. */
  readonly labelled: boolean;
  readonly showSender: boolean;
  readonly showSubject: boolean;
  readonly showSummary: boolean;
}

/** What a notification of new mail says: the sender, or the profile when the sender is hidden; the subject under it on macOS, which has a subtitle, and above the snippet elsewhere. */
export const mailNotice = (
  entry: FeedEntry,
  options: MailNoticeOptions
): MailNotice => {
  const { platform, profileLabel, labelled } = options;
  const sender =
    entry.author.name === "" ? entry.author.email : entry.author.name;
  let title = profileLabel;
  if (options.showSender) {
    title = labelled ? `[${profileLabel}] ${sender}` : sender;
  }
  const subject =
    options.showSubject && entry.subject !== "" ? entry.subject : undefined;
  const summary =
    options.showSummary && entry.summary !== "" ? entry.summary : undefined;
  if (platform === "darwin") {
    return {
      title,
      ...(subject === undefined ? {} : { subtitle: subject }),
      ...(summary === undefined ? {} : { body: summary }),
    };
  }
  const lines = [subject, summary].filter((line) => line !== undefined);
  return { title, ...(lines.length === 0 ? {} : { body: lines.join("\n") }) };
};

interface AppNotice extends MailNotice {
  readonly silent: boolean;
}

interface AppNoticeOptions {
  readonly platform: Platform;
  readonly profileLabel: string;
  /** Names the profile before the app, for someone with several. */
  readonly labelled: boolean;
  /** The app's name in the catalog, which the notification is titled with. */
  readonly appName: string;
  /** The app says what it wants silently, as Calendar does, which plays its own sound. */
  readonly alwaysSilent: boolean;
}

/** What a notification a Google app's page raised says: the app as the title, since a page's own title says little, with what the page called it under that on macOS, which has a subtitle, and above its body elsewhere. */
export const appNotice = (
  notification: PageNotification,
  options: AppNoticeOptions
): AppNotice => {
  const { appName, labelled, platform, profileLabel } = options;
  const title = labelled ? `[${profileLabel}] ${appName}` : appName;
  const silent = options.alwaysSilent || (notification.silent ?? false);
  if (platform === "darwin") {
    return {
      silent,
      subtitle: notification.title,
      title,
      ...(notification.body === undefined ? {} : { body: notification.body }),
    };
  }
  const lines = [notification.title, notification.body].filter(
    (line) => line !== undefined && line !== ""
  );
  return {
    silent,
    title,
    ...(lines.length === 0 ? {} : { body: lines.join("\n") }),
  };
};

/** How many notifications one page shows in `PAGE_NOTICE_WINDOW`; a page raises them as easily as it forges them, so past these one notification says more were held back and the rest go unshown until the window has room. */
export const PAGE_NOTICE_LIMIT = 4;

export const PAGE_NOTICE_WINDOW = 60_000;

/** What a page's notifications have had of the window: when each shown one was, and whether the one saying more were held back has been shown since the window filled. */
export interface PageNotices {
  readonly shownAt: readonly number[];
  readonly held: boolean;
}

export const NO_PAGE_NOTICES: PageNotices = { held: false, shownAt: [] };

/** Whether a page's next notification shows, gives way to the one saying more were held back, or goes unshown, and what the page has had of the window after it. */
export const admitPageNotice = (
  notices: PageNotices,
  now: number
): {
  readonly verdict: "show" | "held" | "drop";
  readonly notices: PageNotices;
} => {
  const shownAt = notices.shownAt.filter((at) => now - at < PAGE_NOTICE_WINDOW);
  if (shownAt.length < PAGE_NOTICE_LIMIT) {
    return {
      notices: { held: false, shownAt: [...shownAt, now] },
      verdict: "show",
    };
  }
  return {
    notices: { held: true, shownAt },
    verdict: notices.held ? "drop" : "held",
  };
};

/** The address in the mailbox that opens a message in a profile's pane. */
export const messageUrl = (gmailUrl: string, messageId: string): string =>
  `${gmailUrl}/#inbox/${messageId}`;

/** The most notifications one read raises; past it, one notification says how many arrived, so a backlog delivered at once does not bury the screen. */
export const MAX_MAIL_NOTICES = 5;
