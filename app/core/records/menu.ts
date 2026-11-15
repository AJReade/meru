/** Where a command sits in the application menu; `app` is the app menu on macOS and the Help menu elsewhere. */
export type MenuSectionId =
  | "app"
  | "file"
  | "edit"
  | "view"
  | "history"
  | "profiles";

export interface MenuAction<Id extends string> {
  readonly kind: "action";
  readonly id: Id;
  readonly label: string;
  readonly accelerator: string | undefined;
  readonly enabled: boolean;
  /** Whether the item shows a check mark; absent for an item that is no toggle. */
  readonly checked?: boolean;
  readonly run: (windowId: number | undefined) => void;
}

export type MenuEntry<Id extends string> =
  | MenuAction<Id>
  | { readonly kind: "separator" }
  /** macOS's Speech submenu, as Electron's Edit menu role draws it. */
  | { readonly kind: "speech" }
  | {
      readonly kind: "role";
      /** Absent to keep the label Electron gives the role. */
      readonly label?: string;
      readonly role:
        | "undo"
        | "redo"
        | "cut"
        | "copy"
        | "paste"
        | "pasteAndMatchStyle"
        | "delete"
        | "selectAll"
        | "about"
        | "close"
        | "minimize"
        | "services"
        | "hide"
        | "hideOthers"
        | "unhide"
        | "quit";
    };

export type MenuSection<Id extends string> =
  | {
      readonly kind: "submenu";
      readonly label: string;
      readonly entries: readonly MenuEntry<Id>[];
    }
  /** The menu named after the app, which macOS shows first in bold. */
  | { readonly kind: "app"; readonly entries: readonly MenuEntry<Id>[] };
