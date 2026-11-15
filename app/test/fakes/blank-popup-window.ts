import type { BlankPopupWindow, Unsubscribe } from "../../core/ports.ts";

/** A blank popup's window, hidden until something shows it, whose renderer a test can end. */
export class FakeBlankPopupWindow implements BlankPopupWindow {
  visible = false;
  destroyed = false;
  readonly #closed = new Set<() => void>();
  readonly #gone = new Set<(reason: string) => void>();

  readonly show = () => {
    if (!this.destroyed) {
      this.visible = true;
    }
  };

  readonly destroy = () => {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.visible = false;
    for (const listener of this.#closed) {
      listener();
    }
  };

  readonly onClosed = (listener: () => void): Unsubscribe => {
    this.#closed.add(listener);
    return () => {
      this.#closed.delete(listener);
    };
  };

  readonly onGone = (listener: (reason: string) => void): Unsubscribe => {
    this.#gone.add(listener);
    return () => {
      this.#gone.delete(listener);
    };
  };

  /** Ends the page's renderer, as a crash or a kill does. */
  readonly end = (reason: string) => {
    for (const listener of this.#gone) {
      listener(reason);
    }
  };

  /** How many listeners the window still holds. */
  get listening(): number {
    return this.#closed.size + this.#gone.size;
  }
}
