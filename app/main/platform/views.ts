import { BrowserWindow, WebContentsView } from "electron";
import type {
  BrowserWindowConstructorOptions,
  Event,
  HandlerDetails,
  View,
  WebContents,
} from "electron";

import type {
  OpenListener,
  PageRoutes,
  PopOut,
  PopOutListener,
  ViewFactoryPort,
  ViewPort,
  ViewSpec,
} from "../../core/ports.ts";
import type { Disposition } from "../../core/records/link.ts";
import { onBeforeInput } from "./keys.ts";

/** How long a blank popup may wait for its first navigation; Google's sign-in points its window at accounts.google.com in the same task that opens it. */
const BLANK_POPUP_TIMEOUT = 5000;

const handles = new WeakMap<ViewPort, WebContentsView>();
const ports = new WeakMap<View, ViewPort>();

export const handleOf = (view: ViewPort): WebContentsView => {
  const handle = handles.get(view);
  if (handle === undefined) {
    throw new Error("A view the view factory did not make reached a window");
  }
  return handle;
};

export const portOf = (view: View): ViewPort | undefined => ports.get(view);

// Chromium's window-open dispositions are new-window, background-tab, foreground-tab and other; only the first two ask for something an ordinary click does not.
const dispositionOf = (
  disposition: HandlerDetails["disposition"]
): Disposition => {
  if (disposition === "new-window") {
    return "window";
  }
  return disposition === "background-tab" ? "background" : "default";
};

/** A window made around a web contents Chromium made, with the routes its page answers to. */
interface Child {
  readonly contents: WebContents;
  readonly routes: PageRoutes;
}

// Google's sign-in opens a blank window and only then points it at accounts.google.com, so on Electron 45 the window cannot be judged by its address when it opens; it waits hidden for its first navigation, and one that never navigates, such as a page that writes into it, is closed rather than left hidden for good. tests/popup.e2e.ts reproduces both.
const openBlank = (
  options: BrowserWindowConstructorOptions,
  opener: PageRoutes
): Child => {
  const popup = new BrowserWindow({ ...options, show: false });
  const unused = setTimeout(() => {
    popup.destroy();
  }, BLANK_POPUP_TIMEOUT);
  popup.once("closed", () => {
    clearTimeout(unused);
  });
  let decided = false;
  return {
    contents: popup.webContents,
    routes: {
      ...opener,
      open: (url, disposition) => {
        if (decided || disposition !== "inPlace") {
          return opener.open(url, disposition);
        }
        decided = true;
        clearTimeout(unused);
        if (opener.popup(url)) {
          popup.show();
          return false;
        }
        popup.destroy();
        return true;
      },
    },
  };
};

// The options carry the web contents Chromium already made for the window, with the opener's session, so the window wraps it rather than loading the address again.
// Chromium hands the window the opener's session but not its preload or its arguments, which name the page's surface, so they are given again.
const openPopOut = (
  options: BrowserWindowConstructorOptions,
  popOut: PopOut,
  opener: ViewSpec
): Child => {
  const window = new BrowserWindow({
    ...options,
    webPreferences: {
      ...options.webPreferences,
      additionalArguments: [...(opener.arguments ?? [])],
      preload: opener.preload,
    },
    height: popOut.height,
    width: popOut.width,
  });
  const live = (act: () => void) => {
    if (!window.isDestroyed()) {
      act();
    }
  };
  popOut.opened({
    close: () => {
      live(() => {
        window.close();
      });
    },
    contentsId: window.webContents.id,
    hide: () => {
      live(() => {
        window.hide();
      });
    },
    onClosed: (listener) => {
      window.on("closed", listener);
      return () => {
        window.off("closed", listener);
      };
    },
    show: () => {
      live(() => {
        window.show();
      });
    },
  });
  return { contents: window.webContents, routes: popOut.routes };
};

// Electron keeps one window-open handler per web contents, so a page's contents get it once and it fans each link out through the routes. Every window made here goes through `adopt`, since one left without a handler opens whatever its page asks for as a bare window.
const route = (
  contents: WebContents,
  routes: PageRoutes,
  opener: ViewSpec
): void => {
  const adopt = (child: Child): WebContents => {
    route(child.contents, child.routes, opener);
    return child.contents;
  };
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (url === "about:blank") {
      return {
        action: "allow",
        createWindow: (options) => adopt(openBlank(options, routes)),
      };
    }
    const popOut = routes.popOut(url, dispositionOf(disposition));
    if (popOut !== null) {
      return {
        action: "allow",
        createWindow: (options) => adopt(openPopOut(options, popOut, opener)),
      };
    }
    return routes.open(url, dispositionOf(disposition))
      ? { action: "deny" }
      : { action: "allow" };
  });
  // will-navigate never hears a server's redirect, so a page could leave by a redirect where it may not by a link; will-redirect also hears a frame's, which the page's own origin does not answer for.
  const guard = (
    event: Event<{ readonly isMainFrame: boolean; readonly url: string }>
  ) => {
    if (event.isMainFrame && routes.open(event.url, "inPlace")) {
      event.preventDefault();
    }
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
};

const createView = (spec: ViewSpec): ViewPort => {
  const view = new WebContentsView({
    webPreferences: {
      additionalArguments: [...(spec.arguments ?? [])],
      contextIsolation: true,
      nodeIntegration: false,
      partition: spec.partition,
      preload: spec.preload,
      sandbox: true,
      zoomFactor: spec.zoom,
    },
  });
  view.setBorderRadius(spec.radius);
  view.setBackgroundColor(spec.background);
  const contents = view.webContents;
  const openers = new Set<OpenListener>();
  const popupListeners = new Set<(url: string) => boolean>();
  const popOutListeners = new Set<PopOutListener>();
  route(
    contents,
    {
      open: (url, disposition) =>
        [...openers].some((listener) => listener(url, disposition)),
      popOut: (url, disposition) => {
        for (const listener of popOutListeners) {
          const popOut = listener(url, disposition);
          if (popOut !== null) {
            return popOut;
          }
        }
        return null;
      },
      popup: (url) =>
        popupListeners.size === 0 ||
        [...popupListeners].some((listener) => listener(url)),
    },
    spec
  );

  const port: ViewPort = {
    bounds: () => view.getBounds(),
    contentsId: contents.id,
    destroy: () => {
      if (!contents.isDestroyed()) {
        contents.close();
      }
    },
    focus: () => {
      contents.focus();
    },
    loadURL: async (url) => {
      await contents.loadURL(url);
    },
    history: () => ({
      entries: contents.navigationHistory
        .getAllEntries()
        .map(({ pageState, title, url }) => ({ pageState, title, url })),
      index: contents.navigationHistory.getActiveIndex(),
    }),
    restore: async ({ entries, index }) => {
      await contents.navigationHistory.restore({
        entries: [...entries],
        index,
      });
    },
    navigate: (action) => {
      if (action === "back") {
        contents.navigationHistory.goBack();
      } else if (action === "forward") {
        contents.navigationHistory.goForward();
      } else if (action === "reload") {
        contents.reload();
      } else {
        contents.stop();
      }
    },
    navigation: () => ({
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      loading: contents.isLoading(),
    }),
    onKey: (listener) => onBeforeInput(contents, listener),
    onFocus: (listener) => {
      contents.on("focus", listener);
      return () => {
        contents.off("focus", listener);
      };
    },
    onNavigation: (listener) => {
      const changed = () => {
        listener();
      };
      contents.on("did-start-loading", changed);
      contents.on("did-stop-loading", changed);
      contents.on("did-navigate", changed);
      contents.on("did-navigate-in-page", changed);
      return () => {
        contents.off("did-start-loading", changed);
        contents.off("did-stop-loading", changed);
        contents.off("did-navigate", changed);
        contents.off("did-navigate-in-page", changed);
      };
    },
    onFullscreen: (listener) => {
      const entered = () => {
        listener(true);
      };
      const left = () => {
        listener(false);
      };
      contents.on("enter-html-full-screen", entered);
      contents.on("leave-html-full-screen", left);
      return () => {
        contents.off("enter-html-full-screen", entered);
        contents.off("leave-html-full-screen", left);
      };
    },
    onPopOut: (listener) => {
      popOutListeners.add(listener);
      return () => {
        popOutListeners.delete(listener);
      };
    },
    onPopup: (listener) => {
      popupListeners.add(listener);
      return () => {
        popupListeners.delete(listener);
      };
    },
    onOpen: (listener) => {
      openers.add(listener);
      return () => {
        openers.delete(listener);
      };
    },
    setBorderRadius: (radius) => {
      view.setBorderRadius(radius);
    },
    setBounds: (rect) => {
      view.setBounds(rect);
    },
    setZoomFactor: (factor) => {
      contents.setZoomFactor(factor);
    },
    zoomFactor: () => contents.getZoomFactor(),
    audible: () => contents.isCurrentlyAudible(),
    onAudible: (listener) => {
      const changed = () => {
        listener();
      };
      contents.on("audio-state-changed", changed);
      return () => {
        contents.off("audio-state-changed", changed);
      };
    },
  };
  handles.set(port, view);
  ports.set(view, port);
  return port;
};

export const viewFactory: ViewFactoryPort = { create: createView };
