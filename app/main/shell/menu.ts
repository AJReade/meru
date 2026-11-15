import { DisposableStore } from "../../core/disposable.ts";
import { buildMenu } from "../../core/engines/menu.ts";
import type { MenuLabels } from "../../core/engines/menu.ts";
import { conflicts, resolveBindings } from "../../core/engines/shortcuts.ts";
import type { AppEvents } from "../../core/events.ts";
import type { LogPort } from "../../core/log.ts";
import type { MenuSection } from "../../core/records/menu.ts";
import type { Platform } from "../../core/records/platform.ts";
import type { Command } from "../../shared/commands/define.ts";
import type { CommandId } from "../../shared/commands/registry.ts";
import { msg } from "../../shared/msg.ts";
import type { SettingsStore } from "../features/settings/index.ts";
import type { CommandDispatcher } from "./commands.ts";

interface ApplicationMenuOptions {
  readonly platform: Platform;
  readonly commands: readonly Command<CommandId>[];
  readonly dispatcher: Pick<CommandDispatcher, "run" | "enabled" | "checked">;
  /** The window the menu asks about, whose state an item such as a toggle shows: the main window, once it is open. */
  readonly windowId?: () => number | undefined;
  /** Rebuilds the menu when a command's `when` may have changed. */
  readonly events: Pick<AppEvents, "on">;
  readonly settings: Pick<SettingsStore, "get" | "subscribe">;
  /** Hands the built menu to Electron. */
  readonly apply: (sections: readonly MenuSection<CommandId>[]) => void;
  readonly log: LogPort;
}

// Each platform's own word for quitting, as Electron's role gives it.
const QUIT: Readonly<Record<Platform, string>> = {
  darwin: msg`Quit Meru`,
  linux: msg`Quit`,
  win32: msg`Exit`,
};

/** The application menu's submenu titles and role labels on `platform`. */
export const menuLabels = (platform: Platform): MenuLabels => ({
  about: msg`About Meru`,
  close: msg`Close window`,
  copy: msg`Copy`,
  cut: msg`Cut`,
  delete: msg`Delete`,
  edit: msg`Edit`,
  file: msg`File`,
  hideOthers: msg`Hide others`,
  history: msg`History`,
  minimize: msg`Minimize`,
  paste: msg`Paste`,
  pasteAndMatchStyle: msg`Paste and match style`,
  profiles: msg`Profiles`,
  quit: QUIT[platform],
  redo: msg`Redo`,
  selectAll: msg`Select all`,
  undo: msg`Undo`,
  unhide: msg`Show all`,
  view: msg`View`,
});

/** Keeps the application menu built from the commands and the user's shortcuts, rebuilding it when the shortcuts change. */
export class ApplicationMenu {
  readonly #options: ApplicationMenuOptions;
  readonly #disposables = new DisposableStore();

  constructor(options: ApplicationMenuOptions) {
    this.#options = options;
  }

  start(): void {
    this.#build();
    this.#disposables.add(
      this.#options.settings.subscribe((changes) => {
        if (changes.some((change) => change.key === "shortcuts.bindings")) {
          this.#build();
        }
      }),
      this.#options.events.on("menu.invalidated", () => {
        this.#build();
      })
    );
  }

  dispose(): void {
    this.#disposables.dispose();
  }

  #build(): void {
    const { platform, commands, dispatcher, settings, apply, log } =
      this.#options;
    const bindings = resolveBindings(
      commands,
      settings.get("shortcuts.bindings"),
      platform
    );
    for (const conflict of conflicts(bindings, platform)) {
      log.warn("Commands share a shortcut", {
        accelerator: conflict.accelerator,
        ids: conflict.ids,
      });
    }
    apply(
      buildMenu({
        bindings,
        commands,
        labels: menuLabels(platform),
        checked: (id) => dispatcher.checked(id, this.#options.windowId?.()),
        enabled: (id) => dispatcher.enabled(id, this.#options.windowId?.()),
        platform,
        run: (id, windowId) => {
          const result = dispatcher.run(id, { windowId });
          if (!result.ok) {
            log.warn("A command refused to run", { id, reason: result.error });
          }
        },
      })
    );
  }
}
