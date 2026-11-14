import { isEqual } from "es-toolkit";

import { DisposableStore } from "../../../core/disposable.ts";
import { canUse } from "../../../core/entitlement/gate.ts";
import type { AppEvents } from "../../../core/events.ts";
import type { LogPort } from "../../../core/log.ts";
import type {
  Clock,
  FsPort,
  PopOutWindow,
  ShellPort,
  Unsubscribe,
} from "../../../core/ports.ts";
import type { Entitlement } from "../../../core/records/entitlement.ts";
import type { ProfileStatus } from "../../../core/records/profile.ts";
import type { Tab } from "../../../core/records/tab.ts";
import { err, ok } from "../../../core/result.ts";
import type { Result } from "../../../core/result.ts";
import type { IpcRegistrar } from "../../../shared/channels/define.ts";
import {
  gmail,
  gmailPushes,
  MAIL_ACTION_TIMEOUT,
  userStyles,
  userStylesPushes,
} from "../../../shared/channels/gmail.ts";
import type {
  GmailPageSettings,
  MailAction,
  UserStylesState,
} from "../../../shared/channels/gmail.ts";
import {
  contentSurfaceArgument,
  gmailSurface,
} from "../../../shared/channels/surfaces.ts";
import type { CommandRegistrar } from "../../../shared/commands/define.ts";
import type { SettingsStore } from "../settings/index.ts";
import type { ContentPage } from "../stage/tab-views.ts";
import { gmailCommands } from "./commands.ts";

/** Google's favicon service, which answers a domain's icon. */
export const GOOGLE_FAVICONS = "https://www.google.com/s2/favicons";

/** The user's own style sheet for Gmail, a file in the user data directory, as 3.x kept it. */
export const USER_STYLES_FILE = "gmail-user-styles.css";

/** The most of the user styles a page is given; a larger file is refused whole, since every Gmail page holds the text and parses it. */
export const USER_STYLES_LIMIT = 256 * 1024;

// How long a page is given to say it took an address before main loads the address itself.
export const NAVIGATE_TIMEOUT = 1000;

// How long a page is given to answer an action, as 3.x gave it: Gmail's endpoint answers in one request, but a page that navigated away mid-action answers never.
export const ACT_TIMEOUT = MAIL_ACTION_TIMEOUT;

// How long the tab is given to get a page once it has been woken, after which the action is refused rather than left hanging.
export const WAKE_TIMEOUT = 5000;
/** How long a sent message's pop-out stays, hidden, for its Undo, as 3.x keeps it; Gmail's own longest undo period is 30 seconds. */
export const SENT_UNDO_WINDOW = 30_000;

// An editor saves in several writes, each of which the watch may report, so a read waits for the writes to stop.
export const USER_STYLES_SETTLE = 200;

export interface GmailOptions {
  readonly settings: Pick<SettingsStore, "get" | "subscribe">;
  readonly entitlement: () => Entitlement;
  readonly clock: Clock;
  readonly events: Pick<AppEvents, "on">;
  readonly fs: FsPort;
  readonly shell: Pick<ShellPort, "openPath" | "showItemInFolder">;
  /** The absolute path of `USER_STYLES_FILE`, which the shell opens. */
  readonly userStylesPath: string;
  readonly profiles: {
    readonly setStatus: (
      profileId: string,
      status: ProfileStatus
    ) => Result<undefined, string>;
    readonly setOutOfOffice: (profileId: string, on: boolean) => void;
    readonly selected: () => { readonly id: string };
  };
  /** Shows the profile's Gmail tab at the mailbox's fragment `hash`. */
  readonly openMailbox: (profileId: string, hash: string) => void;
  readonly registrar: IpcRegistrar;
  readonly commands: CommandRegistrar;
  /** The built Gmail preload. */
  readonly preload: string;
  /** The address the mailbox lives under. */
  readonly mailbox: string;
  /** The address Google's sign-in starts with. */
  readonly signIn: string;
  /** Points the tab at the mailbox, so a tab with no page acts once it has one. */
  readonly wake: (tabId: string) => void;
  /** Where a sender's icon is asked for by its domain. */
  readonly favicons: string;
  readonly log: LogPort;
}

/** Why an action on a message did not run: the tab has no page even after being woken, the page did not answer, or Gmail refused it. */
export type GmailActError = "noPage" | "silent" | "refused";

/** What the Gmail pane's page applies: its settings, the user's styles while Pro allows them, the pages it runs in, and what each page reports back. */
export class Gmail {
  readonly #options: GmailOptions;
  readonly #disposables = new DisposableStore();
  /** Each Gmail tab's page, by tab id. */
  readonly #pages = new Map<
    string,
    { readonly contentsId: number; readonly profileId: string }
  >();
  /** Each pop-out window a Gmail page opened, by its page. */
  readonly #popOuts = new Map<
    number,
    { readonly window: PopOutWindow; readonly profileId: string }
  >();
  /** Each sent message whose pop-out waits, hidden, for its Undo, by the id of its toast. */
  readonly #sent = new Map<
    number,
    {
      readonly window: PopOutWindow;
      readonly pane: number | undefined;
      readonly close: Unsubscribe;
    }
  >();
  #nextSent = 0;
  /** Each navigation a page has yet to answer, by its id. */
  readonly #navigations = new Map<
    number,
    {
      readonly contentsId: number;
      readonly settle: (navigated: boolean) => void;
      readonly timeout: Unsubscribe;
    }
  >();
  /** Each action a page has yet to answer, by its id. */
  readonly #actions = new Map<
    number,
    {
      readonly contentsId: number;
      readonly settle: (acted: boolean) => void;
      readonly timeout: Unsubscribe;
    }
  >();
  /** Whoever waits for a tab to get a page, by tab id. */
  readonly #waking = new Map<string, Set<(contentsId: number) => void>>();
  #nextNavigation = 0;
  #nextAction = 0;
  #userStyles = "";
  #tooLarge: UserStylesState["tooLarge"] = null;
  #stylesState: UserStylesState;
  #settle: Unsubscribe | undefined;
  #current: GmailPageSettings;

  constructor(options: GmailOptions) {
    this.#options = options;
    this.#current = { ...this.#compute(), version: 0 };
    this.#stylesState = this.#computeStylesState();
  }

  async start(): Promise<void> {
    const { commands, events, fs, registrar, settings } = this.#options;
    this.#disposables.add(
      registrar.register(gmail, {
        needsSignIn: (_payload, { profileId }) =>
          profileId === undefined
            ? err("noProfile")
            : this.#options.profiles.setStatus(profileId, {
                kind: "needsSignIn",
              }),
        failed: ({ message, stack, what }, { profileId }) => {
          this.#options.log.error("A Gmail page's preload failed", {
            error: { message, name: what, stack },
            profileId,
          });
          return ok(undefined);
        },
        mailActed: ({ acted, id }, { contentsId }) => {
          const waiting = this.#actions.get(id);
          if (waiting?.contentsId === contentsId) {
            waiting.settle(acted);
          }
          return ok(undefined);
        },
        clippedFailed: ({ reason, status }, { profileId }) => {
          this.#options.log.warn("A clipped message did not load", {
            profileId,
            reason,
            status,
          });
          return ok(undefined);
        },
        mailActionFailed: ({ reason }, { profileId }) => {
          this.#options.log.warn("Gmail refused an action on a message", {
            profileId,
            reason,
          });
          return ok(undefined);
        },
        messageSent: (_payload, { contentsId }) => {
          this.#hideSent(contentsId);
          return ok(undefined);
        },
        // A pop-out shows no banner, so only a tab's page says whether the profile is out of office.
        outOfOffice: ({ on }, { contentsId, profileId }) => {
          if (profileId === undefined) {
            return err("noProfile");
          }
          if (!this.#popOuts.has(contentsId)) {
            this.#options.profiles.setOutOfOffice(profileId, on);
          }
          return ok(undefined);
        },
        undoSend: ({ id }) => {
          this.#undoSend(id);
          return ok(undefined);
        },
        navigated: ({ id, navigated }, { contentsId }) => {
          const waiting = this.#navigations.get(id);
          if (waiting?.contentsId === contentsId) {
            waiting.settle(navigated);
          }
          return ok(undefined);
        },
        selectorMiss: ({ selector }, { profileId }) => {
          this.#options.log.warn("A Gmail selector found nothing", {
            profileId,
            selector,
          });
          return ok(undefined);
        },
        settings: () => ok(this.#current),
        settingsAck: ({ version }, { contentsId }) => {
          this.#options.log.debug("A Gmail page applied its settings", {
            contentsId,
            version,
          });
          return ok(undefined);
        },
      }),
      registrar.register(userStyles, {
        snapshot: () => ok(this.#stylesState),
      }),
      commands.register(gmailCommands, {
        outOfOfficeSettings: () => {
          this.#options.openMailbox(
            this.#options.profiles.selected().id,
            "#settings/general"
          );
          return ok(undefined);
        },
        editUserStyles: {
          run: () => {
            void this.#openUserStyles();
            return ok(undefined);
          },
          when: () => this.#proAllowed(),
        },
        revealUserStyles: {
          run: () => {
            void this.#revealUserStyles();
            return ok(undefined);
          },
          when: () => this.#proAllowed(),
        },
      }),
      settings.subscribe((changes) => {
        if (changes.some(({ key }) => key.startsWith("gmail."))) {
          this.#refresh();
        }
      }),
      events.on("entitlement.changed", () => {
        this.#refresh();
      }),
      fs.watch(USER_STYLES_FILE, () => {
        this.#settle?.();
        this.#settle = this.#options.clock.schedule(USER_STYLES_SETTLE, () => {
          this.#settle = undefined;
          void this.#readUserStyles();
        });
      }),
      () => {
        this.#settle?.();
        for (const { close } of this.#sent.values()) {
          close();
        }
      }
    );
    await this.#readUserStyles();
  }

  dispose(): void {
    this.#disposables.dispose();
  }

  /** The preload and surface of a Gmail tab's page. */
  page(tab: Tab): ContentPage {
    return {
      arguments: [contentSurfaceArgument("gmail")],
      attach: (contentsId): Unsubscribe => {
        this.#pages.set(tab.id, { contentsId, profileId: tab.profileId });
        for (const waiting of this.#waking.get(tab.id) ?? []) {
          waiting(contentsId);
        }
        this.#waking.delete(tab.id);
        const unassign = this.#options.registrar.assign(
          contentsId,
          gmailSurface,
          tab.profileId
        );
        return () => {
          unassign();
          if (this.#pages.get(tab.id)?.contentsId === contentsId) {
            this.#pages.delete(tab.id);
          }
        };
      },
      preload: this.#options.preload,
    };
  }

  /** Acts on one of the tab's messages through Gmail's own action endpoint, which only its page can reach: a tab with no page is woken first, and an action the page does not answer for, or Gmail refuses, is refused here rather than reported as done. */
  async act(
    tabId: string,
    messageId: string,
    action: MailAction
  ): Promise<Result<undefined, GmailActError>> {
    const contentsId =
      this.#pages.get(tabId)?.contentsId ?? (await this.#woken(tabId));
    if (contentsId === undefined) {
      return this.#notActed("noPage", tabId);
    }
    const id = this.#nextAction;
    this.#nextAction += 1;
    const { promise, resolve } = Promise.withResolvers<boolean | undefined>();
    const settle = (acted: boolean | undefined) => {
      this.#actions.get(id)?.timeout();
      this.#actions.delete(id);
      resolve(acted);
    };
    this.#actions.set(id, {
      contentsId,
      settle,
      timeout: this.#options.clock.schedule(ACT_TIMEOUT, () => {
        settle(undefined);
      }),
    });
    this.#options.registrar.push(contentsId, gmailPushes.mailAction, {
      action,
      id,
      messageId,
    });
    const acted = await promise;
    if (acted === true) {
      return ok(undefined);
    }
    return this.#notActed(acted === undefined ? "silent" : "refused", tabId);
  }

  #notActed(
    reason: GmailActError,
    tabId: string
  ): Result<undefined, GmailActError> {
    this.#options.log.warn("A message action did not reach Gmail", {
      reason,
      tabId,
    });
    return err(reason);
  }

  /** The page the tab gets once it has been pointed at the mailbox, or nothing while it got none in time: no stage makes a view of a tab out of sight, so an action on a tab whose group no window shows waits in vain. */
  async #woken(tabId: string): Promise<number | undefined> {
    const { promise, resolve } = Promise.withResolvers<number | undefined>();
    const waiting = this.#waking.get(tabId) ?? new Set();
    waiting.add(resolve);
    this.#waking.set(tabId, waiting);
    const timeout = this.#options.clock.schedule(WAKE_TIMEOUT, () => {
      waiting.delete(resolve);
      resolve(undefined);
    });
    this.#options.wake(tabId);
    const contentsId = await promise;
    timeout();
    return contentsId;
  }

  /** Takes the tab's page to `url` by its fragment, as Gmail moves between its own views, when the tab has a page on the mailbox and the address is the mailbox's; false, once the page says it is elsewhere or does not answer in time, leaves it to the caller to load. */
  async navigate(tabId: string, url: string): Promise<boolean> {
    const contentsId = this.#pages.get(tabId)?.contentsId;
    const at = url.indexOf("#");
    if (
      contentsId === undefined ||
      at === -1 ||
      !url.startsWith(this.#options.mailbox)
    ) {
      return false;
    }
    const id = this.#nextNavigation;
    this.#nextNavigation += 1;
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const settle = (navigated: boolean) => {
      this.#navigations.get(id)?.timeout();
      this.#navigations.delete(id);
      resolve(navigated);
    };
    this.#navigations.set(id, {
      contentsId,
      settle,
      timeout: this.#options.clock.schedule(NAVIGATE_TIMEOUT, () => {
        settle(false);
      }),
    });
    this.#options.registrar.push(contentsId, gmailPushes.navigate, {
      hash: url.slice(at),
      id,
    });
    return await promise;
  }

  /** Gives a pop-out window a Gmail page opened the Gmail page's surface, under the profile of the tab that opened it. */
  attachPopOut(window: PopOutWindow, profileId: string): void {
    const unassign = this.#options.registrar.assign(
      window.contentsId,
      gmailSurface,
      profileId
    );
    this.#popOuts.set(window.contentsId, { profileId, window });
    const unfollow = window.onClosed(() => {
      unfollow();
      unassign();
      this.#popOuts.delete(window.contentsId);
      for (const [id, sent] of this.#sent) {
        if (sent.window === window) {
          this.#forget(id);
        }
      }
    });
  }

  // Gmail keeps the message unsent for its undo period, so the pop-out is hidden rather than closed and the toast's Undo can still reach its page.
  #hideSent(contentsId: number): void {
    const popOut = this.#popOuts.get(contentsId);
    if (
      popOut === undefined ||
      !this.#options.settings.get("gmail.closeComposeWindowAfterSend")
    ) {
      return;
    }
    const { window } = popOut;
    window.hide();
    const id = this.#nextSent;
    this.#nextSent += 1;
    const pane = [...this.#pages.values()].find(
      (page) => page.profileId === popOut.profileId
    )?.contentsId;
    this.#sent.set(id, {
      close: this.#options.clock.schedule(SENT_UNDO_WINDOW, () => {
        window.close();
      }),
      pane,
      window,
    });
    if (pane !== undefined) {
      this.#options.registrar.push(pane, gmailPushes.showSentToast, { id });
    }
  }

  #undoSend(id: number): void {
    const sent = this.#sent.get(id);
    if (sent === undefined) {
      return;
    }
    this.#forget(id);
    const { pane, window } = sent;
    if (this.#popOuts.has(window.contentsId)) {
      window.show();
      this.#options.registrar.push(window.contentsId, gmailPushes.undoSend, {});
    } else if (pane !== undefined) {
      this.#options.registrar.push(pane, gmailPushes.undoSend, {});
    }
  }

  #forget(id: number): void {
    const sent = this.#sent.get(id);
    if (sent === undefined) {
      return;
    }
    sent.close();
    this.#sent.delete(id);
    if (sent.pane !== undefined) {
      this.#options.registrar.push(sent.pane, gmailPushes.dismissSentToast, {
        id,
      });
    }
  }

  #compute(): Omit<GmailPageSettings, "version"> {
    const { settings } = this.#options;
    return {
      favicons: this.#options.favicons,
      labelColors: settings.get("gmail.labelColors"),
      mailbox: this.#options.mailbox,
      signIn: this.#options.signIn,
      styles: {
        hideGmailLogo: settings.get("gmail.hideGmailLogo"),
        hideOutOfOfficeBanner: settings.get("gmail.hideOutOfOfficeBanner"),
        hidePromoBanner: settings.get("gmail.hidePromoBanner"),
        hideUpgradeButton: settings.get("gmail.hideUpgradeButton"),
        reverseConversation: settings.get("gmail.reverseConversation"),
        showTrimmedContent: settings.get("gmail.showTrimmedContent"),
      },
      switches: {
        closeComposeWindowAfterSend: settings.get(
          "gmail.closeComposeWindowAfterSend"
        ),
        loadClippedMessages: settings.get("gmail.loadClippedMessages"),
        moveAttachmentsToTop: settings.get("gmail.moveAttachmentsToTop"),
        openComposeInNewWindow: settings.get("gmail.openComposeInNewWindow"),
        replyForwardInPopOut: settings.get("gmail.replyForwardInPopOut"),
        showSenderIcons: settings.get("gmail.showSenderIcons"),
      },
      userStyles: this.#proAllowed() ? this.#userStyles : "",
    };
  }

  #computeStylesState(): UserStylesState {
    const gate = canUse(this.#options.entitlement(), "proSetting", {
      now: this.#options.clock.now(),
    });
    return {
      refusal: gate.allowed ? null : gate.reason,
      tooLarge: this.#tooLarge,
    };
  }

  #refresh(): void {
    const stylesState = this.#computeStylesState();
    if (!isEqual(stylesState, this.#stylesState)) {
      this.#stylesState = stylesState;
      this.#options.registrar.broadcast(userStylesPushes.changed, stylesState);
    }
    const { version, ...shown } = this.#current;
    const next = this.#compute();
    if (isEqual(shown, next)) {
      return;
    }
    this.#current = { ...next, version: version + 1 };
    this.#options.registrar.broadcast(
      gmailPushes.settingsChanged,
      this.#current
    );
  }

  #proAllowed(): boolean {
    return canUse(this.#options.entitlement(), "proSetting", {
      now: this.#options.clock.now(),
    }).allowed;
  }

  async #readUserStyles(): Promise<void> {
    let text = "";
    let tooLarge: UserStylesState["tooLarge"] = null;
    try {
      const read = await this.#options.fs.readCapped(
        USER_STYLES_FILE,
        USER_STYLES_LIMIT
      );
      if (read.kind === "text") {
        ({ text } = read);
      } else if (read.kind === "tooLarge") {
        tooLarge = { bytes: read.bytes, limit: USER_STYLES_LIMIT };
      }
    } catch (error) {
      this.#options.log.warn("The Gmail user styles could not be read", {
        error,
      });
      return;
    }
    if (tooLarge !== null && this.#tooLarge === null) {
      this.#options.log.warn("The Gmail user styles are too large to apply", {
        bytes: tooLarge.bytes,
        limit: USER_STYLES_LIMIT,
      });
    }
    if (text === this.#userStyles && isEqual(tooLarge, this.#tooLarge)) {
      return;
    }
    this.#userStyles = text;
    this.#tooLarge = tooLarge;
    this.#refresh();
  }

  // The editor or the file manager needs a file to open, so a first open makes an empty one.
  async #ensureUserStyles(): Promise<boolean> {
    try {
      if ((await this.#options.fs.readText(USER_STYLES_FILE)) === undefined) {
        await this.#options.fs.writeTextAtomic(USER_STYLES_FILE, "");
      }
      return true;
    } catch (error) {
      this.#options.log.warn("The Gmail user styles could not be made", {
        error,
      });
      return false;
    }
  }

  async #openUserStyles(): Promise<void> {
    if (!(await this.#ensureUserStyles())) {
      return;
    }
    await this.#options.shell
      .openPath(this.#options.userStylesPath)
      .catch((error: unknown) => {
        this.#options.log.warn("The Gmail user styles could not be opened", {
          error,
        });
      });
  }

  async #revealUserStyles(): Promise<void> {
    if (await this.#ensureUserStyles()) {
      this.#options.shell.showItemInFolder(this.#options.userStylesPath);
    }
  }
}
