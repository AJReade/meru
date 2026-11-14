import {
  isGmailPopOut,
  isSignIn,
  opensOutside,
  resolveLinkTarget,
  staysInPopOut,
} from "../../../core/engines/links.ts";
import { besideTab, groupOf } from "../../../core/engines/ordering.ts";
import type { LogPort } from "../../../core/log.ts";
import type { PopOut, PopOutWindow, ShellPort } from "../../../core/ports.ts";
import type { Disposition } from "../../../core/records/link.ts";
import { apps } from "../../../shared/apps.ts";
import type { Profiles } from "../profiles/index.ts";
import type { SettingsStore } from "../settings/index.ts";
import type { Stages } from "../stage/index.ts";

interface LinksOptions {
  readonly log: LogPort;
  readonly profiles: Pick<Profiles, "state" | "tab" | "openTab" | "focusTab">;
  readonly settings: Pick<SettingsStore, "get">;
  readonly shell: Pick<ShellPort, "openExternal">;
  /** Loads the address in the tab's view, wherever a stage keeps one. */
  readonly stages: Pick<Stages, "load">;
  /** Where Gmail's pop-outs come from, and who takes each one's window. */
  readonly popOuts?: {
    readonly mailbox: string;
    readonly opened: (window: PopOutWindow, profileId: string) => void;
  };
}

/** The size 3.x opens a Gmail pop-out at. */
const POP_OUT_SIZE = { height: 600, width: 800 } as const;

/** Carries out where resolveLinkTarget sends a link a pane's page opens. */
export class Links {
  readonly #options: LinksOptions;

  constructor(options: LinksOptions) {
    this.#options = options;
  }

  /** Routes a link the tab's page opened; true when it was taken from the page. A page navigating itself is left to it, so Google's sign-in and its redirects stay in the pane, and so is a window onto accounts.google.com, which signs in. */
  open(tabId: string, url: string, disposition: Disposition): boolean {
    const { profiles, settings, stages } = this.#options;
    const load = (id: string, address: string) => {
      stages.load(id, address);
    };
    const from = profiles.tab(tabId);
    if (from === undefined || disposition === "inPlace" || isSignIn(url)) {
      return false;
    }
    const { groups, tabs } = profiles.state;
    const target = resolveLinkTarget(url, {
      catalog: apps,
      disposition,
      from,
      groups,
      settings: {
        excludedApps: settings.get("links.excludedApps"),
        openInApp: settings.get("links.openInApp"),
      },
      tabs,
    });
    if (target.action === "samePane") {
      load(tabId, url);
      return true;
    }
    if (target.action === "external") {
      this.#external(url);
      return true;
    }
    const background = target.action === "newTab" && target.background;
    const existing = target.action === "newTab" ? target.tabId : undefined;
    if (existing !== undefined) {
      load(existing, url);
      if (!background) {
        profiles.focusTab(existing);
      }
      return true;
    }
    const group = groupOf(tabId, groups);
    const opened = profiles.openTab(
      from.profileId,
      target.appId,
      target.action === "newTab" && !background && group !== undefined
        ? besideTab(group, tabId, "vertical")
        : undefined,
      url
    );
    if (!opened.ok) {
      this.#external(url);
      return true;
    }
    if (opened.value.url !== url) {
      load(opened.value.id, url);
    }
    if (!background) {
      profiles.focusTab(opened.value.id);
    }
    return true;
  }

  /** Keeps a window a Gmail tab's page opens under the mailbox, a compose or a message, as a pop-out window of the tab's profile, as 3.x does; any other window is a link. */
  popOut(tabId: string, url: string, disposition: Disposition): PopOut | null {
    const { popOuts, profiles } = this.#options;
    const from = profiles.tab(tabId);
    if (
      popOuts === undefined ||
      from?.appId !== "gmail" ||
      !isGmailPopOut(url, popOuts.mailbox, disposition)
    ) {
      return null;
    }
    return {
      ...POP_OUT_SIZE,
      opened: (window) => {
        popOuts.opened(window, from.profileId);
      },
      routes: {
        open: (link, how) => this.#fromPopOut(tabId, link, how),
        popOut: (link, how) => this.popOut(tabId, link, how),
        popup: (link) => this.popup(link),
      },
    };
  }

  /** Decides a blank popup at its first address: shown when it heads for Google's sign-in, which needs the opener, and otherwise sent to the browser and closed. */
  popup(url: string): boolean {
    const shows = isSignIn(url);
    if (!shows) {
      this.#external(url);
    }
    return shows;
  }

  /** Routes what a pop-out's page opens as its tab's would be, except that a pop-out holds a Gmail page and never leaves Google's origins: a window nothing else takes, and a navigation off them, go to the browser. */
  #fromPopOut(tabId: string, url: string, disposition: Disposition): boolean {
    const mailbox = this.#options.popOuts?.mailbox ?? "";
    if (disposition === "inPlace") {
      if (staysInPopOut(url, mailbox)) {
        return false;
      }
    } else if (this.open(tabId, url, disposition)) {
      return true;
    } else if (isSignIn(url)) {
      return false;
    }
    this.#external(url);
    return true;
  }

  #external(url: string): void {
    if (!opensOutside(url)) {
      this.#options.log.warn("A link was not opened outside the app", {
        scheme: url.slice(0, url.indexOf(":") + 1).slice(0, 32),
      });
      return;
    }
    const open = async () => {
      try {
        await this.#options.shell.openExternal(url);
      } catch (error) {
        this.#options.log.warn("The browser did not open a link", {
          error,
          url,
        });
      }
    };
    void open();
  }
}
