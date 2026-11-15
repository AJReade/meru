import { describe, expect, it } from "vitest";

import type { Group } from "../records/group.ts";
import type { ProfilesState } from "../records/profiles-state.ts";
import type { Tab } from "../records/tab.ts";
import { tabMenuOf } from "./tab-menu.ts";
import type { TabMenuContext, TabMenuItem, TabMenuLabels } from "./tab-menu.ts";

const LABELS: TabMenuLabels = {
  close: "Close",
  closeBelow: "Close Tabs Below",
  closeOthers: "Close Other Tabs",
  copyUrl: "Copy URL",
  leaveGroup: "Leave Group",
  openInDefaultBrowser: "Open in Default Browser",
  reload: "Reload",
  sleepWhenIdle: "Sleep When Idle",
  splitHorizontal: "Split Horizontally",
  splitVertical: "Split Vertically",
};

const tab = (id: string, appId = "drive", sleeps = false): Tab => ({
  appId,
  health: "ok",
  id,
  profileId: "p",
  sleeps,
  title: id,
  url: `https://example.com/${id}`,
  zoom: 1,
});

const single = (tabId: string): Group => ({
  id: `g-${tabId}`,
  layout: { kind: "leaf", paneId: `pane-${tabId}`, tabIds: [tabId] },
  profileId: "p",
  tabIds: [tabId],
});

const pair = (first: string, second: string): Group => ({
  id: `g-${first}-${second}`,
  layout: {
    first: { kind: "leaf", paneId: `pane-${first}`, tabIds: [first] },
    id: "split",
    kind: "split",
    orientation: "vertical",
    ratio: 0.5,
    second: { kind: "leaf", paneId: `pane-${second}`, tabIds: [second] },
  },
  profileId: "p",
  tabIds: [first, second],
});

const gmail = (appId: string) => appId === "gmail";

const context = (overrides: Partial<TabMenuContext> = {}): TabMenuContext => ({
  labels: LABELS,
  shown: new Set(),
  singleInstance: gmail,
  url: "https://example.com/now",
  ...overrides,
});

const menuOf = (
  menuState: Pick<ProfilesState, "tabs" | "groups">,
  tabId: string,
  menuContext: TabMenuContext
) => {
  const found = menuState.tabs.find(({ id }) => id === tabId);
  if (found === undefined) {
    throw new Error(`No tab ${tabId}`);
  }
  return tabMenuOf(menuState, found, menuContext);
};

const items = (menu: readonly TabMenuItem[]) =>
  menu.flatMap((entry) => (entry.kind === "item" ? [entry] : []));

const byId = (menu: readonly TabMenuItem[], id: string) => {
  const found = items(menu).find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`No item ${id}`);
  }
  return found;
};

const enabled = (menu: readonly TabMenuItem[]) =>
  Object.fromEntries(items(menu).map((entry) => [entry.id, entry.enabled]));

// Gmail, then a and b side by side, then c and d each alone.
const tabs = [tab("gmail", "gmail"), tab("a"), tab("b"), tab("c"), tab("d")];
const groups = [single("gmail"), pair("a", "b"), single("c"), single("d")];
const state = { groups, tabs };

describe(tabMenuOf, () => {
  it("lays the items out in 3.x's order, sections apart by a separator", () => {
    expect(
      menuOf(state, "c", context())?.map((entry) =>
        entry.kind === "item" ? entry.label : "-"
      )
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

  it("reloads and splits only a tab a pane shows", () => {
    expect(enabled(menuOf(state, "c", context()))).toMatchObject({
      reload: false,
      splitHorizontal: false,
      splitVertical: false,
    });
    const menu = menuOf(state, "c", context({ shown: new Set(["c"]) }));
    expect(enabled(menu)).toMatchObject({
      reload: true,
      splitHorizontal: true,
      splitVertical: true,
    });
    expect(byId(menu, "splitHorizontal").action).toStrictEqual({
      kind: "split",
      orientation: "horizontal",
    });
  });

  it("leaves a group only from a group of several", () => {
    expect(
      byId(menuOf(state, "a", context()), "leaveGroup").enabled
    ).toBeTruthy();
    expect(
      byId(menuOf(state, "c", context()), "leaveGroup").enabled
    ).toBeFalsy();
  });

  it("keeps a pinned tab in its group, awake and open, while it may still close the others", () => {
    const joined = {
      groups: [pair("gmail", "a"), single("b"), single("c"), single("d")],
      tabs,
    };
    const menu = menuOf(joined, "gmail", context());
    expect(enabled(menu)).toMatchObject({
      close: false,
      closeBelow: true,
      closeOthers: true,
      leaveGroup: false,
      sleepWhenIdle: false,
    });
    expect(byId(menu, "closeOthers").action).toStrictEqual({
      kind: "close",
      tabIds: ["a", "b", "c", "d"],
    });
  });

  it("checks Sleep When Idle on a tab let sleep, a click turning it off", () => {
    const asleep = {
      groups,
      tabs: tabs.map((found) =>
        found.id === "d" ? tab("d", "drive", true) : found
      ),
    };
    const sleeping = byId(menuOf(asleep, "d", context()), "sleepWhenIdle");
    expect(sleeping).toMatchObject({
      action: { kind: "letSleep", sleeps: false },
      checked: true,
      enabled: true,
    });
    expect(byId(menuOf(state, "d", context()), "sleepWhenIdle")).toMatchObject({
      action: { kind: "letSleep", sleeps: true },
      checked: false,
    });
  });

  it("closes the closeable tabs below the row in sidebar order, a group's in its layout's order", () => {
    expect(
      byId(menuOf(state, "a", context()), "closeBelow").action
    ).toStrictEqual({
      kind: "close",
      tabIds: ["b", "c", "d"],
    });
    expect(
      byId(menuOf(state, "c", context()), "closeOthers").action
    ).toStrictEqual({ kind: "close", tabIds: ["a", "b", "d"] });
    expect(
      byId(menuOf(state, "d", context()), "closeBelow").enabled
    ).toBeFalsy();
  });

  it("disables Close on a profile's one tab and Close Other Tabs when every other is pinned", () => {
    const alone = { groups: [single("a")], tabs: [tab("a")] };
    expect(enabled(menuOf(alone, "a", context()))).toMatchObject({
      close: false,
      closeBelow: false,
      closeOthers: false,
    });
    const withGmail = {
      groups: [single("gmail"), single("a")],
      tabs: [tab("gmail", "gmail"), tab("a")],
    };
    expect(enabled(menuOf(withGmail, "a", context()))).toMatchObject({
      close: true,
      closeBelow: false,
      closeOthers: false,
    });
  });

  it("copies the page's address and opens only a web one in the browser", () => {
    const menu = menuOf(state, "c", context());
    expect(byId(menu, "copyUrl").action).toStrictEqual({
      kind: "copyUrl",
      url: "https://example.com/now",
    });
    expect(byId(menu, "openInDefaultBrowser")).toMatchObject({
      action: { kind: "openExternal", url: "https://example.com/now" },
      enabled: true,
    });
    expect(
      byId(
        menuOf(state, "c", context({ url: "about:blank" })),
        "openInDefaultBrowser"
      ).enabled
    ).toBeFalsy();
  });

  it("leaves another profile's tabs alone", () => {
    const other = { ...tab("x"), profileId: "q" };
    const mixed = {
      groups: [...groups, { ...single("x"), profileId: "q" }],
      tabs: [...tabs, other],
    };
    expect(
      byId(menuOf(mixed, "a", context()), "closeOthers").action
    ).toStrictEqual({
      kind: "close",
      tabIds: ["b", "c", "d"],
    });
  });
});
