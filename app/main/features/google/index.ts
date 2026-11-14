import { DisposableStore } from "../../../core/disposable.ts";
import { resolveBindings } from "../../../core/engines/shortcuts.ts";
import type { AppEvents } from "../../../core/events.ts";
import type { LogPort } from "../../../core/log.ts";
import type {
  GlobalShortcutPort,
  LifecyclePort,
  Unsubscribe,
} from "../../../core/ports.ts";
import type { Platform } from "../../../core/records/platform.ts";
import type { Tab } from "../../../core/records/tab.ts";
import { ok } from "../../../core/result.ts";
import type { IpcRegistrar } from "../../../shared/channels/define.ts";
import { google, googlePushes } from "../../../shared/channels/google.ts";
import type { MeetToggle } from "../../../shared/channels/google.ts";
import {
  contentSurfaceArgument,
  googleSurface,
} from "../../../shared/channels/surfaces.ts";
import type { CommandRegistrar } from "../../../shared/commands/define.ts";
import { commandsOf } from "../../../shared/commands/define.ts";
import type { SettingsStore } from "../settings/index.ts";
import type { ContentPage } from "../stage/tab-views.ts";
import { googleCommands } from "./commands.ts";

export interface GoogleOptions {
  readonly registrar: IpcRegistrar;
  readonly commands: CommandRegistrar;
  readonly globalShortcuts: GlobalShortcutPort;
  readonly lifecycle: Pick<LifecyclePort, "onQuit">;
  readonly platform: Platform;
  readonly settings: Pick<SettingsStore, "get" | "subscribe">;
  /** The built Google preload. */
  readonly preload: string;
  readonly log: LogPort;
  readonly events: Pick<AppEvents, "on" | "emit">;
}

const TOGGLE_COMMANDS: Readonly<Record<string, MeetToggle>> = {
  "google.toggleMeetCamera": "camera",
  "google.toggleMeetMicrophone": "microphone",
};

/** The pages of the Google apps other than Gmail: their preload, and Meet's microphone and camera as commands, which a Meet call also takes system-wide. */
export class Google {
  readonly #options: GoogleOptions;
  readonly #disposables = new DisposableStore();
  /** Meet's pages, the one focused last at the end, which the toggles act on. */
  readonly #meets: { readonly tabId: string; readonly contentsId: number }[] =
    [];
  /** The tab of each page, so a notification is answered as the tab and app that raised it. */
  readonly #pages = new Map<number, Tab>();
  /** The accelerator the system gave for each toggle. */
  readonly #held = new Map<string, MeetToggle>();
  /** The accelerators the system refused, so each is warned about once. */
  readonly #refused = new Set<string>();

  constructor(options: GoogleOptions) {
    this.#options = options;
  }

  start(): void {
    this.#disposables.add(
      this.#options.events.on("tab.focused", ({ tabId }) => {
        const at = this.#meets.findIndex((meet) => meet.tabId === tabId);
        const [focused] = at === -1 ? [] : this.#meets.splice(at, 1);
        if (focused !== undefined) {
          this.#meets.push(focused);
        }
      }),
      this.#options.registrar.register(google, {
        failed: ({ message, stack, what }, { profileId }) => {
          this.#options.log.error("A Google page's preload failed", {
            error: { message, name: what, stack },
            profileId,
          });
          return ok(undefined);
        },
        notify: (notification, { contentsId }) => {
          const tab = this.#pages.get(contentsId);
          if (tab !== undefined) {
            this.#options.events.emit("page.notified", {
              appId: tab.appId,
              notification,
              profileId: tab.profileId,
              tabId: tab.id,
            });
          }
          return ok(undefined);
        },
      }),
      this.#options.commands.register(googleCommands, {
        toggleMeetCamera: this.#command("camera"),
        toggleMeetMicrophone: this.#command("microphone"),
      }),
      this.#options.settings.subscribe((changes) => {
        if (
          changes.some(
            (change) =>
              change.key === "meet.globalShortcuts" ||
              change.key === "shortcuts.bindings"
          )
        ) {
          this.#applyShortcuts();
        }
      }),
      this.#options.lifecycle.onQuit(async () => {
        this.#release();
        await Promise.resolve();
      }),
      () => {
        this.#release();
      }
    );
  }

  dispose(): void {
    this.#disposables.dispose();
  }

  /** The preload and surface of a Google app's tab other than Gmail. */
  page(tab: Tab): ContentPage {
    return {
      arguments: [contentSurfaceArgument("google")],
      attach: (contentsId): Unsubscribe => {
        const unassign = this.#options.registrar.assign(
          contentsId,
          googleSurface,
          tab.profileId
        );
        this.#pages.set(contentsId, tab);
        if (tab.appId === "meet") {
          this.#meets.push({ contentsId, tabId: tab.id });
          this.#applyShortcuts();
        }
        return () => {
          unassign();
          this.#pages.delete(contentsId);
          const index = this.#meets.findIndex(
            (meet) => meet.contentsId === contentsId
          );
          if (index !== -1) {
            this.#meets.splice(index, 1);
            this.#applyShortcuts();
          }
        };
      },
      preload: this.#options.preload,
    };
  }

  #command(which: MeetToggle) {
    return {
      run: () => {
        this.#toggle(which);
        return ok(undefined);
      },
      when: () => this.#meets.length > 0,
    };
  }

  /** Presses the microphone or camera of the Meet page focused last, and does nothing while none is open. */
  #toggle(which: MeetToggle): void {
    const meet = this.#meets.at(-1);
    if (meet !== undefined) {
      this.#options.registrar.push(meet.contentsId, googlePushes.meetToggle, {
        toggle: which,
      });
    }
  }

  /** The accelerator of each toggle while a Meet call is open and the setting allows it. */
  #wanted(): ReadonlyMap<string, MeetToggle> {
    const { platform, settings } = this.#options;
    if (this.#meets.length === 0 || !settings.get("meet.globalShortcuts")) {
      return new Map();
    }
    const resolved = resolveBindings(
      commandsOf(googleCommands),
      settings.get("shortcuts.bindings"),
      platform
    );
    const wanted = new Map<string, MeetToggle>();
    for (const [id, accelerator] of resolved) {
      const toggle = TOGGLE_COMMANDS[id];
      if (accelerator !== null && toggle !== undefined) {
        wanted.set(accelerator, toggle);
      }
    }
    return wanted;
  }

  #applyShortcuts(): void {
    const wanted = this.#wanted();
    for (const accelerator of this.#held.keys()) {
      if (!wanted.has(accelerator)) {
        this.#options.globalShortcuts.unregister(accelerator);
        this.#held.delete(accelerator);
      }
    }
    for (const accelerator of this.#refused) {
      if (!wanted.has(accelerator)) {
        this.#refused.delete(accelerator);
      }
    }
    for (const [accelerator, toggle] of wanted) {
      if (this.#held.has(accelerator) || this.#refused.has(accelerator)) {
        continue;
      }
      const given = this.#options.globalShortcuts.register(accelerator, () => {
        this.#toggle(toggle);
      });
      if (given) {
        this.#held.set(accelerator, toggle);
      } else {
        this.#refused.add(accelerator);
        this.#options.log.warn(
          "The system would not give a Meet shortcut, which another app holds",
          { accelerator }
        );
      }
    }
  }

  #release(): void {
    for (const accelerator of this.#held.keys()) {
      this.#options.globalShortcuts.unregister(accelerator);
    }
    this.#held.clear();
    this.#refused.clear();
  }
}
