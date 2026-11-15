import type { TabMenuItemId } from "../records/context-menu.ts";
import type { Orientation } from "../records/layout.ts";
import type { ProfilesState } from "../records/profiles-state.ts";
import type { Tab } from "../records/tab.ts";
import { isWebAddress } from "./context-menu.ts";
import { groupOf, orderedTabs, rowTabs } from "./ordering.ts";
import { isPinned } from "./pinned.ts";
import type { SingleInstance } from "./pinned.ts";
import { canClose } from "./state.ts";

export type TabMenuLabels = Readonly<Record<TabMenuItemId, string>>;

/** What an item of a sidebar row's menu does, to the tab it was opened on unless it names others. */
export type TabMenuAction =
  | { readonly kind: "reload" }
  | { readonly kind: "split"; readonly orientation: Orientation }
  | { readonly kind: "leaveGroup" }
  | { readonly kind: "copyUrl"; readonly url: string }
  | { readonly kind: "openExternal"; readonly url: string }
  | { readonly kind: "letSleep"; readonly sleeps: boolean }
  | { readonly kind: "close"; readonly tabIds: readonly string[] };

interface TabMenuCommand {
  readonly kind: "item";
  readonly id: TabMenuItemId;
  readonly label: string;
  readonly enabled: boolean;
  /** Present on a checkbox, absent on a plain item. */
  readonly checked?: boolean;
  readonly action: TabMenuAction;
}

export type TabMenuItem = TabMenuCommand | { readonly kind: "separator" };

export interface TabMenuContext {
  /** The tabs a pane of some window shows. */
  readonly shown: ReadonlySet<string>;
  /** Where the tab's page stands: its view's address, else its stored one. */
  readonly url: string;
  readonly singleInstance: SingleInstance;
  readonly labels: TabMenuLabels;
}

/** The menu a right-click on the tab's sidebar row opens, in 3.x's order for what the app has; an item that would do nothing is disabled rather than left out, as 3.x shows it. */
export const tabMenuOf = (
  state: Pick<ProfilesState, "tabs" | "groups">,
  tab: Tab,
  { shown, url, singleInstance, labels }: TabMenuContext
): TabMenuItem[] => {
  const tabId = tab.id;
  const closeable = (id: string) => canClose(state, id, singleInstance).ok;
  const order = orderedTabs(
    state.tabs,
    state.groups,
    tab.profileId,
    singleInstance
  )
    .flatMap(rowTabs)
    .map((found) => found.id);
  const others = order.filter((id) => id !== tabId && closeable(id));
  const below = order
    .slice(order.indexOf(tabId) + 1)
    .filter((id) => closeable(id));
  const pinned = isPinned(tab, singleInstance);
  const isShown = shown.has(tabId);
  const grouped = (groupOf(tabId, state.groups)?.tabIds.length ?? 0) > 1;
  const item = (
    id: TabMenuItemId,
    enabled: boolean,
    action: TabMenuAction
  ): TabMenuCommand => ({
    action,
    enabled,
    id,
    kind: "item",
    label: labels[id],
  });
  return [
    item("reload", isShown, { kind: "reload" }),
    item("splitVertical", isShown, {
      kind: "split",
      orientation: "vertical",
    }),
    item("splitHorizontal", isShown, {
      kind: "split",
      orientation: "horizontal",
    }),
    item("leaveGroup", grouped && !pinned, { kind: "leaveGroup" }),
    { kind: "separator" },
    item("copyUrl", true, { kind: "copyUrl", url }),
    item("openInDefaultBrowser", isWebAddress(url), {
      kind: "openExternal",
      url,
    }),
    { kind: "separator" },
    {
      ...item("sleepWhenIdle", !pinned, {
        kind: "letSleep",
        sleeps: !tab.sleeps,
      }),
      checked: tab.sleeps,
    },
    { kind: "separator" },
    item("close", closeable(tabId), { kind: "close", tabIds: [tabId] }),
    item("closeOthers", others.length > 0, { kind: "close", tabIds: others }),
    item("closeBelow", below.length > 0, { kind: "close", tabIds: below }),
  ];
};
