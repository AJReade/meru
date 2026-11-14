import type { GlobalShortcutPort } from "../../core/ports.ts";

/** The system's shortcuts a test drives: it holds what it gave out, refuses what `taken` says another app holds and what it already gave, and `press` runs one as the system would. */
export class FakeGlobalShortcuts implements GlobalShortcutPort {
  readonly #held = new Map<string, () => void>();
  /** The accelerators another app holds, which the system refuses. */
  readonly taken = new Set<string>();

  readonly register = (accelerator: string, run: () => void): boolean => {
    if (this.taken.has(accelerator) || this.#held.has(accelerator)) {
      return false;
    }
    this.#held.set(accelerator, run);
    return true;
  };

  readonly unregister = (accelerator: string): void => {
    this.#held.delete(accelerator);
  };

  /** The accelerators the app holds now, in the order it was given them. */
  get registered(): readonly string[] {
    return [...this.#held.keys()];
  }

  /** Presses the accelerator, doing nothing when the app does not hold it. */
  readonly press = (accelerator: string): void => {
    this.#held.get(accelerator)?.();
  };
}
