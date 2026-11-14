import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, readdirSync } from "node:fs";
import { access, copyFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { app, BrowserWindow, dialog, webContents } from "electron";
import type {
  DownloadItem,
  Event,
  OpenDialogOptions,
  Session,
  WebContents,
} from "electron";

import type {
  DialogPort,
  DownloadEvent,
  DownloadPort,
  DownloadStart,
  DownloadTarget,
  ProgressPort,
} from "../../core/ports.ts";
import type { Platform } from "../../core/records/platform.ts";

const run = async (file: string, args: readonly string[]) => {
  const child = spawn(file, args, { stdio: "ignore" });
  const closed: unknown[] = await once(child, "close");
  const [code] = closed;
  if (code !== 0) {
    throw new Error(`${file} exited with ${String(code)}`);
  }
};

// Chromium quarantines a download in-process on Windows only and otherwise expects the embedder to, which Electron does not, so without this Gatekeeper never checks a file Meru downloads. The value is flags, the time in hex seconds, the agent and an empty event id, since Launch Services keeps no download history row for Meru's.
const quarantine = async (file: string) => {
  const seconds = Math.floor(Date.now() / 1000).toString(16);
  await run("/usr/bin/xattr", [
    "-w",
    "com.apple.quarantine",
    `0081;${seconds};Meru;`,
    "--",
    file,
  ]);
};

const moveFile = async (from: string, to: string) => {
  try {
    await rename(from, to);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "EXDEV")
    ) {
      throw error;
    }
    await copyFile(from, to);
    await rm(from, { force: true });
  }
};

/** Every session's downloads: hears `will-download` on each session as it is created, so a profile's partition made later is heard too. */
export const createDownloads = (options: {
  readonly platform: Platform;
  readonly defaultDirectory: string;
}): DownloadPort => {
  let decide: ((start: DownloadStart) => DownloadTarget) | undefined;
  const listeners = new Set<(event: DownloadEvent) => void>();
  const items = new Map<string, DownloadItem>();
  const emit = (event: DownloadEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const follow = (id: string, item: DownloadItem) => {
    items.set(id, item);
    item.on("updated", (_event, state) => {
      emit(
        state === "interrupted"
          ? { id, kind: "interrupted" }
          : {
              id,
              kind: "progress",
              received: item.getReceivedBytes(),
              total: item.getTotalBytes(),
            }
      );
    });
    item.once("done", (_event, state) => {
      items.delete(id);
      if (state === "completed") {
        emit({ id, kind: "done", received: item.getReceivedBytes() });
      } else {
        emit({ id, kind: state === "cancelled" ? "cancelled" : "interrupted" });
      }
    });
  };

  const willDownload = (
    event: Event,
    item: DownloadItem,
    contents: WebContents | null
  ) => {
    if (decide === undefined) {
      return;
    }
    const id = randomUUID();
    const target = decide({
      committed: (contents?.getURL() ?? "") !== "",
      contentsId: contents?.id ?? null,
      id,
      mimeType: item.getMimeType(),
      suggestedName: item.getFilename(),
      totalBytes: item.getTotalBytes(),
      // The chain's first entry is the address asked for, where getURL() is where a redirect ended.
      url: item.getURLChain()[0] ?? item.getURL(),
    });
    if (target.kind === "cancel") {
      event.preventDefault();
      return;
    }
    try {
      mkdirSync(path.dirname(target.path), { recursive: true });
    } catch {
      // A folder that cannot be made fails the download once Chromium writes to it, which the feature hears as an interruption.
    }
    item.setSavePath(target.path);
    follow(id, item);
  };

  const sessions = new WeakSet<Session>();
  const hear = (session: Session) => {
    if (sessions.has(session)) {
      return;
    }
    sessions.add(session);
    session.on("will-download", willDownload);
  };
  app.on("session-created", hear);

  return {
    // Chromium asserts when a download re-enters its own observer, which a cancel from an `updated` listener would.
    cancel: (id) => {
      const item = items.get(id);
      setTimeout(() => {
        if (item?.getState() === "progressing" || item?.canResume() === true) {
          item.cancel();
        }
      }, 0);
    },
    defaultDirectory: options.defaultDirectory,
    download: (contentsId, url) => {
      webContents.fromId(contentsId)?.downloadURL(url);
    },
    exists: async (file) => {
      try {
        await access(file);
        return true;
      } catch {
        return false;
      }
    },
    finished: async (file) => {
      if (options.platform === "darwin") {
        await quarantine(file);
        app.dock?.downloadFinished(file);
      }
    },
    handle: (decider) => {
      decide = decider;
      return () => {
        decide = undefined;
      };
    },
    move: moveFile,
    namesIn: (directory) => {
      try {
        return readdirSync(directory);
      } catch {
        return [];
      }
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    remove: async (file) => {
      await rm(file, { force: true });
    },
  };
};

// Electron shows anything above 1 as indeterminate and anything below 0 as no bar.
const BAR_VALUES = { indeterminate: 2, none: -1 } as const;

export const progressBar: ProgressPort = {
  set: (progress) => {
    const value =
      progress.kind === "fraction" ? progress.value : BAR_VALUES[progress.kind];
    for (const window of BrowserWindow.getAllWindows()) {
      window.setProgressBar(value);
    }
  },
};

export const dialogs: DialogPort = {
  chooseFolder: async (defaultPath) => {
    const options: OpenDialogOptions = {
      defaultPath,
      properties: ["openDirectory", "createDirectory"],
    };
    const parent = BrowserWindow.getFocusedWindow();
    const answer = await (parent === null
      ? dialog.showOpenDialog(options)
      : dialog.showOpenDialog(parent, options));
    return answer.canceled ? null : (answer.filePaths[0] ?? null);
  },
  save: async (defaultPath) => {
    const parent = BrowserWindow.getFocusedWindow();
    const answer = await (parent === null
      ? dialog.showSaveDialog({ defaultPath })
      : dialog.showSaveDialog(parent, { defaultPath }));
    return answer.canceled || answer.filePath === "" ? null : answer.filePath;
  },
};
