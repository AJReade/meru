import path from "node:path";

import { noop } from "es-toolkit";
import { z } from "zod";

import { DisposableStore } from "../../../core/disposable.ts";
import {
  countedReceived,
  progressOf,
  pruneHistory,
  SHOWN_DOWNLOADS,
  takenAmong,
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
  Unsubscribe,
} from "../../../core/ports.ts";
import { downloadSchema } from "../../../core/records/download.ts";
import type {
  ActiveDownload,
  Download,
} from "../../../core/records/download.ts";
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

/** How often at most the pages hear what the downloads under way have received: Chromium reports every chunk it writes, which is many times a second on a fast network. */
export const PROGRESS_INTERVAL = 500;

/** How long a Save image as waits for its download to arrive before it is forgotten. */
export const SAVE_AS_LIFETIME = 60_000;

/** Where a download goes once it is whole: a path, or, while the save dialog has not answered, the one it suggested. */
type Destination =
  | { readonly kind: "known"; readonly path: string }
  | { readonly kind: "asking"; readonly suggested: string };

/** A download under way: where it is written, where it goes, and how far it has got. */
interface Active {
  readonly id: string;
  readonly createdAt: number;
  readonly written: string;
  destination: Destination;
  received: number;
  total: number;
  /** The share it had reached before it last restarted from nothing, which it counts as received until it passes it again. */
  floor: number;
  done: boolean;
}

const countedOf = ({ floor, received, total }: Active): number =>
  countedReceived(received, total, floor);

const pathOf = (destination: Destination): string =>
  destination.kind === "known" ? destination.path : destination.suggested;

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
  #settledBytes = 0;
  #pendingSaves: { readonly url: string; readonly expiresAt: number }[] = [];
  #asking: Promise<void> = Promise.resolve();
  #progressDue: Unsubscribe | undefined;

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
        cancel: ({ id }) => this.cancel(id),
        clear: () => {
          this.#write([]);
          return ok(null);
        },
        close: (_payload, { contentsId }) => {
          stages.find(contentsId)?.closeOverlay();
          return ok(undefined);
        },
        defaultFolder: () => ok(this.#options.defaultDirectory),
        dragOut: ({ id }, { contentsId }) => {
          const item = this.#item(id);
          if (item === undefined || item.state !== "done" || !item.exists) {
            return err("unknownDownload");
          }
          void this.#dragOut(contentsId, item.filePath);
          return ok(undefined);
        },
        open: (_payload, { contentsId }) => this.show(contentsId),
        openFile: ({ id }) => this.openFile(id),
        remove: ({ id }) => this.remove(id),
        showInFolder: ({ id }) => this.showInFolder(id),
        snapshot: () => ok(this.snapshot()),
      })
    );
    void this.#sweepPending();
  }

  dispose(): void {
    this.#progressDue?.();
    this.#progressDue = undefined;
    this.#disposables.dispose();
  }

  snapshot(): DownloadsSnapshot {
    return { active: this.#activeDownloads(), items: [...this.#items] };
  }

  /** The downloads still arriving, newest first; one whose bytes are all in waits only on its dialog or its move, so it is no longer among them. */
  #activeDownloads(): ActiveDownload[] {
    return [...this.#active.values()]
      .filter(({ done }) => !done)
      .toSorted((a, b) => b.createdAt - a.createdAt)
      .map((active) => ({
        fileName: path.basename(pathOf(active.destination)),
        id: active.id,
        received: countedOf(active),
        total: active.total,
      }));
  }

  /** Calls off a download under way; its record arrives as cancelled once the session has let it go. */
  cancel(id: string): Result<null, DownloadError> {
    const active = this.#active.get(id);
    if (active === undefined || active.done) {
      return err("unknownDownload");
    }
    this.#options.downloads.cancel(id);
    return ok(null);
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

  /** Hands the file to the system's drag once it is there, looking again for the files the overlay lists when it is not, so the row is marked gone rather than dragging out a path to nothing. */
  async #dragOut(contentsId: number, file: string) {
    if (!(await this.#options.downloads.exists(file))) {
      await this.recheck();
      return;
    }
    try {
      await this.#options.downloads.dragOut(contentsId, file);
    } catch (error) {
      this.#options.log.warn("A download could not be dragged out", { error });
      await this.recheck();
    }
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

  /** Downloads `url` from the page `contentsId`, asking where to save it whatever `downloads.saveAs` says, as Save image as does. */
  saveAs(contentsId: number, url: string): void {
    const now = this.#options.clock.now();
    const pending = this.#pendingSaves.filter(
      ({ expiresAt }) => expiresAt > now
    );
    // Armed before the download starts, since Chromium asks for its path before `download` returns; a page that has gone starts none, and a save left armed would ask about the next download of the address from any page.
    this.#pendingSaves = [
      ...pending,
      { expiresAt: now + SAVE_AS_LIFETIME, url: URL.parse(url)?.href ?? url },
    ];
    if (!this.#options.downloads.download(contentsId, url)) {
      this.#pendingSaves = pending;
    }
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

  /** `name` in `directory`, made unique against the files there and the downloads under way headed there. */
  #freePath(directory: string, name: string): string {
    const { downloads, platform } = this.#options;
    // Chromium creates a download's file only moments after it starts, so until then the disk says a held name is free.
    const held = takenAmong(
      [...this.#active.values()].flatMap(({ destination }) => {
        const file = pathOf(destination);
        return path.dirname(file) === directory ? [path.basename(file)] : [];
      }),
      platform
    );
    return path.join(
      directory,
      uniqueName(
        name,
        (candidate) =>
          held(candidate) || downloads.occupied(path.join(directory, candidate))
      )
    );
  }

  #decide(start: DownloadStart): DownloadTarget {
    const { clock, pendingDirectory, settings } = this.#options;
    if (start.contentsId !== null && !start.committed) {
      const { contentsId } = start;
      // Closing the page from inside its own will-download would destroy what Chromium is still handing over.
      clock.schedule(0, () => {
        this.#options.closeTab(contentsId);
      });
    }
    const target = this.#freePath(
      this.#directory(),
      withPreferredExtension(start.suggestedName, start.mimeType)
    );
    const ask = this.#takeSaveAs(start.url) || settings.get("downloads.saveAs");
    const written = ask ? path.join(pendingDirectory, start.id) : target;
    this.#active.set(start.id, {
      createdAt: clock.now(),
      destination: ask
        ? { kind: "asking", suggested: target }
        : { kind: "known", path: target },
      done: false,
      floor: 0,
      id: start.id,
      received: 0,
      total: start.totalBytes,
      written,
    });
    if (ask) {
      this.#enqueue(start.id, target);
    }
    this.#showProgress();
    this.#broadcast();
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
    if (active !== undefined) {
      if (chosen === null) {
        this.#settle(active);
        this.#options.downloads.cancel(id);
      } else {
        active.destination = { kind: "known", path: chosen };
        if (active.done) {
          await this.#complete(active);
        }
      }
    }
    void this.#sweepPending();
  }

  /** Deletes what the pending folder holds that no download under way is writing and the history does not list, such as what a crash or a cancelled dialog left. */
  async #sweepPending() {
    const { downloads, pendingDirectory } = this.#options;
    const names = await downloads.namesIn(pendingDirectory);
    const owned = new Set([
      ...[...this.#active.values()].map(({ written }) => written),
      ...this.#items.map(({ filePath }) => filePath),
    ]);
    await Promise.all(
      names
        .map((name) => path.join(pendingDirectory, name))
        .filter((file) => !owned.has(file))
        .map(async (file) => {
          await this.#delete(file);
        })
    );
  }

  /** Deletes a file, logging rather than throwing when the disk refuses. */
  async #delete(file: string) {
    try {
      await this.#options.downloads.remove(file);
    } catch (error) {
      this.#options.log.warn("A download's file could not be deleted", {
        error,
      });
    }
  }

  /** Takes the download off those under way, counting what it received as arrived so the bar does not run backwards. */
  #settle(active: Active) {
    if (this.#active.delete(active.id) && !active.done) {
      this.#settledBytes += countedOf(active);
    }
    this.#showProgress();
    this.#broadcast();
  }

  #follow(event: DownloadEvent) {
    const active = this.#active.get(event.id);
    if (active === undefined) {
      return;
    }
    if (event.kind === "progress") {
      if (event.received < active.received && active.total > 0) {
        active.floor = Math.max(active.floor, active.received / active.total);
      }
      active.received = event.received;
      active.total = event.total;
      this.#showProgress();
      this.#pushProgress();
    } else if (event.kind === "done") {
      active.received = event.received;
      this.#settledBytes += event.received;
      active.done = true;
      this.#showProgress();
      this.#broadcast();
      if (active.destination.kind === "known") {
        void this.#complete(active);
      }
    } else if (event.kind === "interrupted") {
      this.#options.log.warn("A download was interrupted");
      void this.#fail(active);
    } else {
      this.#settle(active);
      this.#record(active, "cancelled");
    }
  }

  #showProgress() {
    const running = [...this.#active.values()].filter(({ done }) => !done);
    if (running.length === 0) {
      this.#settledBytes = 0;
    }
    this.#options.progress.set(
      progressOf(
        running.map((active) => ({
          received: countedOf(active),
          total: active.total,
        })),
        this.#settledBytes
      )
    );
  }

  /** Calls the download off, records it as failed, tells the user and then deletes what it wrote, so a disk that refuses the delete loses nothing else. */
  async #fail(active: Active) {
    const { downloads, notifications, settings } = this.#options;
    this.#settle(active);
    downloads.cancel(active.id);
    const name = this.#record(active, "failed");
    notifications.show(
      {
        body: msg`The download of ${name} was interrupted.`,
        silent: !settings.get("notifications.playSound"),
        title: msg`Download failed`,
      },
      noop
    );
    await this.#delete(active.written);
  }

  /** Moves a whole download where it was saved, holding it among those under way until the move has settled, so the pending folder's sweep leaves its file alone; a move the disk refuses puts the file in the download folder instead, recorded there and said so. */
  async #complete(active: Active) {
    const { downloads, log, settings, shell } = this.#options;
    const target = pathOf(active.destination);
    let saved = target;
    try {
      if (target !== active.written) {
        await downloads.move(active.written, target);
      }
    } catch (error) {
      log.error("A download could not be moved where it was saved", {
        error,
      });
      saved = await this.#rescue(active, path.basename(target));
    } finally {
      this.#active.delete(active.id);
    }
    // Before anything else touches the file, so nothing can open it unquarantined.
    try {
      await downloads.finished(saved);
    } catch (error) {
      log.error("A download could not be quarantined", { error });
    }
    this.#record(active, "done", saved);
    if (saved !== target) {
      this.#announceUnmoved(active.id, path.basename(target), saved);
      return;
    }
    if (settings.get("downloads.openFolderWhenDone")) {
      shell.showItemInFolder(target);
    }
    this.#announce(active.id, path.basename(target));
  }

  /** Moves a download the disk would not put where it was saved into the download folder under the name chosen, since the pending folder is emptied of whatever the history does not list and would lose it once the list is cleared; answers where it is, the pending folder when the disk refuses that too. */
  async #rescue(active: Active, name: string): Promise<string> {
    const { downloads, log } = this.#options;
    const fallback = this.#freePath(this.#directory(), name);
    try {
      await downloads.move(active.written, fallback);
      return fallback;
    } catch (error) {
      log.error("A download could not be moved into the download folder", {
        error,
      });
      return active.written;
    }
  }

  #announceUnmoved(id: string, name: string, saved: string) {
    const { notifications, platform, settings } = this.#options;
    const reveal = () => {
      this.showInFolder(id);
    };
    notifications.show(
      {
        actions: [revealLabel(platform)],
        body: msg`${name} could not be saved where you chose, so it was kept in ${path.dirname(saved)}.`,
        silent: !settings.get("notifications.playSound"),
        title: msg`Download not moved`,
      },
      platform === "linux" ? reveal : noop,
      reveal
    );
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
        actions: [opens ? msg`Open` : revealLabel(platform)],
        silent: !settings.get("notifications.playSound"),
        title: msg`Downloaded ${name}`,
      },
      platform === "linux" ? act : noop,
      act
    );
  }

  /** Records how the download ended, under the name it was given and at `filePath`, where it was given unless it stayed elsewhere, and answers the name. */
  #record(
    active: Active,
    state: Download["state"],
    filePath = pathOf(active.destination)
  ): string {
    const fileName = path.basename(pathOf(active.destination));
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
    this.#broadcast();
  }

  /** Tells the pages what the overlay shows, dropping any progress push waiting its turn. */
  #broadcast() {
    this.#progressDue?.();
    this.#progressDue = undefined;
    this.#options.registrar.broadcast(downloadsPushes.changed, this.snapshot());
  }

  #pushProgress() {
    this.#progressDue ??= this.#options.clock.schedule(
      PROGRESS_INTERVAL,
      () => {
        this.#progressDue = undefined;
        this.#broadcast();
      }
    );
  }

  async #chooseFolder() {
    const chosen = await this.#options.dialogs.chooseFolder(this.#directory());
    if (chosen !== null) {
      this.#options.settings.set("downloads.location", chosen);
    }
  }
}
