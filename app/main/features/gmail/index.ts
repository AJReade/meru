import { isEqual } from "es-toolkit";

import { DisposableStore } from "../../../core/disposable.ts";
import { canUse } from "../../../core/entitlement/gate.ts";
import type { AppEvents } from "../../../core/events.ts";
import type { LogPort } from "../../../core/log.ts";
import type {
  Clock,
  FsPort,
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
  userStyles,
  userStylesPushes,
} from "../../../shared/channels/gmail.ts";
import type {
  GmailPageSettings,
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

/** The user's own style sheet for Gmail, a file in the user data directory, as 3.x kept it. */
export const USER_STYLES_FILE = "gmail-user-styles.css";

/** The most of the user styles a page is given; a larger file is refused whole, since every Gmail page holds the text and parses it. */
export const USER_STYLES_LIMIT = 256 * 1024;

// How long a page is given to say it took an address before main loads the address itself.
export const NAVIGATE_TIMEOUT = 1000;

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
  };
  readonly registrar: IpcRegistrar;
  readonly commands: CommandRegistrar;
  /** The built Gmail preload. */
  readonly preload: string;
  /** The address the mailbox lives under. */
  readonly mailbox: string;
  /** The address Google's sign-in starts with. */
  readonly signIn: string;
  readonly log: LogPort;
}

/** What the Gmail pane's page applies: its settings, the user's styles while Pro allows them, the pages it runs in, and what each page reports back. */
export class Gmail {
  readonly #options: GmailOptions;
  readonly #disposables = new DisposableStore();
  /** Each Gmail tab's page, by tab id. */
  readonly #pages = new Map<string, number>();
  /** Each navigation a page has yet to answer, by its id. */
  readonly #navigations = new Map<
    number,
    {
      readonly contentsId: number;
      readonly settle: (navigated: boolean) => void;
      readonly timeout: Unsubscribe;
    }
  >();
  #nextNavigation = 0;
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
        this.#pages.set(tab.id, contentsId);
        const unassign = this.#options.registrar.assign(
          contentsId,
          gmailSurface,
          tab.profileId
        );
        return () => {
          unassign();
          if (this.#pages.get(tab.id) === contentsId) {
            this.#pages.delete(tab.id);
          }
        };
      },
      preload: this.#options.preload,
    };
  }

  /** Takes the tab's page to `url` by its fragment, as Gmail moves between its own views, when the tab has a page on the mailbox and the address is the mailbox's; false, once the page says it is elsewhere or does not answer in time, leaves it to the caller to load. */
  async navigate(tabId: string, url: string): Promise<boolean> {
    const contentsId = this.#pages.get(tabId);
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

  #compute(): Omit<GmailPageSettings, "version"> {
    const { settings } = this.#options;
    return {
      labelColors: settings.get("gmail.labelColors"),
      mailbox: this.#options.mailbox,
      signIn: this.#options.signIn,
      styles: {
        hideGmailLogo: settings.get("gmail.hideGmailLogo"),
        hidePromoBanner: settings.get("gmail.hidePromoBanner"),
        hideUpgradeButton: settings.get("gmail.hideUpgradeButton"),
        reverseConversation: settings.get("gmail.reverseConversation"),
        showTrimmedContent: settings.get("gmail.showTrimmedContent"),
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
