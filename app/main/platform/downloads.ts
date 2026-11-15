import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { access, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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

// oxlint-disable-next-line typescript/strict-void-return -- promisify reads the callback, not the ChildProcess execFile returns.
const run = promisify(execFile);

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
  // Chromium makes the download folder when it saves into one that is missing, so a move into it does too.
  await mkdir(path.dirname(to), { recursive: true });
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
    download: (contentsId, url) => {
      webContents.fromId(contentsId)?.downloadURL(url);
    },
    dragOut: async (contentsId, file) => {
      const contents = webContents.fromId(contentsId);
      if (contents === null || contents === undefined) {
        return;
      }
      // Electron refuses a drag with an empty image, so the icon is fetched before the drag starts rather than drawn from the file's type here.
      const icon = await app.getFileIcon(file);
      contents.startDrag({ file, icon });
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
    namesIn: async (directory) => {
      try {
        return await readdir(directory);
      } catch {
        return [];
      }
    },
    occupied: existsSync,
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
