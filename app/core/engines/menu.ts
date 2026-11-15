import type { MenuEntry, MenuSection, MenuSectionId } from "../records/menu.ts";
import type { Platform } from "../records/platform.ts";

type Role = Extract<MenuEntry<never>, { kind: "role" }>["role"];

/** Every role the menu draws but Services and Hide Meru, which keep what macOS gives them: Electron title-cases most of the others. */
export type LabelledRole = Exclude<Role, "services" | "hide">;

const SEPARATOR: MenuEntry<never> = { kind: "separator" };
const SPEECH: MenuEntry<never> = { kind: "speech" };

const role = (labels: MenuLabels, name: LabelledRole): MenuEntry<never> => ({
  kind: "role",
  label: labels[name],
  role: name,
});

const editRoles = (
  labels: MenuLabels,
  mac: boolean
): readonly MenuEntry<never>[] => [
  role(labels, "undo"),
  role(labels, "redo"),
  SEPARATOR,
  role(labels, "cut"),
  role(labels, "copy"),
  role(labels, "paste"),
  role(labels, "pasteAndMatchStyle"),
  role(labels, "delete"),
  role(labels, "selectAll"),
  ...(mac ? [SEPARATOR, SPEECH] : []),
];

const macAppRoles = (labels: MenuLabels): readonly MenuEntry<never>[] => [
  { kind: "role", role: "services" },
  SEPARATOR,
  { kind: "role", role: "hide" },
  role(labels, "hideOthers"),
  role(labels, "unhide"),
  SEPARATOR,
];

const checkOf = (checked: boolean | undefined) =>
  checked === undefined ? {} : { checked };

interface MenuCommand<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly menu?: { readonly section: MenuSectionId; readonly order: number };
}

/** The titles of the submenus the app names itself and the labels of the roles it relabels, in the user's language and the platform's words. */
export type MenuLabels = Readonly<
  Record<Exclude<MenuSectionId, "app"> | LabelledRole, string>
>;

interface MenuOptions<Id extends string> {
  readonly platform: Platform;
  readonly commands: readonly MenuCommand<Id>[];
  readonly bindings: ReadonlyMap<Id, string | null>;
  readonly labels: MenuLabels;
  /** Whether a command can run now; the menu shows one that cannot disabled. */
  readonly enabled: (id: Id) => boolean;
  /** Whether a toggle command is on now; undefined for a command that is no toggle. */
  readonly checked?: (id: Id) => boolean | undefined;
  readonly run: (id: Id, windowId: number) => void;
}

/** The application menu: the app-named menu first on every platform, as 3.x has it, with macOS's own roles only there, then each section's commands in order, with the resolved shortcuts. */
export const buildMenu = <Id extends string>({
  platform,
  commands,
  bindings,
  labels,
  enabled,
  checked,
  run,
}: MenuOptions<Id>): MenuSection<Id>[] => {
  const actions = (section: MenuSectionId): MenuEntry<Id>[] =>
    commands
      .flatMap((command) =>
        command.menu?.section === section
          ? [{ command, order: command.menu.order }]
          : []
      )
      .toSorted((a, b) => a.order - b.order)
      .map(({ command }) => ({
        accelerator: bindings.get(command.id) ?? undefined,
        ...checkOf(checked?.(command.id)),
        enabled: enabled(command.id),
        id: command.id,
        kind: "action",
        label: command.label,
        run: (windowId) => {
          // Nothing to act on before a window opens or after the last one closed.
          if (windowId !== undefined) {
            run(command.id, windowId);
          }
        },
      }));
  const submenu = (
    section: Exclude<MenuSectionId, "app">,
    entries: readonly MenuEntry<Id>[] = actions(section)
  ): MenuSection<Id>[] =>
    entries.length === 0
      ? []
      : [{ entries, kind: "submenu", label: labels[section] }];
  const edit = actions("edit");
  const file = actions("file");
  const mac = platform === "darwin";
  return [
    {
      entries: [
        role(labels, "about"),
        SEPARATOR,
        ...actions("app"),
        SEPARATOR,
        ...(mac ? macAppRoles(labels) : []),
        role(labels, "quit"),
      ],
      kind: "app",
    },
    ...submenu(
      "file",
      file.length === 0
        ? []
        : [
            ...file,
            SEPARATOR,
            role(labels, "close"),
            ...(mac ? [] : [role(labels, "minimize")]),
          ]
    ),
    {
      entries: [
        ...editRoles(labels, mac),
        ...(edit.length === 0 ? [] : [SEPARATOR, ...edit]),
      ],
      kind: "submenu",
      label: labels.edit,
    },
    { entries: actions("view"), kind: "submenu", label: labels.view },
    ...submenu("history"),
    ...submenu("profiles"),
  ];
};
