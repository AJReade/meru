/** What Chromium reports of a right-click in a page, the part of Electron's `ContextMenuParams` the menu reads. */
export interface ContextMenuParams {
  /** Where the click landed, in the page's coordinates. */
  readonly x: number;
  readonly y: number;
  /** The page's address, the frame's top-level one. */
  readonly pageUrl: string;
  /** The link under the click; empty when there is none. */
  readonly linkUrl: string;
  readonly linkText: string;
  /** The address of the image, video or audio under the click; empty when there is none, or when Chromium gives none for an image whose data address is too long. */
  readonly srcUrl: string;
  readonly mediaType:
    | "none"
    | "image"
    | "audio"
    | "video"
    | "canvas"
    | "file"
    | "plugin";
  readonly isEditable: boolean;
  readonly selectionText: string;
  /** The word under the click the spellchecker marked; empty when there is none. */
  readonly misspelledWord: string;
  readonly dictionarySuggestions: readonly string[];
  readonly editFlags: {
    readonly canCut: boolean;
    readonly canCopy: boolean;
    readonly canPaste: boolean;
    readonly canSelectAll: boolean;
  };
}

/** What an item does to the page it was opened over. */
export type PageAction =
  | {
      readonly kind: "edit";
      readonly command:
        | "cut"
        | "copy"
        | "paste"
        | "pasteAndMatchStyle"
        | "selectAll";
    }
  | { readonly kind: "replaceMisspelling"; readonly word: string }
  | { readonly kind: "learnSpelling"; readonly word: string }
  | { readonly kind: "lookUp" }
  | { readonly kind: "copyImageAt"; readonly x: number; readonly y: number }
  | { readonly kind: "inspect"; readonly x: number; readonly y: number };

/** What an item does: to the page, or through the app's own routes. */
export type ContextMenuAction =
  | { readonly kind: "page"; readonly action: PageAction }
  | { readonly kind: "copyText"; readonly text: string }
  /** Copies the address as text and as a bookmark named `title`. */
  | {
      readonly kind: "copyBookmark";
      readonly title: string;
      readonly url: string;
    }
  | { readonly kind: "saveImageAs"; readonly url: string }
  | { readonly kind: "openExternal"; readonly url: string };

export type ContextMenuItemId =
  | "suggestion"
  | "noGuessesFound"
  | "learnSpelling"
  | "lookUp"
  | "searchWithGoogle"
  | "cut"
  | "copy"
  | "paste"
  | "pasteAndMatchStyle"
  | "selectAll"
  | "saveImageAs"
  | "copyImage"
  | "copyImageAddress"
  | "copyEmailAddress"
  | "copyLink"
  | "openInDefaultBrowser"
  | "copyMessageLink"
  | "inspectElement";

export type ContextMenuItem =
  | {
      readonly kind: "item";
      readonly id: ContextMenuItemId;
      readonly label: string;
      readonly enabled: boolean;
      /** Absent on an item that only says something, such as No Guesses Found. */
      readonly action?: ContextMenuAction;
    }
  | { readonly kind: "separator" }
  /** macOS's Share submenu, which the system fills for the address. */
  | { readonly kind: "share"; readonly label: string; readonly url: string };

/** An item as the native menu takes it, its action bound. */
export type ContextMenuEntry =
  | {
      readonly kind: "item";
      readonly id: ContextMenuItemId;
      readonly label: string;
      readonly enabled: boolean;
      readonly run: () => void;
    }
  | { readonly kind: "separator" }
  | { readonly kind: "share"; readonly label: string; readonly url: string };
