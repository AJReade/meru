import nodePath from "node:path";

import type {
  DownloadEvent,
  DownloadPort,
  DownloadStart,
  DownloadTarget,
} from "../../core/ports.ts";

/** Downloads over a folder tree held in memory, with the platform's paths, on a disk that folds case as macOS's and Windows' do by default; a test starts each download and moves it along as the network would. */
export class FakeDownloads implements DownloadPort {
  /** Every file on the fake disk, by absolute path. */
  readonly files = new Set<string>();
  /** Paths the disk refuses to delete or move, as one whose name is too long or whose folder is a file. */
  readonly stuck = new Set<string>();
  /** Each download under way, by id, with where it is being written. */
  readonly active = new Map<string, string>();
  /** Pages that have closed, which a download cannot start from. */
  readonly closedPages = new Set<number>();
  /** Every address a page was asked to download, in order. */
  readonly requested: { contentsId: number; url: string }[] = [];
  /** Each file marked as a finished download, in order. */
  readonly marked: string[] = [];
  /** Each file dragged out of a page, in order. */
  readonly dragged: { contentsId: number; path: string }[] = [];
  #decide: ((start: DownloadStart) => DownloadTarget) | undefined;
  #moves: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<(event: DownloadEvent) => void>();
  #count = 0;

  readonly handle = (decide: (start: DownloadStart) => DownloadTarget) => {
    this.#decide = decide;
    return () => {
      this.#decide = undefined;
    };
  };

  readonly onEvent = (listener: (event: DownloadEvent) => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Starts a download as a session would, answering its id and where it went, null when it was called off or nothing decided. */
  start(start: Partial<DownloadStart> & { readonly suggestedName: string }): {
    readonly id: string;
    readonly path: string | null;
  } {
    this.#count += 1;
    const id = start.id ?? `download-${this.#count}`;
    const target = this.#decide?.({
      committed: true,
      contentsId: 1,
      mimeType: "application/octet-stream",
      totalBytes: 100,
      url: `https://mail.google.com/attachment/${this.#count}`,
      ...start,
      id,
    });
    if (target?.kind === "save") {
      this.active.set(id, target.path);
      this.files.add(target.path);
    }
    return { id, path: target?.kind === "save" ? target.path : null };
  }

  progress(id: string, received: number, total = 100) {
    if (this.active.has(id)) {
      this.#emit({ id, kind: "progress", received, total });
    }
  }

  complete(id: string, received = 100) {
    if (this.active.delete(id)) {
      this.#emit({ id, kind: "done", received });
    }
  }

  /** The network stops the download; its partial file stays until it is cancelled or removed. */
  interrupt(id: string) {
    if (this.active.has(id)) {
      this.#emit({ id, kind: "interrupted" });
    }
  }

  readonly cancel = (id: string) => {
    const path = this.active.get(id);
    if (path === undefined) {
      return;
    }
    this.active.delete(id);
    this.files.delete(path);
    this.#emit({ id, kind: "cancelled" });
  };

  readonly download = (contentsId: number, url: string) => {
    if (this.closedPages.has(contentsId)) {
      return false;
    }
    this.requested.push({ contentsId, url });
    return true;
  };

  readonly dragOut = async (contentsId: number, path: string) => {
    await Promise.resolve();
    if (!this.files.has(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
    this.dragged.push({ contentsId, path });
  };

  readonly occupied = (path: string) => {
    const key = path.toLowerCase();
    return [...this.files].some((file) => file.toLowerCase() === key);
  };

  readonly namesIn = async (directory: string) => {
    await Promise.resolve();
    return [...this.files]
      .filter((path) => nodePath.dirname(path) === directory)
      .map((path) => nodePath.basename(path));
  };

  readonly exists = async (path: string) => {
    await Promise.resolve();
    return this.files.has(path);
  };

  readonly remove = async (path: string) => {
    await Promise.resolve();
    if (this.stuck.has(path)) {
      throw new Error(`ENAMETOOLONG: ${path}`);
    }
    this.files.delete(path);
  };

  /** Holds every move from now on, as a slow disk does, until the answer is called. */
  holdMoves(): () => void {
    const { promise, resolve } = Promise.withResolvers<undefined>();
    this.#moves = promise;
    return () => {
      resolve(undefined);
    };
  }

  readonly move = async (from: string, to: string) => {
    await this.#moves;
    if (this.stuck.has(from) || this.stuck.has(to)) {
      throw new Error(`ENOTDIR: ${to}`);
    }
    if (!this.files.delete(from)) {
      throw new Error(`ENOENT: ${from}`);
    }
    this.files.add(to);
  };

  readonly finished = async (path: string) => {
    await Promise.resolve();
    this.marked.push(path);
  };

  #emit(event: DownloadEvent) {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}
