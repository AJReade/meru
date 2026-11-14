import { asyncNoop, noop } from "es-toolkit";

import type {
  Clock,
  Failure,
  LifecyclePort,
  Unsubscribe,
} from "../../core/ports.ts";
import type { Platform } from "../../core/records/platform.ts";

const NO_TIME: Pick<Clock, "now"> = { now: () => 0 };

export class FakeLifecycle implements LifecyclePort {
  readonly platform: Platform;
  readonly packaged: boolean;
  quitting = false;
  readonly #quitTasks = new Set<() => Promise<void>>();
  readonly #allClosed = new Set<() => void>();
  readonly #failures = new Set<(failure: Failure) => void>();
  /** Until when each muted page's console goes unheard. */
  readonly muted = new Map<number, number>();
  readonly #clock: Pick<Clock, "now">;

  constructor(
    platform: Platform = "darwin",
    packaged = false,
    clock: Pick<Clock, "now"> = NO_TIME
  ) {
    this.platform = platform;
    this.packaged = packaged;
    this.#clock = clock;
  }

  readonly muteConsole = (contentsId: number, duration?: number) => {
    this.muted.set(
      contentsId,
      duration === undefined
        ? Number.POSITIVE_INFINITY
        : this.#clock.now() + duration
    );
  };

  readonly whenReady = asyncNoop;

  readonly onWindowAllClosed = (listener: () => void): Unsubscribe => {
    this.#allClosed.add(listener);
    return () => {
      this.#allClosed.delete(listener);
    };
  };

  readonly onQuit = (task: () => Promise<void>): Unsubscribe => {
    this.#quitTasks.add(task);
    return () => {
      this.#quitTasks.delete(task);
    };
  };

  readonly quit = () => {
    void this.quitAndWait();
  };

  /** Quits as Electron would, resolving once every task the quit waits on has settled. */
  readonly quitAndWait = async () => {
    this.quitting = true;
    await Promise.allSettled(
      [...this.#quitTasks].map(async (task) => {
        await task();
      })
    );
  };

  readonly onFailure = (listener: (failure: Failure) => void): Unsubscribe => {
    this.#failures.add(listener);
    return () => {
      this.#failures.delete(listener);
    };
  };

  /** Reports a failure as Electron or Node would, which hears nothing of a muted page's console. */
  readonly fail = (failure: Failure) => {
    if (
      failure.kind === "consoleError" &&
      this.#clock.now() < (this.muted.get(failure.contentsId) ?? 0)
    ) {
      return;
    }
    for (const listener of this.#failures) {
      listener(failure);
    }
  };

  readonly prohibitActivation = noop;
}
