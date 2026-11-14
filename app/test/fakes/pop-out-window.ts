import type { PopOutWindow, Unsubscribe } from "../../core/ports.ts";

let nextContentsId = 5000;

/** A pop-out window a test opens through `FakeView.popOut`, shown until something hides or closes it. */
export class FakePopOutWindow implements PopOutWindow {
  readonly contentsId: number;
  visible = true;
  closed = false;
  readonly #closedListeners = new Set<() => void>();

  constructor() {
    nextContentsId += 1;
    this.contentsId = nextContentsId;
  }

  readonly show = () => {
    this.visible = true;
  };

  readonly hide = () => {
    this.visible = false;
  };

  readonly close = () => {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.visible = false;
    for (const listener of this.#closedListeners) {
      listener();
    }
  };

  readonly onClosed = (listener: () => void): Unsubscribe => {
    this.#closedListeners.add(listener);
    return () => {
      this.#closedListeners.delete(listener);
    };
  };
}
