import { setImmediate } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { parseFeed } from "../../../core/engines/feed.ts";
import { GMAIL_URL } from "../../../core/engines/inbox.ts";
import { PAGE_NOTICE_WINDOW } from "../../../core/engines/notifications.ts";
import { TWO_UNREAD } from "../../../core/fixtures/gmail-feeds.ts";
import { gmail } from "../../../shared/apps.ts";
import { chromeSurface } from "../../../shared/channels/surfaces.ts";
import { FakeNotifications } from "../../../test/fakes/notifications.ts";
import { unwrap } from "../../../test/result.ts";
import { PRO, testApp } from "../../testing.ts";
import { Notifications } from "./index.ts";

const parsed = parseFeed(TWO_UNREAD);
const entries = parsed.ok ? parsed.value.entries.toReversed() : [];
const [older, newest] = entries;

const setup = async () => {
  const { clock, events, profiles, registrar, settings } = await testApp({
    entitlement: () => PRO,
  });
  registrar.assign(3, chromeSurface);
  const port = new FakeNotifications();
  const loaded: string[] = [];
  let shown = 0;
  const important = new Set([newest?.id ?? ""]);
  const acted: { tabId: string; messageId: string; action: string }[] = [];
  const notifications = new Notifications({
    act: (tabId, messageId, action) => {
      acted.push({ action, messageId, tabId });
    },
    clock,
    events,
    inbox: { important: async () => await Promise.resolve(important) },
    gmailUrl: GMAIL_URL,
    load: (_tabId, url) => {
      loaded.push(url);
    },
    notifications: port,
    platform: "darwin",
    profiles,
    settings,
    showWindow: () => {
      shown += 1;
    },
  });
  notifications.start();
  const first = profiles.selected().id;
  const arrive = async (profileId = first, arrived = entries) => {
    events.emit("mail.arrived", { entries: arrived, profileId });
    await setImmediate();
  };
  const focused: string[] = [];
  events.on("tab.focused", ({ tabId }) => {
    focused.push(tabId);
  });
  return {
    acted,
    arrive,
    clock,
    events,
    first,
    focused,
    loaded,
    port,
    profiles,
    settings,
    shown: () => shown,
  };
};

describe(Notifications, () => {
  it("shows one notification per new email, oldest first, as the settings word it", async () => {
    const { arrive, port, settings } = await setup();
    settings.set("notifications.showSummary", false);
    settings.set("notifications.playSound", false);
    await arrive();
    expect(port.shown.map((shown) => shown.spec)).toStrictEqual([
      { silent: true, subtitle: "2024", title: "12345" },
      {
        silent: true,
        subtitle: 'Q3 & Q4 "plans" – Tom\'s draft',
        title: "Tom O'Brien",
      },
    ]);
  });

  it("names the profile once there are several, and shows nothing for a profile whose notifications are off", async () => {
    const { arrive, first, port, profiles, settings } = await setup();
    const work = profiles.createProfile("Work");
    const workId = work.ok ? work.value.id : "";
    settings.set("notifications.enabled", false, first);
    await arrive();
    await arrive(workId);
    expect(port.shown.map((shown) => shown.spec.title)).toStrictEqual([
      "[Work] 12345",
      "[Work] Tom O'Brien",
    ]);
  });

  it("notifies only about important email when asked", async () => {
    const { arrive, port, settings } = await setup();
    settings.set("notifications.newEmails", "important");
    await arrive();
    expect(port.shown.map((shown) => shown.spec.title)).toStrictEqual([
      "Tom O'Brien",
    ]);
  });

  it("opens the message in the profile's Gmail tab when a notification is clicked, leaving the tab's own address as it was", async () => {
    const { arrive, loaded, port, profiles, shown } = await setup();
    await arrive();
    port.shown[0]?.click();
    const tab = profiles.state.tabs.find((found) => found.appId === gmail.id);
    expect({ loaded, shown: shown(), url: tab?.url }).toStrictEqual({
      loaded: [`https://mail.google.com/mail/u/0/#inbox/${older?.messageId}`],
      shown: 1,
      url: gmail.url,
    });
  });

  it("offers no buttons until the actions are turned on, and leaves the window where it is when one is pressed", async () => {
    const { acted, arrive, port, profiles, settings, shown } = await setup();
    await arrive();
    expect([port.shown[0]?.spec.actions, port.shown[0]?.act]).toStrictEqual([
      undefined,
      undefined,
    ]);

    settings.set("notifications.actions", true);
    await arrive();
    const first = port.shown.at(2);
    expect(first?.spec.actions).toStrictEqual(["Archive", "Mark as read"]);
    first?.act?.(1);
    // A press on a button the notification does not have acts on nothing.
    first?.act?.(2);
    const tab = profiles.state.tabs.find((found) => found.appId === gmail.id);
    expect({ acted, shown: shown() }).toStrictEqual({
      acted: [
        { action: "markRead", messageId: older?.messageId, tabId: tab?.id },
      ],
      shown: 0,
    });
  });

  it("raises one notification for more new emails than a handful, which opens the inbox", async () => {
    const { arrive, loaded, port } = await setup();
    const many = Array.from({ length: 6 }, (_, index) => ({
      ...older,
      id: `entry-${index}`,
      messageId: `m${index}`,
      subject: `Subject ${index}`,
      summary: "",
      link: "",
      author: { email: "a@example.com", name: "A" },
      issued: index,
    }));
    await arrive(undefined, many);
    port.shown[0]?.click();
    expect({
      loaded,
      shown: port.shown.map((shown) => shown.spec),
    }).toStrictEqual({
      loaded: ["https://mail.google.com/mail/u/0/#inbox"],
      shown: [{ silent: false, title: "6 new emails" }],
    });
  });

  it("shows what a Google app's page raised, and brings its tab to the front when it is clicked", async () => {
    const { events, first, focused, port, profiles, shown } = await setup();
    const tab = unwrap(profiles.openTab(first, "calendar"));
    events.emit("page.notified", {
      appId: "calendar",
      notification: { body: "Starts in ten minutes", title: "Standup" },
      profileId: first,
      tabId: tab.id,
    });
    expect(port.shown.map((raised) => raised.spec)).toStrictEqual([
      {
        body: "Starts in ten minutes",
        // Calendar plays its own sound, so the notification is silent whatever the page asked.
        silent: true,
        subtitle: "Standup",
        title: "Calendar",
      },
    ]);

    port.shown[0]?.click();
    expect({ focused, shown: shown() }).toStrictEqual({
      focused: [tab.id],
      shown: 1,
    });
  });

  it("shows nothing a Google app's page raised while the setting is off", async () => {
    const { events, first, port, profiles, settings } = await setup();
    settings.set("notifications.allowFromWorkspaceApps", false);
    const tab = unwrap(profiles.openTab(first, "calendar"));
    events.emit("page.notified", {
      appId: "calendar",
      notification: { title: "Standup" },
      profileId: first,
      tabId: tab.id,
    });
    expect(port.shown).toStrictEqual([]);
  });

  it("shows a page's first few notifications a minute and one saying more were held back, whatever the page floods or asks to keep", async () => {
    const { clock, events, first, port, profiles } = await setup();
    const tab = unwrap(profiles.openTab(first, "calendar"));
    const other = unwrap(profiles.openTab(first, "chat"));
    for (let index = 0; index < 2000; index += 1) {
      events.emit("page.notified", {
        appId: "calendar",
        notification: { title: `Flood ${index}` },
        profileId: first,
        tabId: tab.id,
      });
    }
    events.emit("page.notified", {
      appId: "chat",
      notification: { title: "Ada" },
      profileId: first,
      tabId: other.id,
    });
    clock.advance(PAGE_NOTICE_WINDOW);
    events.emit("page.notified", {
      appId: "calendar",
      notification: { title: "Later" },
      profileId: first,
      tabId: tab.id,
    });
    expect(port.shown.map((raised) => raised.spec.subtitle)).toStrictEqual([
      "Flood 0",
      "Flood 1",
      "Flood 2",
      "Flood 3",
      "More notifications held back",
      "Ada",
      "Later",
    ]);
  });
});
