import type { NotificationPort, NotificationSpec } from "../../core/ports.ts";

export class FakeNotifications implements NotificationPort {
  /** Every notification shown, in order, each with a click on it and, when it has buttons, a press of the one at an index. */
  readonly shown: {
    spec: NotificationSpec;
    click: () => void;
    act: ((index: number) => void) | undefined;
  }[] = [];

  readonly show = (
    spec: NotificationSpec,
    onClick: () => void,
    onAction?: (index: number) => void
  ) => {
    this.shown.push({ act: onAction, click: onClick, spec });
  };
}
