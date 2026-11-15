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

// A single & marks the access key on Windows and Linux, which macOS's menus leave out.
const LABELS: ContextMenuLabels = {
  copy: msg`&Copy`,
  copyEmailAddress: msg`Copy Email Address`,
  copyImage: msg`Cop&y Image`,
  copyImageAddress: msg`C&opy Image Address`,
  copyLink: msg`Copy Link Addr&ess`,
  copyMessageLink: msg`Copy Message Link`,
  cut: msg`Cu&t`,
  inspectElement: msg`Inspect Element`,
  learnSpelling: msg`&Learn Spelling`,
  lookUp: (selection) => msg`Look Up “${selection}”`,
  noGuessesFound: msg`No Guesses Found`,
  openInDefaultBrowser: msg`Open in Default Browser`,
  paste: msg`&Paste`,
  pasteAndMatchStyle: msg`Paste and &Match Style`,
  saveImageAs: msg`Sa&ve Image As…`,
  searchWithGoogle: msg`&Search with Google`,
  selectAll: msg`Select &All`,
  share: msg`Share`,
};

export interface ContextMenuOptions {
  readonly contextMenu: ContextMenuPort;
  readonly clipboard: ClipboardPort;
  readonly downloads: Pick<Downloads, "saveAs">;
  readonly links: Pick<Links, "openExternal">;
  readonly log: LogPort;
  readonly platform: Platform;
  /** A run from the repository, whose menu offers Inspect Element. */
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

  /** Opens the menu on every right-click in the page `contentsId` until the returned call. */
  attach(contentsId: number): Unsubscribe {
    return this.#options.contextMenu.listen(contentsId, (params) => {
      this.#show(contentsId, params);
    });
  }

  /** The tab's page, with the menu attached to its view alongside what the page attaches itself. */
  page(content: ContentPage): ContentPage {
    return {
      ...content,
      attach: (contentsId) => {
        const detach = content.attach(contentsId);
        const detachMenu = this.attach(contentsId);
        return () => {
          detachMenu();
          detach();
        };
      },
    };
  }

  #show(contentsId: number, params: ContextMenuParams): void {
    const { development, mailbox, platform } = this.#options;
    const items = contextMenuOf(params, {
      development,
      labels: LABELS,
      mailbox,
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
            if (action !== undefined) {
              this.#run(contentsId, action);
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
