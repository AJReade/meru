import { beforeEach, describe, expect, it } from "vitest";

import { google } from "../../shared/channels/google.ts";
import { googleSurface } from "../../shared/channels/surfaces.ts";
import { failureReporter } from "../content/failures.ts";
import { FakeContentBridge } from "../content/fake-bridge.ts";
import { listenForNotifications, NOTIFICATION_EVENT } from "./notifications.ts";

const setup = () => {
  const bridge = new FakeContentBridge(googleSurface);
  const fail = failureReporter((failure) => {
    bridge.send(google.failed, failure);
  });
  const off = listenForNotifications(
    document,
    (notification) => {
      bridge.send(google.notify, notification);
    },
    fail
  );
  return {
    bridge,
    failures: () => bridge.sentOn(google.failed),
    notifications: () => bridge.sentOn(google.notify),
    off,
    raise: (detail: unknown) => {
      document.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail }));
    },
  };
};

describe(listenForNotifications, () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("forwards what the page raised, keeping only the fields the schema declares", () => {
    const { notifications, raise } = setup();

    raise(
      JSON.stringify({
        body: "Starts in ten minutes",
        icon: "https://calendar.google.com/icon.png",
        requireInteraction: true,
        title: "Standup",
      })
    );

    expect(notifications()).toStrictEqual([
      {
        body: "Starts in ten minutes",
        requireInteraction: true,
        title: "Standup",
      },
    ]);
  });

  it("reports and drops a detail that is not a string, is not JSON or the schema refuses", () => {
    const { failures, notifications, raise } = setup();

    raise({ title: "An object, not a string" });
    raise("{not json");
    raise(JSON.stringify({ title: 42 }));
    raise(JSON.stringify({ title: "x".repeat(201) }));

    expect(notifications()).toStrictEqual([]);
    expect(failures()).toHaveLength(4);
  });

  it("hears nothing more once it is undone", () => {
    const { notifications, off, raise } = setup();
    off();

    raise(JSON.stringify({ title: "Standup" }));

    expect(notifications()).toStrictEqual([]);
  });
});
