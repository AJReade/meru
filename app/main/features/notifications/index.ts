import { DisposableStore } from "../../../core/disposable.ts";
import {
  admitPageNotice,
  appNotice,
  mailNotice,
  MAX_MAIL_NOTICES,
  messageUrl,
  NO_PAGE_NOTICES,
  notifiable,
} from "../../../core/engines/notifications.ts";
import type { PageNotices } from "../../../core/engines/notifications.ts";
import type { AppEventMap, AppEvents } from "../../../core/events.ts";
import type { Clock, NotificationPort } from "../../../core/ports.ts";
import type { FeedEntry } from "../../../core/records/feed.ts";
import type { Platform } from "../../../core/records/platform.ts";
import { appById, gmail } from "../../../shared/apps.ts";
import type { MailAction } from "../../../shared/channels/gmail.ts";
import { msg } from "../../../shared/msg.ts";
import type { Inbox } from "../inbox/index.ts";
import type { Profiles } from "../profiles/index.ts";
import type { SettingsStore } from "../settings/index.ts";

/** The buttons a new email's notification offers, in the order they are drawn, as 3.x worded and ordered them, less the two that cannot be undone. */
const MAIL_ACTIONS = [
  { action: "archive", label: msg`Archive` },
  { action: "markRead", label: msg`Mark as read` },
] as const satisfies readonly { action: MailAction; label: string }[];

interface NotificationsOptions {
  readonly clock: Pick<Clock, "now">;
  readonly notifications: NotificationPort;
  readonly platform: Platform;
  readonly inbox: Pick<Inbox, "important">;
  readonly profiles: Pick<Profiles, "state" | "profile" | "focusTab">;
  readonly settings: Pick<SettingsStore, "get">;
  readonly events: Pick<AppEvents, "on">;
  /** Brings the main window to the front. */
  readonly showWindow: () => void;
  /** Loads an address into the tab's pane, or the view it is next given. */
  readonly load: (tabId: string, url: string) => void;
  /** Acts on a message through the tab's Gmail page, which is the only place Gmail's action endpoint can be reached from. */
  readonly act: (tabId: string, messageId: string, action: MailAction) => void;
  /** The mailbox a message opens in, which a run from the repository may point at a stand-in. */
  readonly gmailUrl: string;
}

/** Raises a notification for each new email a profile's feed brings, or one for the lot past a handful, under that profile's notification settings, and opens the message, or the inbox, when one is clicked. */
export class Notifications {
  readonly #options: NotificationsOptions;
  readonly #disposables = new DisposableStore();
  /** What each tab's page has had of the window its notifications are counted over. */
  readonly #pageNotices = new Map<string, PageNotices>();

  constructor(options: NotificationsOptions) {
    this.#options = options;
  }

  start(): void {
    this.#disposables.add(
      this.#options.events.on("mail.arrived", ({ profileId, entries }) => {
        void this.#notify(profileId, entries);
      }),
      this.#options.events.on("page.notified", (raised) => {
        this.#notifyFromPage(raised);
      })
    );
  }

  dispose(): void {
    this.#disposables.dispose();
  }

  async #notify(
    profileId: string,
    arrived: readonly FeedEntry[]
  ): Promise<void> {
    const { gmailUrl, inbox, notifications, platform, profiles, settings } =
      this.#options;
    if (!settings.get("notifications.enabled", profileId)) {
      return;
    }
    const newEmails = settings.get("notifications.newEmails", profileId);
    // The Important feed costs a request, so it is read only once there is mail to filter.
    const important =
      newEmails === "important" ? await inbox.important(profileId) : undefined;
    const profile = profiles.profile(profileId);
    if (profile === undefined) {
      return;
    }
    const options = {
      labelled: profiles.state.profiles.length > 1,
      platform,
      profileLabel: profile.label,
      showSender: settings.get("notifications.showSender"),
      showSubject: settings.get("notifications.showSubject"),
      showSummary: settings.get("notifications.showSummary"),
    };
    const silent = !settings.get("notifications.playSound");
    const notified = notifiable(arrived, newEmails, important);
    if (notified.length > MAX_MAIL_NOTICES) {
      const count = msg`${notified.length} new emails`;
      notifications.show(
        {
          silent,
          title: options.labelled ? `[${profile.label}] ${count}` : count,
        },
        () => {
          this.#open(profileId, `${gmailUrl}/#inbox`);
        }
      );
      return;
    }
    // A feed entry Gmail gave no message id can be neither opened nor acted on.
    const offered = settings.get("notifications.actions")
      ? MAIL_ACTIONS
      : undefined;
    for (const entry of notified) {
      const actions =
        entry.messageId === "" || offered === undefined ? undefined : offered;
      notifications.show(
        {
          ...mailNotice(entry, options),
          silent,
          ...(actions === undefined
            ? {}
            : { actions: actions.map(({ label }) => label) }),
        },
        () => {
          this.#open(
            profileId,
            entry.messageId === ""
              ? undefined
              : messageUrl(gmailUrl, entry.messageId)
          );
        },
        actions === undefined
          ? undefined
          : (index) => {
              const pressed = actions[index];
              if (pressed !== undefined) {
                this.#act(profileId, entry.messageId, pressed.action);
              }
            }
      );
    }
  }

  /** Acts on the message through the profile's Gmail page, which stays where it is: the window is not revealed, since a button press leaves the user in the app they were in. */
  #act(profileId: string, messageId: string, action: MailAction): void {
    const tab = this.#gmailTab(profileId);
    if (tab !== undefined) {
      this.#options.act(tab.id, messageId, action);
    }
  }

  #gmailTab(profileId: string) {
    return this.#options.profiles.state.tabs.find(
      (found) => found.profileId === profileId && found.appId === gmail.id
    );
  }

  /** Shows what a Google app's page raised, under one global setting, titled with the app rather than with the page's own title, and brings its tab to the front when it is clicked. */
  #notifyFromPage({
    appId,
    notification,
    profileId,
    tabId,
  }: AppEventMap["page.notified"]): void {
    const { clock, notifications, platform, profiles, settings } =
      this.#options;
    if (!settings.get("notifications.allowFromWorkspaceApps")) {
      return;
    }
    const profile = profiles.profile(profileId);
    const app = appById(appId);
    if (profile === undefined || app === undefined) {
      return;
    }
    const { notices, verdict } = admitPageNotice(
      this.#pageNotices.get(tabId) ?? NO_PAGE_NOTICES,
      clock.now()
    );
    this.#pageNotices.set(tabId, notices);
    if (verdict === "drop") {
      return;
    }
    const options = {
      // Calendar plays a sound of its own for an event about to start, so a second one from the system doubles it.
      alwaysSilent: appId === "calendar",
      appName: app.name,
      labelled: profiles.state.profiles.length > 1,
      platform,
      profileLabel: profile.label,
    };
    notifications.show(
      verdict === "show"
        ? appNotice(notification, options)
        : appNotice(
            { silent: true, title: msg`More notifications held back` },
            options
          ),
      () => {
        profiles.focusTab(tabId);
        this.#options.showWindow();
      }
    );
  }

  /** Brings the profile's Gmail tab to the front, at `url` when given. */
  #open(profileId: string, url?: string): void {
    const { load, profiles, showWindow } = this.#options;
    showWindow();
    const tab = this.#gmailTab(profileId);
    if (tab === undefined) {
      return;
    }
    if (url !== undefined) {
      load(tab.id, url);
    }
    profiles.focusTab(tab.id);
  }
}
