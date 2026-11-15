import { describe, expect, it } from "vitest";

import { wireName } from "../../../shared/channels/define.ts";
import { profilesPushes } from "../../../shared/channels/profiles.ts";
import { sidebar } from "../../../shared/channels/sidebar.ts";
import { FakeClipboard } from "../../../test/fakes/clipboard.ts";
import { FakeContextMenu } from "../../../test/fakes/context-menu.ts";
import { strictLog } from "../../../test/fakes/log.ts";
import { FakeShell } from "../../../test/fakes/shell.ts";
import { unwrap } from "../../../test/result.ts";
import { PRO, testApp, testStages } from "../../testing.ts";
import { Launcher } from "../launcher/index.ts";
import { Links } from "../links/index.ts";
import { TabMenu } from "./tab-menu.ts";

const setup = async () => {
  const app = await testApp({ entitlement: () => PRO });
  const { commands, events, profiles, registrar, settings, transport } = app;
  const { open, stages, views } = testStages(app);
  const launcher = new Launcher({
    commands,
    overlayUrl: (kind, query) =>
      `overlay.html?${new URLSearchParams({ ...query, kind }).toString()}`,
    registrar,
    stages,
  });
  const shell = new FakeShell();
  const links = new Links({
    log: strictLog,
    profiles,
    settings,
    shell,
    stages,
  });
  const port = new FakeContextMenu();
  const clipboard = new FakeClipboard();
  const menu = new TabMenu({
    clipboard,
    contextMenu: port,
    links,
    log: strictLog,
    profiles,
    registrar,
    split: (windowId, orientation) => {
      launcher.open(windowId, orientation);
    },
    stages,
  });
  const { stage, window } = open();
  launcher.start();
  menu.start();
  const profileId = profiles.selected().id;
  const [gmail] = profiles.state.tabs;
  if (gmail === undefined) {
    throw new Error("The profile has no tab");
  }
  const add = (appId: string) => unwrap(profiles.openTab(profileId, appId)).id;
  const show = (tabId: string, at?: { x: number; y: number }) =>
    registrar.dispatch(window.contentsId, wireName(sidebar.showTabMenu), {
      ...(at === undefined ? {} : { at }),
      tabId,
    });
  const at = () => port.at.get(window.contentsId);
  const changes = {
    get pages() {
      return transport.sent.filter(
        (sent) =>
          sent.contentsId === window.contentsId &&
          sent.channel === wireName(profilesPushes.changed)
      ).length;
    },
    stage: 0,
  };
  events.on("stage.invalidated", () => {
    changes.stage += 1;
  });
  const shown = () => port.shown.get(window.contentsId) ?? [];
  const click = (id: string) => port.click(window.contentsId, id);
  const item = (id: string) =>
    shown().find((entry) => entry.kind === "item" && entry.id === id);
  const left = () => profiles.state.tabs.map((tab) => tab.id);
  const paneOf = (tabId: string) => {
    const contentsId = stage.panes().find(({ tab }) => tab.id === tabId)
      ?.view.contentsId;
    return views.created.find((view) => view.contentsId === contentsId);
  };
  return {
    add,
    at,
    changes,
    click,
    clipboard,
    gmail: gmail.id,
    item,
    left,
    paneOf,
    profiles,
    shell,
    show,
    shown,
    stage,
    views,
  };
};

describe(TabMenu, () => {
  it("shows the row's menu over the sender's window on sidebar.showTabMenu", async () => {
    const { add, show, shown } = await setup();
    expect(show(add("calendar")).ok).toBeTruthy();
    expect(
      shown().map((entry) => (entry.kind === "item" ? entry.label : "-"))
    ).toStrictEqual([
      "Reload",
      "Split Vertically",
      "Split Horizontally",
      "Leave Group",
      "-",
      "Copy URL",
      "Open in Default Browser",
      "-",
      "Sleep When Idle",
      "-",
      "Close",
      "Close Other Tabs",
      "Close Tabs Below",
    ]);
  });

  it("pops the menu at the point the page names, and at the pointer when it names none", async () => {
    const { add, at, show } = await setup();
    const calendar = add("calendar");
    show(calendar, { x: 8, y: 153 });
    expect(at()).toStrictEqual({ x: 8, y: 153 });
    show(calendar);
    expect(at()).toBeUndefined();
  });

  it("refuses a tab it does not know, showing nothing", async () => {
    const { show, shown } = await setup();
    expect(show("gone")).toMatchObject({ ok: false });
    expect(shown()).toStrictEqual([]);
  });

  it("refuses a tab of a profile other than the selected one, whose rows the sidebar does not show", async () => {
    const { profiles, show, shown } = await setup();
    const other = unwrap(profiles.createProfile("Work"));
    const tab = profiles.state.tabs.find(
      (found) => found.profileId === other.id
    );
    expect(show(tab?.id ?? "")).toStrictEqual({
      error: { kind: "failed", message: "unknownTab" },
      ok: false,
    });
    expect(shown()).toStrictEqual([]);
  });

  it("closes every other closeable tab, leaving the pinned Gmail tab", async () => {
    const { add, click, gmail, left, show } = await setup();
    const calendar = add("calendar");
    add("drive");
    add("docs");
    show(calendar);
    expect(click("closeOthers")).toBeTruthy();
    expect(left()).toStrictEqual([gmail, calendar]);
  });

  it("closes the other tabs in one change, telling the pages once", async () => {
    const { add, changes, click, gmail, left, show } = await setup();
    const calendar = add("calendar");
    add("drive");
    add("docs");
    show(calendar);
    const { pages, stage } = changes;
    click("closeOthers");
    expect({
      left: left(),
      pages: changes.pages - pages,
      stage: changes.stage - stage,
    }).toStrictEqual({ left: [gmail, calendar], pages: 1, stage: 1 });
  });

  it("closes the tabs below the row and only those", async () => {
    const { add, click, gmail, left, show } = await setup();
    const calendar = add("calendar");
    const drive = add("drive");
    add("docs");
    show(drive);
    expect(click("closeBelow")).toBeTruthy();
    expect(left()).toStrictEqual([gmail, calendar, drive]);
  });

  it("copies and opens the address the tab's page stands at, or its stored one while it has no view", async () => {
    const { add, click, clipboard, gmail, paneOf, profiles, shell, show } =
      await setup();
    const calendar = add("calendar");
    show(calendar);
    click("copyUrl");
    const stored = profiles.tab(calendar)?.url;
    await expect
      .poll(() => clipboard.copied)
      .toStrictEqual([{ kind: "text", text: stored }]);
    paneOf(gmail)?.go("https://mail.google.com/mail/u/0/#sent");
    show(gmail);
    click("openInDefaultBrowser");
    expect(shell.opened).toStrictEqual([
      "https://mail.google.com/mail/u/0/#sent",
    ]);
  });

  it("reloads the pane that shows the tab, and nothing for a tab no pane shows", async () => {
    const { add, click, gmail, item, paneOf, show } = await setup();
    show(add("calendar"));
    expect(item("reload")).toMatchObject({ enabled: false });
    show(gmail);
    expect(click("reload")).toBeTruthy();
    expect(paneOf(gmail)?.navigated).toStrictEqual(["reload"]);
  });

  it("focuses the tab and opens the launcher for a split beside it", async () => {
    const { add, click, profiles, show, stage, views } = await setup();
    const calendar = add("calendar");
    unwrap(profiles.focusTab(calendar));
    show(calendar);
    expect(click("splitHorizontal")).toBeTruthy();
    await expect
      .poll(() => views.created.at(-1)?.url)
      .toBe("overlay.html?split=horizontal&kind=launcher");
    expect(stage.snapshot().panes.map((pane) => pane.tabId)).toStrictEqual([
      calendar,
    ]);
  });

  it("takes a tab out of its group", async () => {
    const { add, click, gmail, item, profiles, show } = await setup();
    const calendar = add("calendar");
    unwrap(
      profiles.joinTab(calendar, gmail, {
        orientation: "vertical",
        side: "after",
      })
    );
    show(gmail);
    expect(item("leaveGroup")).toMatchObject({ enabled: false });
    show(calendar);
    expect(click("leaveGroup")).toBeTruthy();
    expect(profiles.currentGroup()?.tabIds).toHaveLength(1);
  });

  it("lets the tab sleep, checked once it may", async () => {
    const { add, click, gmail, item, profiles, show } = await setup();
    const calendar = add("calendar");
    show(calendar);
    expect(item("sleepWhenIdle")).toMatchObject({
      checked: false,
      enabled: true,
    });
    click("sleepWhenIdle");
    expect(profiles.tab(calendar)?.sleeps).toBeTruthy();
    show(calendar);
    expect(item("sleepWhenIdle")).toMatchObject({ checked: true });
    show(gmail);
    expect(item("sleepWhenIdle")).toMatchObject({ enabled: false });
  });
});
