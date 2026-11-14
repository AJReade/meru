import path from "node:path";

import { noop } from "es-toolkit";
import { z } from "zod";

import { DisposableStore } from "../../../core/disposable.ts";
import {
  progressOf,
  pruneHistory,
  SHOWN_DOWNLOADS,
  uniqueName,
  withPreferredExtension,
} from "../../../core/engines/downloads.ts";
import type { LogPort } from "../../../core/log.ts";
import type {
  Clock,
  DialogPort,
  DownloadEvent,
  DownloadPort,
  DownloadStart,
  DownloadTarget,
  FsPort,
  LifecyclePort,
  NotificationPort,
  ProgressPort,
  ShellPort,
} from "../../../core/ports.ts";
import { downloadSchema } from "../../../core/records/download.ts";
import type { Download } from "../../../core/records/download.ts";
import type { Platform } from "../../../core/records/platform.ts";
import { err, ok } from "../../../core/result.ts";
import type { Result } from "../../../core/result.ts";
import { SnapshotStore } from "../../../core/snapshot.ts";
import type { SnapshotSpec } from "../../../core/snapshot.ts";
import type { IpcRegistrar } from "../../../shared/channels/define.ts";
import {
  downloads as channels,
  downloadsPushes,
} from "../../../shared/channels/downloads.ts";
import type { DownloadsSnapshot } from "../../../shared/channels/downloads.ts";
import type { OverlayKind } from "../../../shared/channels/surfaces.ts";
import type { CommandRegistrar } from "../../../shared/commands/define.ts";
import { msg } from "../../../shared/msg.ts";
import type { SettingsStore } from "../settings/index.ts";
import type { Stages } from "../stage/index.ts";
import { downloadsCommands } from "./commands.ts";

export const DOWNLOADS_FILE = "downloads.json";

const historySchema = z.object({ items: z.array(downloadSchema) });

type History = z.infer<typeof historySchema>;

const historySnapshot: SnapshotSpec<History, "items"> = {
  // A download's record says only where a file went, so one that cannot be read is dropped and the rest kept.
  recover: (data) => {
    const items = z
      .object({ items: z.array(z.unknown()) })
      .safeParse(data)
      .data?.items.flatMap((item) => {
        const parsed = downloadSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
    return {
      fallbacks: data === undefined ? [] : ["items"],
      value: { items: items ?? [] },
    };
  },
  migrations: [],
  name: DOWNLOADS_FILE,
  schema: historySchema,
  version: 1,
};

/** How long a Save Image As waits for its download to arrive before it is forgotten. */
export const SAVE_AS_LIFETIME = 60_000;

/** A download under way: where it is written, where it goes once it is whole, which a save dialog may not have answered yet, and how far it has got. */
interface Active {
  readonly id: string;
  readonly createdAt: number;
  readonly written: string;
  target: string | undefined;
  received: number;
  total: number;
  done: boolean;
}

type DownloadError = "unknownDownload";

interface DownloadsOptions {
  readonly downloads: DownloadPort;
  readonly dialogs: DialogPort;
  readonly progress: ProgressPort;
  readonly shell: ShellPort;
  readonly notifications: NotificationPort;
  readonly platform: Platform;
  readonly fs: FsPort;
  readonly clock: Clock;
  readonly lifecycle: Pick<LifecyclePort, "onQuit">;
  readonly log: LogPort;
  readonly settings: Pick<SettingsStore, "get" | "set">;
  readonly registrar: IpcRegistrar;
  readonly commands: CommandRegistrar;
  readonly stages: Pick<Stages, "find">;
  readonly overlayUrl: (
    kind: OverlayKind,
    query: Readonly<Record<string, string>>
  ) => string;
  /** The folder downloads go to while `downloads.location` names none. */
  readonly defaultDirectory: string;
  /** Where a download is written while the save dialog asks where it goes. */
  readonly pendingDirectory: string;
  /** Closes the tab whose page is `contentsId`. */
  readonly closeTab: (contentsId: number) => void;
}

const revealLabel = (platform: Platform): string => {
  if (platform === "darwin") {
    return msg`Show in Finder`;
  }
  return platform === "win32"
    ? msg`Show in File Explorer`
    : msg`Show in your file manager`;
};

/** Saves every session's downloads into the download folder, or where the save dialog says, one dialog at a time; shows their progress on the app's icon, marks and announces each that finishes, and keeps the history the downloads overlay lists. */
export class Downloads {
  readonly #options: DownloadsOptions;
  readonly #store: SnapshotStore<History, "items">;
  readonly #disposables = new DisposableStore();
  readonly #active = new Map<string, Active>();
  #items: readonly Download[] = [];
  #finishedBytes = 0;
  #pendingSaves: { readonly url: string; readonly expiresAt: number }[] = [];
  #asking: Promise<void> = Promise.resolve();

  constructor(options: DownloadsOptions) {
    this.#options = options;
    this.#store = new SnapshotStore(historySnapshot, {
      clock: options.clock,
      fs: options.fs,
      lifecycle: options.lifecycle,
      log: options.log,
    });
  }

  async open(): Promise<void> {
    const opened = await this.#store.open();
    this.#items = pruneHistory(opened.value.items, this.#options.clock.now());
    if (opened.fallbacks.length > 0) {
      this.#options.log.warn(
        "The download history could not be read whole, so what could not was dropped",
        { file: DOWNLOADS_FILE }
      );
    }
  }

  start(): void {
    const { commands, downloads, registrar, stages } = this.#options;
    this.#disposables.add(
      () => {
        this.#store.dispose();
      },
      downloads.handle((start) => this.#decide(start)),
      downloads.onEvent((event) => {
        this.#follow(event);
      }),
      commands.register(downloadsCommands, {
        open: ({ windowId }) =>
          windowId === null ? err("unknownWindow") : this.show(windowId),
      }),
      registrar.register(channels, {
        chooseFolder: () => {
          void this.#chooseFolder();
          return ok(null);
        },
        clear: () => {
          this.#write([]);
          return ok(null);
        },
        close: (_payload, { contentsId }) => {
          stages.find(contentsId)?.closeOverlay();
          return ok(undefined);
        },
        defaultFolder: () => ok(this.#options.defaultDirectory),
        open: (_payload, { contentsId }) => this.show(contentsId),
        openFile: ({ id }) => this.openFile(id),
        remove: ({ id }) => this.remove(id),
        showInFolder: ({ id }) => this.showInFolder(id),
        snapshot: () => ok(this.snapshot()),
      })
    );
  }

  dispose(): void {
    this.#disposables.dispose();
  }

  snapshot(): DownloadsSnapshot {
    return { items: [...this.#items] };
  }

  /** Shows the history over the panes of the window whose chrome page is `windowId`, having looked again for the files it lists. */
  show(windowId: number): Result<undefined, "unknownWindow"> {
    const { overlayUrl, stages } = this.#options;
    const stage = stages.find(windowId);
    if (stage === undefined) {
      return err("unknownWindow");
    }
    stage.openOverlay("downloads", overlayUrl("downloads", {}));
    void this.recheck();
    return ok(undefined);
  }

  /** Looks for the file of each finished download the overlay lists, and writes only when one has come or gone. */
  async recheck(): Promise<void> {
    const shown = this.#items
      .slice(0, SHOWN_DOWNLOADS)
      .filter((item) => item.state === "done");
    const found = new Map(
      await Promise.all(
        shown.map(
          async (item) =>
            [
              item.id,
              await this.#options.downloads.exists(item.filePath),
            ] as const
        )
      )
    );
    // Read again after the wait, so a download that finished meanwhile is kept.
    const changed = this.#items.some(
      (item) => found.has(item.id) && found.get(item.id) !== item.exists
    );
    if (changed) {
      this.#write(
        this.#items.map((item) => {
          const exists = found.get(item.id);
          return exists === undefined ? item : { ...item, exists };
        })
      );
    }
  }

  openFile(id: string): Result<null, DownloadError> {
    const item = this.#item(id);
    if (item === undefined) {
      return err("unknownDownload");
    }
    void this.#openPath(item.filePath);
    return ok(null);
  }

  async #openPath(file: string) {
    try {
      await this.#options.shell.openPath(file);
    } catch (error) {
      this.#options.log.warn("A download could not be opened", { error });
      await this.recheck();
    }
  }

  showInFolder(id: string): Result<null, DownloadError> {
    const item = this.#item(id);
    if (item === undefined) {
      return err("unknownDownload");
    }
    this.#options.shell.showItemInFolder(item.filePath);
    return ok(null);
  }

  /** Takes the download off the history; its file stays where it is. */
  remove(id: string): Result<null, DownloadError> {
    if (this.#item(id) === undefined) {
      return err("unknownDownload");
    }
    this.#write(this.#items.filter((item) => item.id !== id));
    return ok(null);
  }

  /** Downloads `url` from the page `contentsId`, asking where to save it whatever `downloads.saveAs` says, as Save Image As does. */
  saveAs(contentsId: number, url: string): void {
    const now = this.#options.clock.now();
    this.#pendingSaves = [
      ...this.#pendingSaves.filter(({ expiresAt }) => expiresAt > now),
      { expiresAt: now + SAVE_AS_LIFETIME, url: URL.parse(url)?.href ?? url },
    ];
    this.#options.downloads.download(contentsId, url);
  }

  async flush(): Promise<void> {
    await this.#store.flush();
  }

  #item(id: string): Download | undefined {
    return this.#items.find((item) => item.id === id);
  }

  #directory(): string {
    return (
      this.#options.settings.get("downloads.location") ??
      this.#options.defaultDirectory
    );
  }

  #decide(start: DownloadStart): DownloadTarget {
    const { clock, downloads, pendingDirectory, platform, settings } =
      this.#options;
    if (start.contentsId !== null && !start.committed) {
      const { contentsId } = start;
      // Closing the page from inside its own will-download would destroy what Chromium is still handing over.
      clock.schedule(0, () => {
        this.#options.closeTab(contentsId);
      });
    }
    const directory = this.#directory();
    const held = [...this.#active.values()].flatMap(({ target }) =>
      target !== undefined && path.dirname(target) === directory
        ? [path.basename(target)]
        : []
    );
    const target = path.join(
      directory,
      uniqueName(
        [...downloads.namesIn(directory), ...held],
        withPreferredExtension(start.suggestedName, start.mimeType),
        platform
      )
    );
    const ask = this.#takeSaveAs(start.url) || settings.get("downloads.saveAs");
    const written = ask ? path.join(pendingDirectory, start.id) : target;
    this.#active.set(start.id, {
      createdAt: clock.now(),
      done: false,
      id: start.id,
      received: 0,
      target: ask ? undefined : target,
      total: start.totalBytes,
      written,
    });
    if (ask) {
      this.#enqueue(start.id, target);
    }
    this.#showProgress();
    return { kind: "save", path: written };
  }

  #takeSaveAs(url: string): boolean {
    const now = this.#options.clock.now();
    const canonical = URL.parse(url)?.href ?? url;
    const live = this.#pendingSaves.filter(({ expiresAt }) => expiresAt > now);
    const index = live.findIndex((pending) => pending.url === canonical);
    this.#pendingSaves = live.filter((_, at) => at !== index);
    return index !== -1;
  }

  // One dialog at a time: each download waits its turn while it is written to the pending folder, so a second one never hangs a second sheet on the window.
  #enqueue(id: string, suggested: string) {
    this.#asking = this.#askAfter(this.#asking, id, suggested);
  }

  async #askAfter(previous: Promise<void>, id: string, suggested: string) {
    await previous;
    try {
      await this.#ask(id, suggested);
    } catch (error) {
      this.#options.log.error("The save dialog failed", { error });
      const active = this.#active.get(id);
      if (active !== undefined) {
        await this.#fail(active);
      }
    }
  }

  async #ask(id: string, suggested: string) {
    if (!this.#active.has(id)) {
      return;
    }
    const chosen = await this.#options.dialogs.save(suggested);
    const active = this.#active.get(id);
    if (active === undefined) {
      return;
    }
    if (chosen === null) {
      this.#active.delete(id);
      this.#options.downloads.cancel(id);
      await this.#options.downloads.remove(active.written);
      this.#showProgress();
      return;
    }
    active.target = chosen;
    if (active.done) {
      await this.#complete(active);
    }
  }

  #follow(event: DownloadEvent) {
    const active = this.#active.get(event.id);
    if (active === undefined) {
      return;
    }
    if (event.kind === "progress") {
      active.received = event.received;
      active.total = event.total;
      this.#showProgress();
    } else if (event.kind === "done") {
      active.done = true;
      active.received = event.received;
      this.#finishedBytes += event.received;
      this.#showProgress();
      if (active.target !== undefined) {
        void this.#complete(active);
      }
    } else if (event.kind === "interrupted") {
      void this.#fail(active);
    } else {
      this.#active.delete(active.id);
      this.#showProgress();
      this.#record(active, "cancelled");
    }
  }

  #showProgress() {
    const running = [...this.#active.values()].filter(({ done }) => !done);
    if (running.length === 0) {
      this.#finishedBytes = 0;
    }
    this.#options.progress.set(progressOf(running, this.#finishedBytes));
  }

  async #fail(active: Active) {
    const { downloads, log, notifications, settings } = this.#options;
    this.#active.delete(active.id);
    this.#showProgress();
    downloads.cancel(active.id);
    await downloads.remove(active.written);
    const name = this.#record(active, "failed");
    log.warn("A download was interrupted");
    notifications.show(
      {
        body: msg`The download of ${name} was interrupted.`,
        silent: !settings.get("notifications.playSound"),
        title: msg`Download failed`,
      },
      noop
    );
  }

  async #complete(active: Active) {
    const { downloads, log, settings, shell } = this.#options;
    const { target = active.written } = active;
    this.#active.delete(active.id);
    try {
      if (target !== active.written) {
        await downloads.move(active.written, target);
      }
    } catch (error) {
      log.error("A download could not be moved where it was saved", {
        error,
      });
      await downloads.remove(active.written);
      this.#record(active, "failed");
      return;
    }
    // Before anything else touches the file, so nothing can open it unquarantined.
    try {
      await downloads.finished(target);
    } catch (error) {
      log.error("A download could not be quarantined", { error });
    }
    this.#record(active, "done");
    if (settings.get("downloads.openFolderWhenDone")) {
      shell.showItemInFolder(target);
    }
    this.#announce(active.id, path.basename(target));
  }

  #announce(id: string, name: string) {
    const { notifications, platform, settings } = this.#options;
    if (!settings.get("notifications.downloadCompleted")) {
      return;
    }
    const opens =
      settings.get("notifications.onClickDownloadCompleted") === "openFile";
    const act = () => {
      if (opens) {
        this.openFile(id);
      } else {
        this.showInFolder(id);
      }
    };
    // A click on the body brings Meru forward on macOS and Windows, which would put the file or its folder behind it; the button does not. Some Linux notification servers draw no buttons, so there the body acts too.
    notifications.show(
      {
        action: opens ? msg`Open` : revealLabel(platform),
        silent: !settings.get("notifications.playSound"),
        title: msg`Downloaded ${name}`,
      },
      platform === "linux" ? act : noop,
      act
    );
  }

  /** Records how the download ended and answers the name it ended under. */
  #record(active: Active, state: Download["state"]): string {
    const filePath = active.target ?? active.written;
    const fileName = path.basename(filePath);
    this.#write([
      {
        createdAt: active.createdAt,
        exists: state === "done",
        fileName,
        filePath,
        id: active.id,
        state,
      },
      ...this.#items,
    ]);
    return fileName;
  }

  #write(items: readonly Download[]) {
    this.#items = pruneHistory(items, this.#options.clock.now());
    this.#store.write({ items: [...this.#items] });
    this.#options.registrar.broadcast(downloadsPushes.changed, this.snapshot());
  }

  async #chooseFolder() {
    const chosen = await this.#options.dialogs.chooseFolder(this.#directory());
    if (chosen !== null) {
      this.#options.settings.set("downloads.location", chosen);
    }
  }
}
