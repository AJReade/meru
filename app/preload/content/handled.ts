import type { Unsubscribe } from "../../core/ports.ts";

/** What a feature did to each element it handled, held by the element, so an element the page takes away goes with its undo, and found again for undoing by the attribute that marks it. */
export class Handled {
  readonly #root: ParentNode;
  readonly #marker: string;
  readonly #undos = new WeakMap<Element, Unsubscribe>();

  /** `marker` is the attribute set on each element handled, such as `data-meru-shift-click`. */
  constructor(root: ParentNode, marker: string) {
    this.#root = root;
    this.#marker = marker;
  }

  has(element: Element): boolean {
    return element.hasAttribute(this.#marker);
  }

  add(element: Element, undo: Unsubscribe): void {
    element.setAttribute(this.#marker, "");
    this.#undos.set(element, undo);
  }

  /** Undoes what was done to every handled element still under the root. */
  readonly undoAll = (): void => {
    for (const element of this.#root.querySelectorAll(`[${this.#marker}]`)) {
      this.#undos.get(element)?.();
      this.#undos.delete(element);
      element.removeAttribute(this.#marker);
    }
  };
}
