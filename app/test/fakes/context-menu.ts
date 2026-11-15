import type { ContextMenuPort, Unsubscribe } from "../../core/ports.ts";
import type {
  ContextMenuEntry,
  ContextMenuParams,
  PageAction,
} from "../../core/records/context-menu.ts";
import type { Point } from "../../core/records/rect.ts";

/** Pages a test right-clicks, the menus they would show and what was done to them. */
export class FakeContextMenu implements ContextMenuPort {
  /** The menu shown last, by page. */
  readonly shown = new Map<number, readonly ContextMenuEntry[]>();
  readonly acted: {
    readonly contentsId: number;
    readonly action: PageAction;
  }[] = [];
  readonly #listeners = new Map<
    number,
    Set<(params: ContextMenuParams) => void>
  >();

  readonly listen = (
    contentsId: number,
    listener: (params: ContextMenuParams) => void
  ): Unsubscribe => {
    const listeners = this.#listeners.get(contentsId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(contentsId, listeners);
    return () => {
      listeners.delete(listener);
    };
  };

  /** Where the menu shown last was put, by page; absent for one at the pointer. */
  readonly at = new Map<number, Point>();

  readonly popup = (
    contentsId: number,
    entries: readonly ContextMenuEntry[],
    at?: Point
  ) => {
    this.shown.set(contentsId, entries);
    if (at === undefined) {
      this.at.delete(contentsId);
    } else {
      this.at.set(contentsId, at);
    }
  };

  /** Whether acting on a page throws, as Electron does on a page destroyed under the menu. */
  failing = false;

  readonly act = (contentsId: number, action: PageAction) => {
    if (this.failing) {
      throw new Error("The page is gone");
    }
    this.acted.push({ action, contentsId });
  };

  /** Right-clicks the page as Chromium would report it; false when nothing hears it. */
  readonly rightClick = (
    contentsId: number,
    params: ContextMenuParams
  ): boolean => {
    const listeners = [...(this.#listeners.get(contentsId) ?? [])];
    for (const listener of listeners) {
      listener(params);
    }
    return listeners.length > 0;
  };

  /** Clicks the item `id` of the menu the page showed last; false when it has none such or it is disabled. */
  readonly click = (contentsId: number, id: string): boolean => {
    const entry = this.shown
      .get(contentsId)
      ?.find((shown) => shown.kind === "item" && shown.id === id);
    if (entry?.kind !== "item" || !entry.enabled) {
      return false;
    }
    entry.run();
    return true;
  };
}
