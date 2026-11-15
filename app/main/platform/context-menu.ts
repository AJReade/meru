import {
  BrowserWindow,
  clipboard,
  ClipboardItem,
  Menu,
  webContents,
} from "electron";
import type {
  ContextMenuParams as ElectronParams,
  MenuItemConstructorOptions,
  WebFrameMain,
} from "electron";

import type { ClipboardPort, ContextMenuPort } from "../../core/ports.ts";
import type {
  ContextMenuEntry,
  ContextMenuParams,
} from "../../core/records/context-menu.ts";

const paramsOf = (params: ElectronParams): ContextMenuParams => ({
  dictionarySuggestions: [...params.dictionarySuggestions],
  editFlags: {
    canCopy: params.editFlags.canCopy,
    canCut: params.editFlags.canCut,
    canPaste: params.editFlags.canPaste,
    canSelectAll: params.editFlags.canSelectAll,
  },
  isEditable: params.isEditable,
  linkText: params.linkText,
  linkUrl: params.linkURL,
  mediaType: params.mediaType,
  misspelledWord: params.misspelledWord,
  pageUrl: params.pageURL,
  selectionText: params.selectionText,
  srcUrl: params.srcURL,
  x: params.x,
  y: params.y,
});

const template = (entry: ContextMenuEntry): MenuItemConstructorOptions => {
  if (entry.kind === "separator") {
    return { type: "separator" };
  }
  if (entry.kind === "share") {
    return {
      label: entry.label,
      role: "shareMenu",
      sharingItem: { urls: [entry.url] },
    };
  }
  return {
    click: entry.run,
    enabled: entry.enabled,
    id: entry.id,
    label: entry.label,
    ...(entry.checked === undefined
      ? {}
      : { checked: entry.checked, type: "checkbox" }),
  };
};

const live = (contentsId: number) => {
  const contents = webContents.fromId(contentsId);
  return contents === undefined || contents.isDestroyed()
    ? undefined
    : contents;
};

export const createContextMenu = (): ContextMenuPort => {
  // The frame the click was in, by page, since macOS adds its Writing Tools only to a menu popped up with it.
  const frames = new Map<number, WebFrameMain>();
  return {
    act: (contentsId, action) => {
      const contents = live(contentsId);
      if (contents === undefined) {
        return;
      }
      if (action.kind === "edit") {
        contents[action.command]();
      } else if (action.kind === "replaceMisspelling") {
        contents.replaceMisspelling(action.word);
      } else if (action.kind === "learnSpelling") {
        contents.session.addWordToSpellCheckerDictionary(action.word);
      } else if (action.kind === "lookUp") {
        contents.showDefinitionForSelection();
      } else if (action.kind === "copyImageAt") {
        contents.copyImageAt(action.x, action.y);
      } else {
        contents.inspectElement(action.x, action.y);
        if (contents.isDevToolsOpened()) {
          contents.devToolsWebContents?.focus();
        }
      }
    },
    listen: (contentsId, listener) => {
      const contents = live(contentsId);
      if (contents === undefined) {
        return () => {
          // The page is already gone.
        };
      }
      const heard = (_event: unknown, params: ElectronParams) => {
        if (params.frame === null) {
          frames.delete(contentsId);
        } else {
          frames.set(contentsId, params.frame);
        }
        listener(paramsOf(params));
      };
      const forget = () => {
        frames.delete(contentsId);
      };
      contents.on("context-menu", heard);
      contents.once("destroyed", forget);
      return () => {
        forget();
        if (!contents.isDestroyed()) {
          contents.off("context-menu", heard);
          contents.off("destroyed", forget);
        }
      };
    },
    popup: (contentsId, entries) => {
      const contents = live(contentsId);
      if (contents === undefined) {
        return;
      }
      const frame = frames.get(contentsId) ?? contents.focusedFrame;
      const window = BrowserWindow.fromWebContents(contents);
      Menu.buildFromTemplate(entries.map(template)).popup({
        ...(frame === null ? {} : { frame }),
        ...(window === null ? {} : { window }),
      });
    },
  };
};

export const clipboardPort: ClipboardPort = {
  writeBookmark: async (title, url) => {
    await clipboard.write([
      new ClipboardItem({
        "electron application/bookmark": { title, url },
        "text/plain": url,
      }),
    ]);
  },
  writeText: async (text) => {
    await clipboard.writeText(text);
  },
};
