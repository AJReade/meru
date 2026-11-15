import { DisposableStore } from "../../../core/disposable.ts";
import { tabMenuOf } from "../../../core/engines/tab-menu.ts";
import type {
  TabMenuAction,
  TabMenuLabels,
} from "../../../core/engines/tab-menu.ts";
import type { LogPort } from "../../../core/log.ts";
import type { ClipboardPort, ContextMenuPort } from "../../../core/ports.ts";
import type { ContextMenuEntry } from "../../../core/records/context-menu.ts";
import type { Orientation } from "../../../core/records/layout.ts";
import type { Point } from "../../../core/records/rect.ts";
import { err, ok } from "../../../core/result.ts";
import type { Result } from "../../../core/result.ts";
import { isSingleInstanceId } from "../../../shared/apps.ts";
import type { IpcRegistrar } from "../../../shared/channels/define.ts";
import { sidebar } from "../../../shared/channels/sidebar.ts";
import { msg } from "../../../shared/msg.ts";
import type { Links } from "../links/index.ts";
import type { Profiles } from "../profiles/index.ts";
import type { Stages } from "../stage/index.ts";

const labels = (): TabMenuLabels => ({
  close: msg`Close`,
  closeBelow: msg`Close tabs below`,
  closeOthers: msg`Close other tabs`,
  copyUrl: msg`Copy URL`,
  leaveGroup: msg`Leave group`,
  openInDefaultBrowser: msg`Open in default browser`,
  reload: msg`Reload`,
  sleepWhenIdle: msg`Sleep when idle`,
  splitHorizontal: msg`Split horizontally`,
  splitVertical: msg`Split vertically`,
});

export interface TabMenuOptions {
  readonly profiles: Pick<
    Profiles,
    | "state"
    | "selected"
    | "tab"
    | "closeTabs"
    | "focusTab"
    | "leaveGroup"
    | "letSleep"
  >;
  readonly stages: Pick<Stages, "address" | "reload" | "shown">;
  /** Opens the launcher for a pane of `orientation` beside the focused one in the window whose chrome page is `windowId`, as the split commands do. */
  readonly split: (windowId: number, orientation: Orientation) => void;
  readonly links: Pick<Links, "openExternal">;
  readonly contextMenu: ContextMenuPort;
  readonly clipboard: ClipboardPort;
  readonly registrar: IpcRegistrar;
  readonly log: LogPort;
}

/** The native menu a right-click on a sidebar row opens, built by `tabMenuOf` and carried out through the profiles, the stages, the launcher, the clipboard and the links. */
export class TabMenu {
  readonly #options: TabMenuOptions;
  readonly #disposables = new DisposableStore();

  constructor(options: TabMenuOptions) {
    this.#options = options;
  }

  start(): void {
    this.#disposables.add(
      this.#options.registrar.register(
        { showTabMenu: sidebar.showTabMenu },
        {
          showTabMenu: ({ at, tabId }, { contentsId }) =>
            this.show(contentsId, tabId, at),
        }
      )
    );
  }

  dispose(): void {
    this.#disposables.dispose();
  }

  /** Shows the menu of the tab's row over the chrome page `windowId`, at `at` or else at the pointer; a tab of a profile other than the selected one is refused as unknown. */
  show(
    windowId: number,
    tabId: string,
    at?: Point
  ): Result<undefined, "unknownTab"> {
    const { profiles, stages } = this.#options;
    const tab = profiles.tab(tabId);
    // The sidebar draws only the selected profile's rows, so no page has a row of another's to ask about.
    if (tab === undefined || tab.profileId !== profiles.selected().id) {
      return err("unknownTab");
    }
    const items = tabMenuOf(profiles.state, tab, {
      labels: labels(),
      shown: stages.shown(),
      singleInstance: isSingleInstanceId,
      url: stages.address(tabId) ?? tab.url,
    });
    this.#options.contextMenu.popup(
      windowId,
      items.map((item): ContextMenuEntry => {
        if (item.kind !== "item") {
          return item;
        }
        const { action, checked, enabled, id, label } = item;
        return {
          ...(checked === undefined ? {} : { checked }),
          enabled,
          id,
          kind: "item",
          label,
          run: () => {
            // Electron's click has no caller to hand a throw to, so one would end the app as an uncaught exception.
            try {
              this.#run(windowId, tabId, action);
            } catch (error) {
              this.#options.log.error("A tab menu item failed", {
                error,
                item: id,
              });
            }
          },
        };
      }),
      at
    );
    return ok(undefined);
  }

  #run(windowId: number, tabId: string, action: TabMenuAction): void {
    const { clipboard, links, profiles, split, stages } = this.#options;
    if (action.kind === "reload") {
      stages.reload(tabId);
    } else if (action.kind === "split") {
      // The launcher's pick goes beside the focused pane, so the row's tab is focused first.
      const focused = profiles.focusTab(tabId);
      this.#refused(focused);
      if (focused.ok) {
        split(windowId, action.orientation);
      }
    } else if (action.kind === "leaveGroup") {
      this.#refused(profiles.leaveGroup(tabId));
    } else if (action.kind === "copyUrl") {
      void this.#copy(clipboard.writeText(action.url));
    } else if (action.kind === "openExternal") {
      links.openExternal(action.url);
    } else if (action.kind === "letSleep") {
      this.#refused(profiles.letSleep(tabId, action.sleeps));
    } else {
      const closed = profiles.closeTabs(action.tabIds);
      this.#refused(closed);
      for (const { reason } of closed.ok ? closed.value : []) {
        this.#refused(err(reason));
      }
    }
  }

  // The menu was built from the state as it stood, so a refusal means it changed under the menu; nobody waits on the click to hear it.
  #refused(result: Result<unknown, string>): void {
    if (!result.ok) {
      this.#options.log.warn("A tab menu item was refused", {
        reason: result.error,
      });
    }
  }

  async #copy(write: Promise<void>): Promise<void> {
    try {
      await write;
    } catch (error) {
      this.#options.log.warn("The clipboard refused a copy", { error });
    }
  }
}
