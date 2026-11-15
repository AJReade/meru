import type { ContextMenuPort, Unsubscribe } from "../../core/ports.ts";
import type {
  ContextMenuEntry,
  ContextMenuParams,
  PageAction,
} from "../../core/records/context-menu.ts";

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

  readonly popup = (
    contentsId: number,
    entries: readonly ContextMenuEntry[]
  ) => {
    this.shown.set(contentsId, entries);
  };

  readonly act = (contentsId: number, action: PageAction) => {
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
