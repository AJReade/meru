import { describe, expect, it } from "vitest";

import { groupOf } from "../../../core/engines/ordering.ts";
import { wireName } from "../../../shared/channels/define.ts";
import type { StageSnapshot } from "../../../shared/channels/stage.ts";
import {
  stagePushes,
  stageSnapshotSchema,
} from "../../../shared/channels/stage.ts";
import { FakeLog, strictLog } from "../../../test/fakes/log.ts";
import { FakeShell } from "../../../test/fakes/shell.ts";
import { PRO, testApp, testStages } from "../../testing.ts";
import type { Profiles } from "../profiles/index.ts";
import { Links } from "./index.ts";

const setup = async () => {
  const app = await testApp({ entitlement: () => PRO });
  const { profiles, settings, transport } = app;
  const shell = new FakeShell();
  const { open, stages, views } = testStages(app, {
    onOpen: (tabId, url, disposition) => links.open(tabId, url, disposition),
    onPopOut: (tabId, url, disposition) =>
      links.popOut(tabId, url, disposition),
    onPopup: (url) => links.popup(url),
  });
  const poppedOut: { contentsId: number; profileId: string }[] = [];
  const links = new Links({
    log: strictLog,
    popOuts: {
      mailbox: "https://mail.google.com/mail/u/0",
      opened: (popOut, profileId) => {
        poppedOut.push({ contentsId: popOut.contentsId, profileId });
      },
    },
    profiles,
    settings,
    shell,
    stages,
  });
  const { window } = open();
  const changes = (): StageSnapshot[] =>
    transport.sent
      .filter((pushed) => pushed.channel === wireName(stagePushes.changed))
      .map((pushed) => stageSnapshotSchema.parse(pushed.payload));
  return { changes, poppedOut, profiles, settings, shell, views, window };
};

const CALENDAR = "https://calendar.google.com/calendar/r/week";

const tabsOf = (profiles: Profiles, appId: string) =>
  profiles.state.tabs.filter((tab) => tab.appId === appId);

describe(Links, () => {
  it("keeps a window Gmail opens under its mailbox as an 800 by 600 pop-out of the tab's profile, and nothing else", async () => {
    const { poppedOut, profiles, shell, views } = await setup();
    const [gmail] = views.created;
    const compose = "https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1";
    const popOut = gmail?.popOut(compose);
    expect([popOut?.spec.width, popOut?.spec.height, poppedOut]).toStrictEqual([
      800,
      600,
      [
        {
          contentsId: popOut?.window.contentsId,
          profileId: profiles.selected().id,
        },
      ],
    ]);
    expect([
      gmail?.popOut(compose, "background"),
      gmail?.popOut("https://mail.google.com/mail/u/0/"),
      gmail?.popOut(CALENDAR),
      gmail?.popOut("https://example.com/"),
      shell.opened,
    ]).toStrictEqual([null, null, null, null, []]);
  });

  it("keeps a pop-out on Gmail's origin and Google's sign-in, sending every other window and navigation to the browser", async () => {
    const { shell, views } = await setup();
    const [gmail] = views.created;
    const routes = gmail?.popOut(
      "https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1"
    )?.spec.routes;
    if (routes === undefined) {
      throw new Error("Gmail opened no pop-out");
    }
    expect([
      routes.open("https://example.com/from-open", "default"),
      routes.open("https://example.com/from-link", "window"),
      routes.open("https://example.com/from-nav", "inPlace"),
      routes.open("https://mail.google.com@example.com/", "inPlace"),
      routes.open("https://mail.google.com/mail/u/0/#inbox", "inPlace"),
      routes.open("https://accounts.google.com/ServiceLogin", "inPlace"),
      routes.open("https://accounts.google.com/AddSession", "window"),
      routes.popup("https://example.com/blank"),
      routes.popup("https://accounts.google.com/o/oauth2/auth"),
      routes.popOut(
        "https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1",
        "window"
      ) === null,
    ]).toStrictEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    await expect
      .poll(() => shell.opened)
      .toStrictEqual([
        "https://example.com/from-open",
        "https://example.com/from-link",
        "https://example.com/from-nav",
        "https://mail.google.com@example.com/",
        "https://example.com/blank",
      ]);
  });

  it("leaves a page navigating itself and a window onto Google's sign-in to Chromium", async () => {
    const { views, shell } = await setup();
    const [gmail] = views.created;
    expect([
      gmail?.open("https://example.com/"),
      gmail?.open(CALENDAR),
      gmail?.open("https://accounts.google.com/signin", "default"),
      shell.opened,
    ]).toStrictEqual([false, false, false, []]);
  });

  it("loads a link to the pane's own app in the pane", async () => {
    const { views, profiles } = await setup();
    const [gmail] = views.created;
    const url = "https://mail.google.com/mail/u/0/#inbox/abc";
    expect(gmail?.open(url, "default")).toBeTruthy();
    expect([gmail?.url, profiles.state.tabs]).toStrictEqual([
      url,
      [expect.objectContaining({ appId: "gmail" })],
    ]);
  });

  it("sends anything but a Google app to the browser, and every app once Google apps open outside", async () => {
    const { views, shell, settings, profiles } = await setup();
    const [gmail] = views.created;
    gmail?.open("https://example.com/", "default");
    settings.set("links.excludedApps", ["calendar"]);
    gmail?.open(CALENDAR, "default");
    settings.set("links.excludedApps", []);
    settings.set("links.openInApp", false);
    gmail?.open(CALENDAR, "background");
    expect([shell.opened, tabsOf(profiles, "calendar")]).toStrictEqual([
      ["https://example.com/", CALENDAR, CALENDAR],
      [],
    ]);
  });

  it("opens another app's link in a new tab split beside the pane and focuses it", async () => {
    const { views, profiles, changes } = await setup();
    const [gmail] = views.created;
    expect(gmail?.open(CALENDAR, "default")).toBeTruthy();
    const [calendar] = tabsOf(profiles, "calendar");
    const last = changes().at(-1);
    expect({
      focused: last?.panes.find((pane) => pane.paneId === last.focusedPaneId)
        ?.tabId,
      group: profiles.currentGroup()?.tabIds,
      url: calendar?.url,
      viewUrl: views.created[1]?.url,
    }).toStrictEqual({
      focused: calendar?.id,
      group: [profiles.state.tabs[0]?.id, calendar?.id],
      url: CALENDAR,
      viewUrl: CALENDAR,
    });
  });

  it("opens a background tab in a group of its own without showing it, and a window's link as a tab, there being no group windows yet", async () => {
    const { views, profiles, window } = await setup();
    const [gmail] = views.created;
    gmail?.open(CALENDAR, "background");
    const background = {
      calendar: tabsOf(profiles, "calendar").length,
      children: window.childViews().length,
      group: profiles.currentGroup()?.tabIds.length,
    };
    gmail?.open("https://drive.google.com/drive/my-drive", "window");
    const [drive] = tabsOf(profiles, "drive");
    const group = groupOf(drive?.id ?? "", profiles.state.groups);
    expect([background, group?.tabIds]).toStrictEqual([
      { calendar: 1, children: 1, group: 1 },
      [drive?.id],
    ]);
  });

  it("brings the tab already showing the app to the front with the link, Gmail's one tab among them", async () => {
    const { views, profiles } = await setup();
    const [gmail] = views.created;
    gmail?.open(CALENDAR, "default");
    const [, calendarView] = views.created;
    const later = "https://calendar.google.com/calendar/r/day";
    calendarView?.open(
      "https://mail.google.com/mail/u/0/#inbox/xyz",
      "default"
    );
    gmail?.open(later, "default");
    expect({
      calendars: tabsOf(profiles, "calendar").length,
      calendarUrl: calendarView?.url,
      gmailUrl: gmail?.url,
      views: views.created.length,
    }).toStrictEqual({
      calendarUrl: later,
      calendars: 1,
      gmailUrl: "https://mail.google.com/mail/u/0/#inbox/xyz",
      views: 2,
    });
  });

  it("starts a tab no stage keeps a view of yet at the link, rather than losing it, without making the link the tab's address", async () => {
    const { views, profiles } = await setup();
    const [gmail] = views.created;
    gmail?.open(CALENDAR, "background");
    const later = "https://calendar.google.com/calendar/r/day";
    gmail?.open(later, "default");
    const [calendar] = tabsOf(profiles, "calendar");
    expect([calendar?.url, views.created[1]?.url]).toStrictEqual([
      CALENDAR,
      later,
    ]);
  });

  it("shows a blank popup only once it heads for Google's sign-in, and sends anything else to the browser", async () => {
    const { views, shell } = await setup();
    const [gmail] = views.created;
    expect([
      gmail?.popup("https://accounts.google.com/o/oauth2/auth"),
      gmail?.popup("https://example.com/"),
      shell.opened,
    ]).toStrictEqual([true, false, ["https://example.com/"]]);
  });

  it("writes a warning when the system opens no browser for a link", async () => {
    const { profiles, settings } = await setup();
    const log = new FakeLog();
    const links = new Links({
      log: log.scoped("links"),
      profiles,
      settings,
      shell: {
        openExternal: async (url) => {
          await Promise.reject(new Error(`No application opens ${url}`));
        },
      },
      stages: { load: () => {} },
    });
    expect(links.popup("https://example.com/")).toBeFalsy();
    await expect
      .poll(() => log.at("warn"))
      .toStrictEqual(["The browser did not open a link"]);
  });

  it("hands the system only a web page or a mail address, refusing any other scheme with one warning", async () => {
    const { profiles, settings } = await setup();
    const log = new FakeLog();
    const shell = new FakeShell();
    const links = new Links({
      log: log.scoped("links"),
      profiles,
      settings,
      shell,
      stages: { load: () => {} },
    });
    const tabId = profiles.state.tabs[0]?.id ?? "";
    const refused = [
      "data:text/html,<title>data</title>",
      "blob:https://mail.google.com/9bc4d142-eda8-4f2e-83cc-7de575bcfe24",
      "file:///System/Applications/Calculator.app",
      // oxlint-disable-next-line no-script-url -- a page handing the system a script address is the case refused
      "javascript:alert(1)",
      "x-meru-test://run",
    ];
    expect([
      ...refused.map((url) => links.open(tabId, url, "default")),
      links.open(tabId, "https://example.com/", "default"),
      links.popup("mailto:ada@example.com"),
    ]).toStrictEqual([true, true, true, true, true, true, false]);
    await expect
      .poll(() => shell.opened)
      .toStrictEqual(["https://example.com/", "mailto:ada@example.com"]);
    expect(log.at("warn")).toStrictEqual(
      refused.map(() => "A link was not opened outside the app")
    );
  });
});
