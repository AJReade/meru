import path from "node:path";

import { chromeInsets } from "../core/engines/chrome.ts";
import { GMAIL_URL } from "../core/engines/inbox.ts";
import { GOOGLE_SIGN_IN } from "../core/engines/links.ts";
import { ENTITLEMENT_URL } from "../core/entitlement/api.ts";
import { acceptedKeys, importKeys } from "../core/entitlement/keys.ts";
import { AppEvents } from "../core/events.ts";
import { themeOf } from "../core/ports.ts";
import type { Tab } from "../core/records/tab.ts";
import { allowlist } from "../shared/channels/define.ts";
import { surfaces } from "../shared/channels/surfaces.ts";
import type { OverlayKind } from "../shared/channels/surfaces.ts";
import { commands as allCommands } from "../shared/commands/registry.ts";
import { Appearance } from "./features/appearance/index.ts";
import { Badge } from "./features/badge/index.ts";
import { ContextMenu } from "./features/context-menu/index.ts";
import { Downloads } from "./features/downloads/index.ts";
import { Entitlement } from "./features/entitlement/index.ts";
import {
  GOOGLE_FAVICONS,
  Gmail,
  USER_STYLES_FILE,
} from "./features/gmail/index.ts";
import { Google } from "./features/google/index.ts";
import { Inbox } from "./features/inbox/index.ts";
import { Launcher } from "./features/launcher/index.ts";
import { Links } from "./features/links/index.ts";
import { Notifications } from "./features/notifications/index.ts";
import { Profiles } from "./features/profiles/index.ts";
import { SettingsStore } from "./features/settings/index.ts";
import { SettingsWindow } from "./features/settings/window.ts";
import { Sidebars } from "./features/sidebar/index.ts";
import { TabMenu } from "./features/sidebar/tab-menu.ts";
import { Sleep } from "./features/sleep/index.ts";
import { Stages } from "./features/stage/index.ts";
import { Tray } from "./features/tray/index.ts";
import { Updater } from "./features/updater/index.ts";
import { Windows } from "./features/windows/index.ts";
import { listenIpc } from "./platform/ipc.ts";
import { createFileLog } from "./platform/log.ts";
import type { FileLog } from "./platform/log.ts";
import {
  applicationAccelerators,
  setApplicationMenu,
} from "./platform/menu.ts";
import {
  createElectronEntitlementApi,
  createElectronPorts,
} from "./platform/ports.ts";
import { createElectronUpdater } from "./platform/updater.ts";
import {
  isPackaged,
  placeUserData,
  systemDownloadsDir,
  userDataDir,
} from "./platform/user-data.ts";
import { CommandDispatcher } from "./shell/commands.ts";
import {
  exposeE2e,
  recordingClipboard,
  recordingContextMenu,
  recordingDesktop,
  RecordingShell,
} from "./shell/e2e.ts";
import { logFailures } from "./shell/failures.ts";
import { IpcDispatcher } from "./shell/ipc.ts";
import { ShortcutKeys } from "./shell/keys.ts";
import { exposeMeasure } from "./shell/measure.ts";
import { ApplicationMenu } from "./shell/menu.ts";
import { isPageUrl, MainWindow, pageUrl } from "./shell/window.ts";
import type { PageOptions } from "./shell/window.ts";

// Held outside start() so a failure to start can still be written and the file flushed.
let fileLog: FileLog | undefined;

// The stand-in mailbox has a stand-in sign-in beside it, since a test cannot serve accounts.google.com.
const signInOf = (gmailOverride: string | undefined): string =>
  gmailOverride === undefined
    ? GOOGLE_SIGN_IN
    : new URL("/signin", gmailOverride).href;

// The stand-in mailbox serves the senders' icons too, since a test cannot reach Google's.
const faviconsOf = (gmailOverride: string | undefined): string =>
  gmailOverride === undefined
    ? GOOGLE_FAVICONS
    : new URL("/favicons", gmailOverride).href;

const gmailTabOf = (
  profiles: Profiles,
  profileId: string
): string | undefined =>
  profiles.state.tabs.find(
    (tab) => tab.profileId === profileId && tab.appId === "gmail"
  )?.id;

// The suite's panes show the stand-ins they are given, the Gmail one its mailbox and every other Google app one page between them, and nothing without.
const testPaneUrl =
  (gmailOverride: string | undefined, googleOverride: string | undefined) =>
  (tab: Tab): string => {
    if (tab.appId === "gmail") {
      return gmailOverride === undefined ? "about:blank" : `${gmailOverride}/`;
    }
    return googleOverride ?? "about:blank";
  };

// The suite finds a download in its own user data rather than in the Downloads folder of whoever runs it.
const downloadsDirectory = (e2e: boolean): string =>
  e2e ? path.join(userDataDir(), "Downloads") : systemDownloadsDir();

/** Closes the tab whose view shows the page `contentsId`. */
const closeTabOf =
  (stages: Pick<Stages, "all">, profiles: Pick<Profiles, "closeTab">) =>
  (contentsId: number): void => {
    const tab = stages.all
      .flatMap((stage) => stage.kept())
      .find(({ view }) => view.contentsId === contentsId)?.tab;
    if (tab !== undefined) {
      profiles.closeTab(tab.id);
    }
  };

const start = async () => {
  const dist = path.join(import.meta.dirname, "..");
  placeUserData(path.join(dist, "..", ".."));
  const packaged = isPackaged();
  const log = createFileLog({
    directory: path.join(userDataDir(), "logs"),
    minimum: packaged ? "info" : "debug",
    mirror: !packaged,
  });
  const ports = createElectronPorts(log.scoped("views"));
  fileLog = log;
  const pages: PageOptions = {
    devServer: process.env.MERU_RENDERER_URL,
    dir: path.join(dist, "renderer"),
    platform: ports.lifecycle.platform,
    theme: () => themeOf(ports.theme),
  };
  logFailures({
    clock: ports.clock,
    lifecycle: ports.lifecycle,
    log: log.scoped("app"),
    ownPage: (url) => isPageUrl(pages, url),
  });
  ports.lifecycle.onQuit(async () => {
    await log.flush();
  });
  // An installed app never takes the test switches from its environment, so no user can turn on the inspector or blank panes by setting a variable.
  const e2e = !ports.lifecycle.packaged && process.env.MERU_E2E === "1";
  const measure = !ports.lifecycle.packaged && process.env.MERU_MEASURE === "1";

  ports.lifecycle.onWindowAllClosed(() => {
    ports.lifecycle.quit();
  });
  await ports.lifecycle.whenReady();
  if (process.env.MERU_TEST_BACKGROUND === "1") {
    ports.lifecycle.prohibitActivation();
  }

  const ipcLog = log.scoped("ipc");
  const dispatcher = new IpcDispatcher({
    log: ipcLog,
    transport: ports.ipc,
  });
  listenIpc(allowlist(...surfaces), (contentsId, channel, payload) => {
    const result = dispatcher.dispatch(contentsId, channel, payload);
    if (!result.ok) {
      ipcLog.warn("A request was refused", {
        channel,
        kind: result.error.kind,
        detail: result.error.message,
      });
    }
    return result;
  });

  const events = new AppEvents();
  const entitlement = new Entitlement({
    api: createElectronEntitlementApi(
      process.env.MERU_ENTITLEMENT_URL ?? ENTITLEMENT_URL
    ),
    lifecycle: ports.lifecycle,
    clock: ports.clock,
    events,
    fs: ports.fs,
    ids: ports.ids,
    keys: await importKeys(
      crypto.subtle,
      acceptedKeys(ports.lifecycle.packaged)
    ),
    online: ports.online,
    power: ports.power,
    log: log.scoped("entitlement"),
    subtle: crypto.subtle,
  });
  await entitlement.open();

  const settings = new SettingsStore({
    lifecycle: ports.lifecycle,
    clock: ports.clock,
    fs: ports.fs,
    log: log.scoped("settings"),
    registrar: dispatcher,
    // Only a run from the repository follows hand edits; an installed app learns of a change from the code that made it.
    watchFile: !ports.lifecycle.packaged,
    entitlement: () => entitlement.current(),
    events,
  });
  await settings.open();
  settings.start();

  const commands = new CommandDispatcher();
  commands.start(dispatcher);

  const profiles = new Profiles({
    asleep: () => sleep.asleep(),
    commands,
    lifecycle: ports.lifecycle,
    clock: ports.clock,
    entitlement: () => entitlement.current(),
    events,
    fs: ports.fs,
    ids: ports.ids,
    log: log.scoped("profiles"),
    registrar: dispatcher,
    sessions: ports.sessions,
    settings,
  });
  await profiles.open();
  profiles.start();

  const windows = new Windows({
    lifecycle: ports.lifecycle,
    clock: ports.clock,
    displays: ports.displays,
    events,
    fs: ports.fs,
    ids: ports.ids,
    log: log.scoped("windows"),
    profiles,
  });
  await windows.open();
  windows.start();

  const keys = new ShortcutKeys({
    commands: allCommands,
    dispatcher: commands,
    platform: ports.lifecycle.platform,
    log: log.scoped("keys"),
    settings,
  });
  keys.start();

  const sidebars = new Sidebars({
    commands,
    events,
    profiles,
    registrar: dispatcher,
    settings,
  });
  sidebars.start();

  // The suite asserts on what the app would put on the desktop and puts nothing there.
  const recorded = recordingDesktop();
  const desktop = e2e ? recorded : ports;
  // The end-to-end suite asserts on the links that would leave for the browser and the files it would open, and opens none.
  const externalLinks = new RecordingShell();
  const shell = e2e ? externalLinks : ports.shell;
  // A run from the repository can read a stand-in feed; the suite and a measure read none unless given one, so no test run asks Google.
  const gmailOverride = ports.lifecycle.packaged
    ? undefined
    : process.env.MERU_GMAIL_URL;
  const mailbox = gmailOverride ?? GMAIL_URL;
  const inbox = new Inbox({
    clock: ports.clock,
    events,
    gmailUrl: mailbox,
    log: log.scoped("inbox"),
    online: ports.online,
    power: ports.power,
    profiles,
    sessions: ports.sessions,
    settings,
  });
  new Badge({ badge: desktop.badge, events, inbox, settings }).start();
  if (gmailOverride !== undefined || !(e2e || measure)) {
    inbox.start();
  }
  // Gmail moves between its own views by the fragment, so the page takes an address under the mailbox without a reload when it can.
  const openMessage = async (tabId: string, url: string) => {
    if (!(await gmail.navigate(tabId, url))) {
      stages.load(tabId, url);
    }
  };
  const gmail = new Gmail({
    clock: ports.clock,
    commands,
    entitlement: () => entitlement.current(),
    events,
    fs: ports.fs,
    favicons: faviconsOf(gmailOverride),
    log: log.scoped("gmail"),
    mailbox,
    online: ports.online,
    power: ports.power,
    readFeed: (profileId) => {
      inbox.nudge(profileId);
    },
    openMailbox: (profileId, hash) => {
      const tab = gmailTabOf(profiles, profileId);
      if (tab !== undefined) {
        profiles.focusTab(tab);
        void openMessage(tab, `${mailbox}/${hash}`);
      }
    },
    preload: path.join(dist, "preload", "gmail.cjs"),
    profiles,
    registrar: dispatcher,
    settings,
    shell,
    signIn: signInOf(gmailOverride),
    userStylesPath: path.join(userDataDir(), USER_STYLES_FILE),
    // A tab whose view some stage keeps loads the mailbox at once; one no window shows has its next view start there.
    wake: (tabId) => {
      stages.load(tabId, `${gmailOverride ?? GMAIL_URL}/`);
    },
  });
  await gmail.start();
  const google = new Google({
    commands,
    events,
    globalShortcuts: desktop.globalShortcuts,
    lifecycle: ports.lifecycle,
    log: log.scoped("google"),
    platform: ports.lifecycle.platform,
    preload: path.join(dist, "preload", "google.cjs"),
    registrar: dispatcher,
    settings,
  });
  google.start();
  // A native menu cannot be read, and would wait on the desktop the suite shares, so the suite reads the one the app would show and clicks it here.
  const recordedMenus = recordingContextMenu(ports.contextMenu);
  // The suite copies through the app's menus, which would otherwise write the clipboard of the Mac it runs on.
  const recordedClipboard = recordingClipboard();
  const menuPorts = {
    clipboard: e2e ? recordedClipboard : ports.clipboard,
    contextMenu: e2e ? recordedMenus : ports.contextMenu,
  };
  // Built ahead of the stages, whose panes and pop-outs it attaches to; the downloads and the links come after the stages they need, and the menu reaches them only on a click.
  const contextMenu = new ContextMenu({
    ...menuPorts,
    development: !ports.lifecycle.packaged,
    downloads: {
      saveAs: (contentsId, url) => {
        downloads.saveAs(contentsId, url);
      },
    },
    links: {
      openExternal: (url) => {
        links.openExternal(url);
      },
    },
    log: log.scoped("contextMenu"),
    mailbox,
    platform: ports.lifecycle.platform,
  });
  const overlayUrl = (
    kind: OverlayKind,
    query: Readonly<Record<string, string>>
  ): string => pageUrl(pages, "overlay.html", { ...query, kind });
  const stages = new Stages({
    commands,
    content: (tab) =>
      contextMenu.page(
        tab.appId === "gmail" ? gmail.page(tab) : google.page(tab),
        tab.appId
      ),
    ...(e2e
      ? {
          paneUrl: testPaneUrl(gmailOverride, process.env.MERU_GOOGLE_URL),
        }
      : {}),
    historyOf: (tabId) => sleep.historyOf(tabId),
    onOpen: (tabId, url, disposition) => links.open(tabId, url, disposition),
    onPopOut: (tabId, url, disposition) =>
      links.popOut(tabId, url, disposition),
    onPopup: (url) => links.popup(url),
    onSplitRequested: (windowId, orientation) => {
      launcher.open(windowId, orientation);
    },
    dragPreload: path.join(dist, "preload", "drag.cjs"),
    overlayPreload: path.join(dist, "preload", "renderer.cjs"),
    events,
    insets: () => chromeInsets(sidebars.current()),
    log: log.scoped("stage"),
    profiles,
    registrar: dispatcher,
    settings,
    keys,
    // The chrome is neutral grey, so the drop takes the colour that marks the tab's profile, which stands out on a page.
    tabDragUrl: (tab) => {
      const accent = profiles.profile(tab.profileId)?.color;
      return overlayUrl("tabDrag", {
        appId: tab.appId,
        tabId: tab.id,
        ...(accent === undefined ? {} : { accent }),
        ...(tab.title === null ? {} : { title: tab.title }),
      });
    },
    views: ports.views,
  });
  stages.start();
  // The end-to-end suite shortens a minute of `sleep.afterMinutes` to watch a tab fall asleep.
  const sleepMinute = Number(process.env.MERU_SLEEP_MINUTE);
  const sleep = new Sleep({
    clock: ports.clock,
    windowId: () => window.contentsId(),
    commands,
    events,
    ...(ports.lifecycle.packaged || !(sleepMinute > 0)
      ? {}
      : { minute: sleepMinute }),
    profiles,
    settings,
    stages,
  });
  sleep.start();
  const links = new Links({
    log: log.scoped("links"),
    popOuts: {
      mailbox,
      opened: (window, profileId) => {
        gmail.attachPopOut(window, profileId);
        contextMenu.attach(window.contentsId);
      },
    },
    profiles,
    settings,
    shell,
    stages,
  });
  const launcher = new Launcher({
    commands,
    overlayUrl,
    registrar: dispatcher,
    stages,
  });
  launcher.start();
  new TabMenu({
    ...menuPorts,
    links,
    log: log.scoped("tabMenu"),
    profiles,
    registrar: dispatcher,
    split: (windowId, orientation) => {
      launcher.open(windowId, orientation);
    },
    stages,
  }).start();
  const downloads = new Downloads({
    clock: ports.clock,
    closeTab: closeTabOf(stages, profiles),
    commands,
    defaultDirectory: downloadsDirectory(e2e),
    dialogs: ports.dialogs,
    downloads: ports.downloads,
    fs: ports.fs,
    lifecycle: ports.lifecycle,
    log: log.scoped("downloads"),
    notifications: desktop.notifications,
    overlayUrl,
    pendingDirectory: path.join(userDataDir(), "Downloads in progress"),
    platform: ports.lifecycle.platform,
    progress: desktop.progress,
    registrar: dispatcher,
    settings,
    shell,
    stages,
  });
  await downloads.open();
  downloads.start();

  const updater = new Updater({
    lifecycle: ports.lifecycle,
    clock: ports.clock,
    commands,
    events,
    log: log.scoped("updater"),
    registrar: dispatcher,
    settings,
    updater: createElectronUpdater(),
  });
  updater.attach();

  if (measure) {
    exposeMeasure({ stages });
  }
  if (e2e) {
    exposeE2e({
      accelerators: applicationAccelerators,
      clipboard: recordedClipboard,
      contextMenu: recordedMenus,
      desktop: recorded,
      entitlement,
      external: externalLinks,
      sessions: ports.sessions,
      stages,
      updater,
    });
  }

  const background = process.env.MERU_BACKGROUND === "1";
  const linuxControls = settings.get("window.linuxControls");
  const settingsWindow = new SettingsWindow({
    background,
    commands,
    linuxControls,
    log: log.scoped("settings"),
    ports,
    preload: path.join(dist, "preload", "renderer.cjs"),
    registrar: dispatcher,
    url: () => pageUrl(pages, "settings.html"),
  });
  settingsWindow.start();

  const window = new MainWindow({
    background,
    bounds: windows.mainBounds(),
    linuxControls,
    onCreated: (created) => {
      keys.attach(created, created.contentsId);
      windows.attachMain(created);
      stages.open(created, () => windows.mainGroupId());
    },
    ports,
    pages,
    preload: path.join(dist, "preload", "renderer.cjs"),
    registrar: dispatcher,
    surface: "chrome",
  });
  new ApplicationMenu({
    apply: setApplicationMenu,
    commands: allCommands,
    dispatcher: commands,
    events,
    platform: ports.lifecycle.platform,
    log: log.scoped("menu"),
    settings,
    windowId: () => window.contentsId(),
  }).start();
  new Appearance({
    registrar: dispatcher,
    theme: ports.theme,
    windows: [window, settingsWindow],
  }).start();
  const { platform } = ports.lifecycle;
  new Notifications({
    clock: ports.clock,
    act: (tabId, messageId, action) => {
      void gmail.act(tabId, messageId, action);
    },
    events,
    inbox,
    gmailUrl: mailbox,
    load: (tabId, url) => {
      void openMessage(tabId, url);
    },
    notifications: desktop.notifications,
    platform,
    profiles,
    settings,
    showWindow: () => {
      window.reveal();
    },
  }).start();
  new Tray({
    events,
    inbox,
    platform,
    profiles,
    settings,
    theme: ports.theme,
    tray: desktop.tray,
    window,
  }).start();
  await window.show();
  entitlement.start();
  updater.start();
};

// Not awaited: Electron holds back "ready" until an ES module entry finishes evaluating, so a top-level await on whenReady() never settles.
const main = async () => {
  try {
    await start();
  } catch (error) {
    // The log may not exist yet, and a start that got nowhere leaves nothing else to read.
    console.error(error);
    fileLog?.scoped("main").error("The app could not start", { error });
    await fileLog?.flush();
    process.exit(1);
  }
};

void main();
