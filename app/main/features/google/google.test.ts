import { describe, expect, it } from "vitest";

import type { Tab } from "../../../core/records/tab.ts";
import { wireName } from "../../../shared/channels/define.ts";
import {
  google as googleChannels,
  googlePushes,
} from "../../../shared/channels/google.ts";
import { googleSurface } from "../../../shared/channels/surfaces.ts";
import { FakeGlobalShortcuts } from "../../../test/fakes/global-shortcuts.ts";
import { FakeLog } from "../../../test/fakes/log.ts";
import { unwrap } from "../../../test/result.ts";
import { testApp } from "../../testing.ts";
import { Google } from "./index.ts";

const tabOf = (id: string, appId: string): Tab => ({
  appId,
  health: "ok",
  id,
  profileId: "personal",
  sleeps: true,
  title: null,
  url: "https://meet.google.com/",
  zoom: 1,
});

const setup = async () => {
  const app = await testApp();
  const log = new FakeLog();
  const globalShortcuts = new FakeGlobalShortcuts();
  const google = new Google({
    commands: app.commands,
    events: app.events,
    globalShortcuts,
    lifecycle: app.lifecycle,
    log: log.scoped("google"),
    platform: "darwin",
    preload: "/dist/preload/google.cjs",
    registrar: app.registrar,
    settings: app.settings,
  });
  google.start();
  const toggles = () =>
    app.transport.sent
      .filter((sent) => sent.channel === wireName(googlePushes.meetToggle))
      .map(({ contentsId, payload }) => ({ contentsId, payload }));
  return { app, globalShortcuts, google, log, toggles };
};

describe(Google, () => {
  it("toggles the Meet page focused last, whatever order they opened in", async () => {
    const { app, google, toggles } = await setup();
    google.page(tabOf("first", "meet")).attach(4);
    google.page(tabOf("second", "meet")).attach(5);
    app.events.emit("tab.focused", { groupId: "g", tabId: "first" });
    unwrap(app.commands.run("google.toggleMeetMicrophone", { windowId: 1 }));
    app.events.emit("tab.focused", { groupId: "g", tabId: "docs" });
    unwrap(app.commands.run("google.toggleMeetCamera", { windowId: 1 }));
    expect(toggles()).toStrictEqual([
      { contentsId: 4, payload: { toggle: "microphone" } },
      { contentsId: 4, payload: { toggle: "camera" } },
    ]);
  });

  it("toggles the latest Meet page's microphone and camera, and nothing while none is open", async () => {
    const { app, google, toggles } = await setup();
    expect(app.commands.enabled("google.toggleMeetMicrophone")).toBeFalsy();
    google.page(tabOf("docs", "docs")).attach(3);
    const first = google.page(tabOf("first", "meet")).attach(4);
    const second = google.page(tabOf("second", "meet")).attach(5);
    unwrap(app.commands.run("google.toggleMeetMicrophone", { windowId: 1 }));
    second();
    unwrap(app.commands.run("google.toggleMeetCamera", { windowId: 1 }));
    expect(toggles()).toStrictEqual([
      { contentsId: 5, payload: { toggle: "microphone" } },
      { contentsId: 4, payload: { toggle: "camera" } },
    ]);
    first();
    expect(app.commands.enabled("google.toggleMeetCamera")).toBeFalsy();
  });

  it("writes an error for a failure the page's preload reports, under the sender's profile", async () => {
    const { app, google, log } = await setup();
    google.page(tabOf("docs", "docs")).attach(3);
    unwrap(
      app.registrar.dispatch(3, wireName(googleChannels.failed), {
        message: "denied",
        what: "grantDocsClipboard",
      })
    );
    expect(log.entries).toMatchObject([
      {
        fields: {
          error: { message: "denied", name: "grantDocsClipboard" },
          profileId: "personal",
        },
        level: "error",
        message: "A Google page's preload failed",
      },
    ]);
    expect(googleSurface.requests).toHaveLength(1);
  });

  it("takes the toggles' accelerators system-wide while a Meet call is open, and hands them back when the last goes", async () => {
    const { globalShortcuts, google, toggles } = await setup();
    expect(globalShortcuts.registered).toStrictEqual([]);

    const call = google.page(tabOf("first", "meet")).attach(4);
    expect(globalShortcuts.registered).toStrictEqual([
      "CommandOrControl+Shift+1",
      "CommandOrControl+Shift+2",
    ]);

    globalShortcuts.press("CommandOrControl+Shift+2");
    expect(toggles()).toStrictEqual([
      { contentsId: 4, payload: { toggle: "camera" } },
    ]);

    call();
    expect(globalShortcuts.registered).toStrictEqual([]);
  });

  it("holds nothing while the setting is off, and takes the binding the user chose", async () => {
    const { app, globalShortcuts, google } = await setup();
    app.settings.set("meet.globalShortcuts", false);
    google.page(tabOf("first", "meet")).attach(4);
    expect(globalShortcuts.registered).toStrictEqual([]);

    app.settings.set("meet.globalShortcuts", true);
    expect(globalShortcuts.registered).toHaveLength(2);

    app.settings.set("shortcuts.bindings", {
      "google.toggleMeetMicrophone": "CommandOrControl+Alt+K",
    });
    expect(globalShortcuts.registered).toStrictEqual([
      "CommandOrControl+Shift+2",
      "CommandOrControl+Alt+K",
    ]);
  });

  it("writes one warning for an accelerator another app holds, and holds nothing after a quit", async () => {
    const { app, globalShortcuts, google, log } = await setup();
    globalShortcuts.taken.add("CommandOrControl+Shift+1");
    google.page(tabOf("first", "meet")).attach(4);
    google.page(tabOf("second", "meet")).attach(5);
    expect(globalShortcuts.registered).toStrictEqual([
      "CommandOrControl+Shift+2",
    ]);
    expect(log.entries.filter((entry) => entry.level === "warn")).toMatchObject(
      [{ fields: { accelerator: "CommandOrControl+Shift+1" } }]
    );

    await app.lifecycle.quitAndWait();
    expect(globalShortcuts.registered).toStrictEqual([]);
  });
});
