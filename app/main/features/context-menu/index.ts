import { contextMenuOf } from "../../../core/engines/context-menu.ts";
import type { ContextMenuLabels } from "../../../core/engines/context-menu.ts";
import type { LogPort } from "../../../core/log.ts";
import type {
  ClipboardPort,
  ContextMenuPort,
  Unsubscribe,
} from "../../../core/ports.ts";
import type {
  ContextMenuAction,
  ContextMenuEntry,
  ContextMenuParams,
} from "../../../core/records/context-menu.ts";
import type { Platform } from "../../../core/records/platform.ts";
import { msg } from "../../../shared/msg.ts";
import type { Downloads } from "../downloads/index.ts";
import type { Links } from "../links/index.ts";
import type { ContentPage } from "../stage/tab-views.ts";

// A single & marks the access key on Windows and Linux, which macOS's menus leave out. Read on every menu, so a change of language shows in the next one.
const labels = (): ContextMenuLabels => ({
  copy: msg`&Copy`,
  copyEmailAddress: msg`Copy email address`,
  copyImage: msg`Cop&y image`,
  copyImageAddress: msg`C&opy image address`,
  copyLink: msg`Copy link addr&ess`,
  copyMessageLink: msg`Copy message link`,
  copyUrl: msg`Copy URL`,
  cut: msg`Cu&t`,
  inspectElement: msg`Inspect element`,
  learnSpelling: msg`&Learn spelling`,
  lookUp: (selection) => msg`Look up “${selection}”`,
  noGuessesFound: msg`No guesses found`,
  openInDefaultBrowser: msg`Open in default browser`,
  paste: msg`&Paste`,
  pasteAndMatchStyle: msg`Paste and &match style`,
  saveImageAs: msg`Sa&ve image as…`,
  searchWithGoogle: msg`&Search with Google`,
  selectAll: msg`Select &all`,
  share: msg`Share`,
});

/** What a right-click was on, without its addresses or text, for a log line. */
const shapeOf = (params: ContextMenuParams) => ({
  editable: params.isEditable,
  imageAddress: params.srcUrl !== "",
  link: params.linkUrl !== "",
  mediaType: params.mediaType,
  selection: params.selectionText.length,
  suggestions: params.dictionarySuggestions.length,
});

export interface ContextMenuOptions {
  readonly contextMenu: ContextMenuPort;
  readonly clipboard: ClipboardPort;
  readonly downloads: Pick<Downloads, "saveAs">;
  readonly links: Pick<Links, "openExternal">;
  readonly log: LogPort;
  readonly platform: Platform;
  /** A run from the repository, whose menu offers Inspect element. */
  readonly development: boolean;
  /** The Gmail mailbox's address, under which a page showing a message offers its link. */
  readonly mailbox: string;
}

/** The native menu a right-click opens in a pane's page or a pop-out's, built by `contextMenuOf` and carried out through the clipboard, the downloads, the links and the page itself. */
export class ContextMenu {
  readonly #options: ContextMenuOptions;

  constructor(options: ContextMenuOptions) {
    this.#options = options;
  }

  /** Opens the menu on every right-click in the page `contentsId` until the returned call, offering the page's own address when `offersPage` says. */
  attach(contentsId: number, { offersPage = false } = {}): Unsubscribe {
    return this.#options.contextMenu.listen(contentsId, (params) => {
      // Electron's event has no caller to hand a throw to, so one would end the app as an uncaught exception.
      try {
        this.#show(contentsId, params, offersPage);
      } catch (error) {
        this.#options.log.error("The context menu could not be shown", {
          error,
          params: shapeOf(params),
        });
      }
    });
  }

  /** The page of a tab of `appId`, with the menu attached to its view alongside what the page attaches itself; every app's but Gmail's offers its own address, as 3.x's did. */
  page(content: ContentPage, appId: string): ContentPage {
    const offersPage = appId !== "gmail";
    return {
      ...content,
      attach: (contentsId) => {
        const detach = content.attach(contentsId);
        const detachMenu = this.attach(contentsId, { offersPage });
        return () => {
          detachMenu();
          detach();
        };
      },
    };
  }

  #show(
    contentsId: number,
    params: ContextMenuParams,
    offersPage: boolean
  ): void {
    const { development, mailbox, platform } = this.#options;
    const items = contextMenuOf(params, {
      development,
      labels: labels(),
      mailbox,
      offersPage,
      platform,
    });
    this.#options.contextMenu.popup(
      contentsId,
      items.map((item): ContextMenuEntry => {
        if (item.kind !== "item") {
          return item;
        }
        const { action } = item;
        return {
          enabled: item.enabled,
          id: item.id,
          kind: "item",
          label: item.label,
          run: () => {
            if (action === undefined) {
              return;
            }
            try {
              this.#run(contentsId, action);
            } catch (error) {
              this.#options.log.error("A context menu item failed", {
                error,
                item: item.id,
              });
            }
          },
        };
      })
    );
  }

  #run(contentsId: number, action: ContextMenuAction): void {
    const { clipboard, contextMenu, downloads, links } = this.#options;
    if (action.kind === "page") {
      contextMenu.act(contentsId, action.action);
    } else if (action.kind === "saveImageAs") {
      downloads.saveAs(contentsId, action.url);
    } else if (action.kind === "openExternal") {
      links.openExternal(action.url);
    } else if (action.kind === "copyText") {
      void this.#copy(clipboard.writeText(action.text));
    } else {
      void this.#copy(clipboard.writeBookmark(action.title, action.url));
    }
  }

  // A menu click has nobody to hand a refusal to, so it is written down rather than left unhandled.
  async #copy(write: Promise<void>): Promise<void> {
    try {
      await write;
    } catch (error) {
      this.#options.log.warn("The clipboard refused a copy", { error });
    }
  }
}
