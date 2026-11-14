import type { NotificationPort, NotificationSpec } from "../../core/ports.ts";

export class FakeNotifications implements NotificationPort {
  /** Every notification shown, in order, each with a click on it and, when it has a button, a press of that. */
  readonly shown: {
    spec: NotificationSpec;
    click: () => void;
    act: (() => void) | undefined;
  }[] = [];

  readonly show = (
    spec: NotificationSpec,
    onClick: () => void,
    onAction?: () => void
  ) => {
    this.shown.push({ act: onAction, click: onClick, spec });
  };
}
