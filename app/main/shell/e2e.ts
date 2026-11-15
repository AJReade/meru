import { z } from "zod";

import type { DownloadProgress } from "../../core/engines/downloads.ts";
import type {
  BadgePort,
  ClipboardPort,
  ContextMenuPort,
  GlobalShortcutPort,
  NotificationPort,
  NotificationSpec,
  ProgressPort,
  SessionPort,
  ShellPort,
  TrayPort,
  TraySpec,
} from "../../core/ports.ts";
import type { ContextMenuEntry } from "../../core/records/context-menu.ts";
import { entitlementSchema } from "../../core/records/entitlement.ts";
import { rectSchema } from "../../core/records/rect.ts";
import { updateStateSchema } from "../../core/records/update.ts";
import { commandIdSchema } from "../../shared/commands/registry.ts";
import type { CommandId } from "../../shared/commands/registry.ts";
import type { Entitlement } from "../features/entitlement/index.ts";
import type { Stages } from "../features/stage/index.ts";
import type { Updater } from "../features/updater/index.ts";

/** The global under which a run with MERU_E2E=1 leaves its inspector, which the end-to-end suite calls through Playwright's `app.evaluate`, so no page is allowed a channel only a test needs. */
export const E2E_GLOBAL = "meruE2e";

/** The global under which the same run leaves the sessions' `fetchText`, answering its response as JSON or rejecting as it does, so the suite can read through the real network stack against a loopback server. */
export const E2E_FETCH = "meruE2eFetch";

/** The global under which the same run leaves a click on the notification at the index it is given, as the suite's stand-in for a click in the notification centre. */
export const E2E_CLICK_NOTIFICATION = "meruE2eClickNotification";

/** The global under which the same run leaves a press of a button on the notification at the index it is given, as the suite's stand-in for pressing one in the notification centre. */
export const E2E_ACT_NOTIFICATION = "meruE2eActNotification";

/** The global under which the same run leaves a click on the item at the index it is given of the context menu built last, as the suite's stand-in for a click in the native menu. */
export const E2E_CLICK_CONTEXT_MENU = "meruE2eClickContextMenu";

export const e2eSnapshotSchema = z.object({
  /** The context menu built last, as the app would have shown it. */
  contextMenu: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        checked: z.boolean().optional(),
        enabled: z.boolean(),
        id: z.string(),
        kind: z.literal("item"),
        label: z.string(),
      }),
      z.object({ kind: z.literal("separator") }),
      z.object({
        kind: z.literal("share"),
        label: z.string(),
        url: z.string(),
      }),
    ])
  ),
  /** Everything the app put on the clipboard, in order. */
  clipboard: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({
        kind: z.literal("bookmark"),
        title: z.string(),
        url: z.string(),
      }),
    ])
  ),
  /** Every address a link sent to the browser, in order. */
  external: z.array(z.string()),
  /** Every file opened in its application, in order. */
  files: z.array(z.string()),
  /** Every file shown in its folder, in order. */
  revealed: z.array(z.string()),
  /** What the app's icon shows of the downloads under way. */
  progress: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("indeterminate") }),
    z.object({ kind: z.literal("fraction"), value: z.number() }),
  ]),
  /** The entitlement main derived, which no page reads. */
  entitlement: entitlementSchema,
  /** The updater's state, which only the settings window reads. */
  update: updateStateSchema,
  /** The count on the app's icon. */
  badge: z.number(),
  /** Every notification shown, in order. */
  notifications: z.array(
    z.object({
      actions: z.array(z.string()).optional(),
      body: z.string().optional(),
      silent: z.boolean(),
      subtitle: z.string().optional(),
      title: z.string(),
    })
  ),
  /** The accelerators the app would hold system-wide, in the order it took them. */
  shortcuts: z.array(z.string()),
  /** What the tray's menu lists while its icon is up. */
  tray: z.array(z.string()).nullable(),
  /** The accelerator of each command in the application menu. */
  menu: z.partialRecord(commandIdSchema, z.string().nullable()),
  /** Bounds Electron reports for each child view of the first window, bottom first. */
  views: z.array(rectSchema),
  /** Each pane, in layout order: its tab, the id of the web contents showing it and its zoom factor. */
  panes: z.array(
    z.object({ contentsId: z.number(), tabId: z.string(), zoom: z.number() })
  ),
});

type E2eSnapshot = z.infer<typeof e2eSnapshotSchema>;

/** The shell of a run under MERU_E2E: it keeps each address it was asked to open in the browser and opens none. */
export class RecordingShell implements ShellPort {
  readonly opened: string[] = [];
  readonly files: string[] = [];
  readonly revealed: string[] = [];

  readonly openExternal = async (url: string) => {
    this.opened.push(url);
    await Promise.resolve();
  };

  readonly openPath = async (path: string) => {
    this.files.push(path);
    await Promise.resolve();
  };

  readonly showItemInFolder = (path: string) => {
    this.revealed.push(path);
  };
}

/** The clipboard of a run under MERU_E2E: it keeps what it was asked to write and leaves the system's, which is the maintainer's, alone. */
interface RecordingClipboard extends ClipboardPort {
  readonly written: () => E2eSnapshot["clipboard"];
}

export const recordingClipboard = (): RecordingClipboard => {
  const written: E2eSnapshot["clipboard"] = [];
  return {
    writeBookmark: async (title, url) => {
      written.push({ kind: "bookmark", title, url });
      await Promise.resolve();
    },
    writeText: async (text) => {
      written.push({ kind: "text", text });
      await Promise.resolve();
    },
    written: () => [...written],
  };
};

/** The context menus of a run under MERU_E2E: it hears the pages and acts on them as the platform's does, but keeps the menu it was asked to show rather than showing it. */
interface RecordingContextMenu extends ContextMenuPort {
  readonly shown: () => readonly ContextMenuEntry[];
  /** Clicks the item at `index` of the menu shown last, as the native menu would; nothing for a disabled one. */
  readonly click: (index: number) => void;
}

export const recordingContextMenu = (
  platform: ContextMenuPort
): RecordingContextMenu => {
  let shown: readonly ContextMenuEntry[] = [];
  return {
    act: platform.act,
    click: (index) => {
      const entry = shown[index];
      if (entry?.kind === "item" && entry.enabled) {
        entry.run();
      }
    },
    listen: platform.listen,
    popup: (_contentsId, entries) => {
      shown = entries;
    },
    shown: () => shown,
  };
};

/** The app icon, notifications and tray of a run under MERU_E2E: each keeps what it was asked to show and shows nothing on the desktop the suite shares. */
interface RecordingDesktop {
  readonly badge: BadgePort;
  readonly globalShortcuts: GlobalShortcutPort;
  readonly notifications: NotificationPort;
  readonly tray: TrayPort;
  readonly progress: ProgressPort;
  /** Clicks the notification shown `index`th, as the notification centre would. */
  readonly click: (index: number) => void;
  /** Presses the button at `action` on the notification shown `index`th. */
  readonly act: (index: number, action: number) => void;
  readonly read: () => {
    readonly badge: number;
    readonly shortcuts: readonly string[];
    readonly notifications: readonly NotificationSpec[];
    readonly tray: TraySpec | undefined;
    readonly progress: DownloadProgress;
  };
}

export const recordingDesktop = (): RecordingDesktop => {
  let badge = 0;
  const notifications: {
    spec: NotificationSpec;
    click: () => void;
    act: ((action: number) => void) | undefined;
  }[] = [];
  const shortcuts = new Set<string>();
  let tray: TraySpec | undefined;
  let progress: DownloadProgress = { kind: "none" };
  return {
    act: (index, action) => {
      notifications[index]?.act?.(action);
    },
    badge: {
      set: (total) => {
        badge = total;
      },
    },
    click: (index) => {
      notifications[index]?.click();
    },
    globalShortcuts: {
      register: (accelerator) => {
        shortcuts.add(accelerator);
        return true;
      },
      unregister: (accelerator) => {
        shortcuts.delete(accelerator);
      },
    },
    notifications: {
      show: (spec, click, act) => {
        notifications.push({ act, click, spec });
      },
    },
    progress: {
      set: (shown) => {
        progress = shown;
      },
    },
    read: () => ({
      badge,
      notifications: notifications.map(({ spec }) => spec),
      progress,
      shortcuts: [...shortcuts],
      tray,
    }),
    tray: {
      hide: () => {
        tray = undefined;
      },
      show: (spec) => {
        tray = spec;
      },
    },
  };
};

/** Leaves, as a JSON string under `E2E_GLOBAL`, what Electron holds for the first window's stage and the menu, the entitlement, the update state, the links sent to the browser and what was copied. */
export const exposeE2e = (options: {
  readonly stages: Pick<Stages, "all">;
  readonly entitlement: Pick<Entitlement<unknown>, "current">;
  readonly updater: Pick<Updater, "current">;
  readonly accelerators: () => Partial<Record<CommandId, string | null>>;
  readonly external: RecordingShell;
  readonly clipboard: RecordingClipboard;
  readonly desktop: RecordingDesktop;
  readonly contextMenu: RecordingContextMenu;
  readonly sessions: Pick<SessionPort, "fetchText">;
}): void => {
  const snapshot = (): E2eSnapshot => {
    const [stage] = options.stages.all;
    const desktop = options.desktop.read();
    return {
      badge: desktop.badge,
      clipboard: options.clipboard.written(),
      contextMenu: options.contextMenu.shown().map((entry) =>
        entry.kind === "item"
          ? {
              ...(entry.checked === undefined
                ? {}
                : { checked: entry.checked }),
              enabled: entry.enabled,
              id: entry.id,
              kind: entry.kind,
              label: entry.label,
            }
          : entry
      ),
      entitlement: options.entitlement.current(),
      external: [...options.external.opened],
      files: [...options.external.files],
      revealed: [...options.external.revealed],
      progress: desktop.progress,
      notifications: desktop.notifications.map(({ actions, ...shown }) => ({
        ...shown,
        ...(actions === undefined ? {} : { actions: [...actions] }),
      })),
      shortcuts: [...desktop.shortcuts],
      tray:
        desktop.tray?.menu.map((item) =>
          item.kind === "separator" ? "-" : item.label
        ) ?? null,
      menu: options.accelerators(),
      update: options.updater.current(),
      panes:
        stage?.panes().map(({ tab, view }) => ({
          contentsId: view.contentsId,
          tabId: tab.id,
          zoom: view.zoomFactor(),
        })) ?? [],
      views: stage?.window.childViews().map((view) => view.bounds()) ?? [],
    };
  };
  Reflect.set(globalThis, E2E_GLOBAL, () => JSON.stringify(snapshot()));
  Reflect.set(globalThis, E2E_CLICK_NOTIFICATION, options.desktop.click);
  Reflect.set(globalThis, E2E_ACT_NOTIFICATION, options.desktop.act);
  Reflect.set(globalThis, E2E_CLICK_CONTEXT_MENU, options.contextMenu.click);
  Reflect.set(
    globalThis,
    E2E_FETCH,
    async (partition: string, url: string, timeout: number) =>
      JSON.stringify(await options.sessions.fetchText(partition, url, timeout))
  );
};
