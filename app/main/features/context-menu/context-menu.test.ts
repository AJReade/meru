import path from "node:path";

import { noop } from "es-toolkit";
import { describe, expect, it } from "vitest";

import type { LogPort } from "../../../core/log.ts";
import type { ContextMenuParams } from "../../../core/records/context-menu.ts";
import type { Platform } from "../../../core/records/platform.ts";
import { FakeClipboard } from "../../../test/fakes/clipboard.ts";
import { FakeContextMenu } from "../../../test/fakes/context-menu.ts";
import { FakeDialogs } from "../../../test/fakes/dialogs.ts";
import { FakeDownloads } from "../../../test/fakes/downloads.ts";
import { FakeLog, strictLog } from "../../../test/fakes/log.ts";
import { FakeNotifications } from "../../../test/fakes/notifications.ts";
import { FakeProgress } from "../../../test/fakes/progress.ts";
import { FakeShell } from "../../../test/fakes/shell.ts";
import { testApp, testStages } from "../../testing.ts";
import { Downloads } from "../downloads/index.ts";
import { Links } from "../links/index.ts";
import { ContextMenu } from "./index.ts";

const MAILBOX = "https://mail.google.com/mail/u/0";

const NOTHING: ContextMenuParams = {
  dictionarySuggestions: [],
  editFlags: {
    canCopy: true,
    canCut: true,
    canPaste: true,
    canSelectAll: true,
  },
  isEditable: false,
  linkText: "",
  linkUrl: "",
  mediaType: "none",
  misspelledWord: "",
  pageUrl: `${MAILBOX}/#inbox`,
  selectionText: "",
  srcUrl: "",
  x: 4,
  y: 8,
};

/** Lets the feature's awaits on the fakes settle. */
const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each turn lets one more await resolve
    await Promise.resolve();
  }
};

const setup = async ({
  development = false,
  log = strictLog,
  platform = "darwin",
}: {
  development?: boolean;
  log?: LogPort;
  platform?: Platform;
} = {}) => {
  const app = await testApp({});
  const { profiles, settings } = app;
  const port = new FakeContextMenu();
  const clipboard = new FakeClipboard();
  const shell = new FakeShell();
  const downloadPort = new FakeDownloads();
  const { open, stages, views } = testStages(app, {
    content: (tab) =>
      contextMenu.page(
        { arguments: [], attach: () => noop, preload: "" },
        tab.appId
      ),
    onOpen: (tabId, url, disposition) => links.open(tabId, url, disposition),
  });
  const links = new Links({
    log: strictLog,
    profiles,
    settings,
    shell,
    stages,
  });
  const downloads = new Downloads({
    clock: app.clock,
    closeTab: noop,
    commands: app.commands,
    defaultDirectory: path.join(path.sep, "Downloads"),
    dialogs: new FakeDialogs(),
    downloads: downloadPort,
    fs: app.fs,
    lifecycle: app.lifecycle,
    log: strictLog,
    notifications: new FakeNotifications(),
    overlayUrl: (kind) => `overlay.html?kind=${kind}`,
    pendingDirectory: path.join(path.sep, "pending"),
    platform,
    progress: new FakeProgress(),
    registrar: app.registrar,
    settings,
    shell,
    stages,
  });
  await downloads.open();
  downloads.start();
  const contextMenu = new ContextMenu({
    clipboard,
    contextMenu: port,
    development,
    downloads,
    links,
    log,
    mailbox: MAILBOX,
    platform,
  });
  open();
  const [pane] = views.created;
  if (pane === undefined) {
    throw new Error("The window shows no pane");
  }
  const rightClick = (params: Partial<ContextMenuParams>) =>
    port.rightClick(pane.contentsId, { ...NOTHING, ...params });
  const labels = () =>
    (port.shown.get(pane.contentsId) ?? []).map((entry) =>
      entry.kind === "separator" ? "-" : entry.label
    );
  const click = (id: string) => port.click(pane.contentsId, id);
  return {
    clipboard,
    click,
    contextMenu,
    downloadPort,
    labels,
    pane,
    port,
    profiles,
    rightClick,
    shell,
    views,
  };
};

describe(ContextMenu, () => {
  it("shows the menu on a right-click in a pane, with 3.x's labels in 3.x's order", async () => {
    const { labels, rightClick } = await setup({ development: true });
    rightClick({
      linkText: "Example",
      linkUrl: "https://example.com/",
      selectionText: "Example",
    });
    expect(labels()).toStrictEqual([
      "&Search with Google",
      "-",
      "&Copy",
      "-",
      "Copy link addr&ess",
      "Open in default browser",
      "-",
      "Inspect element",
    ]);
  });

  it("names the selection Look up shows on macOS", async () => {
    const { labels, rightClick } = await setup();
    rightClick({ selectionText: "Fish & Chips" });
    expect(labels()[0]).toBe("Look up “Fish && Chips”");
  });

  it("opens a link and searches Google in the default browser, through the links feature", async () => {
    const { click, rightClick, shell } = await setup();
    rightClick({ linkUrl: "https://example.com/", selectionText: "Meru" });
    click("openInDefaultBrowser");
    click("searchWithGoogle");
    await settle();
    expect(shell.opened).toStrictEqual([
      "https://example.com/",
      "https://www.google.com/search?q=Meru",
    ]);
  });

  it("copies a link as a bookmark, an email address and a message's link as text", async () => {
    const { click, clipboard, rightClick } = await setup();
    rightClick({ linkText: "Example", linkUrl: "https://example.com/" });
    click("copyLink");
    rightClick({ linkUrl: "mailto:someone@example.com" });
    click("copyEmailAddress");
    rightClick({
      pageUrl: `${MAILBOX}/#inbox/FMfcgzQbfLZkzXqGvNbdgmRkhHPCWvLb`,
    });
    click("copyMessageLink");
    await settle();
    expect(clipboard.copied).toStrictEqual([
      { kind: "bookmark", title: "Example", url: "https://example.com/" },
      { kind: "text", text: "someone@example.com" },
      {
        kind: "text",
        text: `${MAILBOX}/#inbox/FMfcgzQbfLZkzXqGvNbdgmRkhHPCWvLb`,
      },
    ]);
  });

  it("writes a refused copy down as a warning", async () => {
    const log = new FakeLog();
    const { click, clipboard, rightClick } = await setup({
      log: log.scoped("contextMenu"),
    });
    clipboard.refusing = true;
    rightClick({ linkUrl: "https://example.com/" });
    click("copyLink");
    await settle();
    expect(log.at("warn")).toStrictEqual(["The clipboard refused a copy"]);
  });

  it("logs a menu it could not build and an item that threw, rather than throwing out of Electron's event", async () => {
    const log = new FakeLog();
    const { click, pane, port, rightClick } = await setup({
      log: log.scoped("contextMenu"),
    });
    rightClick({ isEditable: true });
    port.failing = true;
    const clicked = click("paste");
    const unreadable: ContextMenuParams = {
      ...NOTHING,
      get misspelledWord(): string {
        throw new Error("Unreadable");
      },
    };
    const built = port.rightClick(pane.contentsId, unreadable);
    expect([built, clicked, log.at("error")]).toStrictEqual([
      true,
      true,
      ["A context menu item failed", "The context menu could not be shown"],
    ]);
  });

  it("saves an image through the downloads, which ask where", async () => {
    const { click, downloadPort, pane, rightClick } = await setup();
    rightClick({ mediaType: "image", srcUrl: "https://example.com/a.png" });
    click("saveImageAs");
    expect(downloadPort.requested).toStrictEqual([
      { contentsId: pane.contentsId, url: "https://example.com/a.png" },
    ]);
  });

  it("acts on the page it was opened over for an edit, a spelling, an image and Inspect element", async () => {
    const { click, pane, port, rightClick } = await setup({
      development: true,
      platform: "linux",
    });
    rightClick({
      dictionarySuggestions: ["Meru"],
      isEditable: true,
      mediaType: "image",
      misspelledWord: "Mreu",
      selectionText: "Mreu",
      srcUrl: "https://example.com/a.png",
    });
    for (const id of [
      "suggestion",
      "learnSpelling",
      "paste",
      "copyImage",
      "inspectElement",
    ]) {
      click(id);
    }
    expect(port.acted).toStrictEqual(
      [
        { kind: "replaceMisspelling", word: "Meru" },
        { kind: "learnSpelling", word: "Mreu" },
        { command: "paste", kind: "edit" },
        { kind: "copyImageAt", x: 4, y: 8 },
        { kind: "inspect", x: 4, y: 8 },
      ].map((action) => ({ action, contentsId: pane.contentsId }))
    );
  });

  it("copies a pane's own address and opens it in the browser, in every pane but Gmail's", async () => {
    const { clipboard, labels, port, profiles, rightClick, shell, views } =
      await setup();
    rightClick({ pageUrl: `${MAILBOX}/#inbox` });
    const gmail = labels();
    const opened = profiles.openTab(profiles.selected().id, "calendar");
    if (!opened.ok) {
      throw new Error("The tab did not open");
    }
    profiles.focusTab(opened.value.id);
    const [, calendar] = views.created;
    if (calendar === undefined) {
      throw new Error("The calendar tab has no view");
    }
    const pageUrl = "https://calendar.google.com/calendar/u/0/r";
    port.rightClick(calendar.contentsId, { ...NOTHING, pageUrl });
    port.click(calendar.contentsId, "copyUrl");
    port.click(calendar.contentsId, "openPageInDefaultBrowser");
    await settle();
    expect([
      gmail,
      port.shown
        .get(calendar.contentsId)
        ?.map((entry) => (entry.kind === "separator" ? "-" : entry.label)),
      clipboard.copied,
      shell.opened,
    ]).toStrictEqual([
      [],
      ["Copy URL", "Open in default browser"],
      [{ kind: "text", text: pageUrl }],
      [pageUrl],
    ]);
  });

  it("stops hearing a pane's page once its tab closes and its view goes", async () => {
    const { port, profiles, views } = await setup();
    const opened = profiles.openTab(profiles.selected().id, "calendar");
    if (!opened.ok) {
      throw new Error("The tab did not open");
    }
    profiles.focusTab(opened.value.id);
    const [, calendar] = views.created;
    if (calendar === undefined) {
      throw new Error("The calendar tab has no view");
    }
    const heard = () => port.rightClick(calendar.contentsId, NOTHING);
    const before = heard();
    profiles.closeTab(opened.value.id);
    expect([before, heard()]).toStrictEqual([true, false]);
  });

  it("shows the menu over a pop-out it was attached to", async () => {
    const { contextMenu, port } = await setup();
    contextMenu.attach(5555);
    port.rightClick(5555, { ...NOTHING, selectionText: "Meru" });
    expect(port.shown.get(5555)?.length).toBeGreaterThan(0);
  });
});
