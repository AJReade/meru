import type {
  ContextMenuItem,
  EditCommand,
  ContextMenuParams,
} from "../records/context-menu.ts";
import type { Platform } from "../records/platform.ts";
import { messageUrl } from "./notifications.ts";

export interface ContextMenuLabels {
  readonly noGuessesFound: string;
  readonly learnSpelling: string;
  /** Names the selection, already cut short and with its ampersands escaped. */
  readonly lookUp: (selection: string) => string;
  readonly searchWithGoogle: string;
  readonly cut: string;
  readonly copy: string;
  readonly paste: string;
  readonly pasteAndMatchStyle: string;
  readonly selectAll: string;
  readonly saveImageAs: string;
  readonly copyImage: string;
  readonly copyImageAddress: string;
  readonly copyEmailAddress: string;
  readonly copyLink: string;
  readonly openInDefaultBrowser: string;
  readonly copyMessageLink: string;
  readonly copyUrl: string;
  readonly share: string;
  readonly inspectElement: string;
}

export interface ContextMenuContext {
  readonly platform: Platform;
  /** A run from the repository, which offers Inspect Element. */
  readonly development: boolean;
  /** The Gmail mailbox's address, whose origin a page showing a message must share to offer its link. */
  readonly mailbox: string;
  /** Whether the menu offers the page's own address, which every pane but Gmail's does. */
  readonly offersPage: boolean;
  readonly labels: ContextMenuLabels;
}

/** The most graphemes of a selection Look Up names before cutting it short, as Safari does. */
export const LOOK_UP_GRAPHEMES = 25;

const MAILTO = "mailto:";

const WEB_ADDRESS = /^https?:/iu;

// Chromium downloads an image from a page's data and blob addresses as it does from the web; it gives none at all for a data address over about 2 MB, and any other scheme, such as javascript:, is nothing to save. Copy Image Address takes only a web address, since a blob address means nothing outside the page that made it and a data address is the image itself, up to megabytes of text.
const SAVEABLE_IMAGE = /^(?:https?|data|blob):/iu;

// The space a selection is trimmed of, with the zero-width characters a page leaves around words, which show nothing to look up or search.
const SPACE = /^[\s\u200B-\u200D\uFEFF]+|[\s\u200B-\u200D\uFEFF]+$/gu;

const trimmed = (text: string): string => text.replaceAll(SPACE, "");

// Gmail's message ids are hex or, in newer links, longer base-62 strings; a label or a search is never this long without a slash.
const MESSAGE_ID = /^[A-Za-z0-9]{15,}$/u;

// These views put a query between the view and the message: #search/<query>/<id>, #label/<name>/<id>.
const QUERY_VIEWS = new Set([
  "search",
  "advanced-search",
  "label",
  "category",
  "section_query",
  "circle",
]);

/** The selection as Look Up names it: trimmed of space and zero-width characters, cut to `LOOK_UP_GRAPHEMES` with an ellipsis, so an emoji sequence or a combined character is never split, and its ampersands doubled, since a single one marks an access key. */
export const lookUpName = (selection: string): string => {
  const graphemes: string[] = [];
  const segments = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(trimmed(selection));
  // Stops one past the limit, since the selection can be a whole page.
  for (const { segment } of segments) {
    graphemes.push(segment);
    if (graphemes.length > LOOK_UP_GRAPHEMES) {
      graphemes.splice(LOOK_UP_GRAPHEMES - 1, graphemes.length, "…");
      break;
    }
  }
  return graphemes.join("").replaceAll("&", "&&");
};

// A Gmail page's address: its origin, the account's slot under it, any query, then the view in the fragment.
const GMAIL_PAGE =
  /^(?<origin>[a-z][a-z0-9+.-]*:\/\/[^/?#]+)(?<slot>\/mail\/u\/\d+)\/?(?:\?[^#]*)?#(?<fragment>.*)$/iu;

const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/iu;

/** The id of the message a view shows, from a fragment such as `inbox/<id>` or `search/<query>/<id>`; null for a list or anything else. */
const messageIdOf = (fragment: string): string | null => {
  const [path = ""] = fragment.split("?");
  const segments = path.split("/");
  const [view = ""] = segments;
  const at = QUERY_VIEWS.has(view) ? 2 : 1;
  const id = segments[at];
  return segments.length === at + 1 && id !== undefined && MESSAGE_ID.test(id)
    ? id
    : null;
};

/** The address of the message a Gmail page shows, under the page's own origin and account slot, such as `/mail/u/1/`, whatever its query; null for a page off the mailbox's origin or showing no message. */
export const messageLinkOf = (
  pageUrl: string,
  mailbox: string
): string | null => {
  const page = GMAIL_PAGE.exec(pageUrl)?.groups;
  const origin = ORIGIN.exec(mailbox)?.[0];
  if (
    page?.origin === undefined ||
    origin === undefined ||
    page.origin.toLowerCase() !== origin.toLowerCase()
  ) {
    return null;
  }
  const id = messageIdOf(page.fragment ?? "");
  return id === null
    ? null
    : messageUrl(`${page.origin}${page.slot ?? ""}`, id);
};

const TO = /^to=/iu;

/** The address a mailto link writes to, without its scheme, query, fragment or escapes, taken from its `to` field when the link names none before its query, such as `mailto:?to=…`; as it is when it cannot be decoded, and null when there is none. */
export const emailAddressOf = (link: string): string | null => {
  const [body = ""] = link.slice(MAILTO.length).split("#");
  const queryAt = body.indexOf("?");
  const path = queryAt === -1 ? body : body.slice(0, queryAt);
  const to =
    queryAt === -1
      ? undefined
      : body
          .slice(queryAt + 1)
          .split("&")
          .find((field) => TO.test(field));
  const address = path === "" ? (to?.slice("to=".length) ?? "") : path;
  let decoded = address;
  try {
    decoded = decodeURIComponent(address);
  } catch {
    // An address that is not valid UTF-8 escaped is copied as the page wrote it.
  }
  return decoded.trim() === "" ? null : decoded.trim();
};

/** The most graphemes of a selection Search with Google sends, as many as Google reads of a query. */
export const SEARCH_QUERY_LIMIT = 500;

const SEARCH = "https://www.google.com/search?q=";

// Windows' `shell.openExternal` refuses an address past 2081 characters, which a few hundred characters outside ASCII reach once escaped.
const OPEN_EXTERNAL_LIMIT = 2081;

// Core compiles without the DOM's or Node's URL types, so the query is escaped by hand; it is cut by whole graphemes, so a surrogate pair or an emoji sequence is never split, and a lone surrogate, which `encodeURIComponent` throws on, is searched as U+FFFD, as Chromium itself reports one.
const googleSearch = (text: string): string => {
  let query = "";
  let count = 0;
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(text.toWellFormed())) {
    const escaped = encodeURIComponent(segment);
    if (
      count === SEARCH_QUERY_LIMIT ||
      SEARCH.length + query.length + escaped.length > OPEN_EXTERNAL_LIMIT
    ) {
      break;
    }
    query += escaped;
    count += 1;
  }
  return `${SEARCH}${query}`;
};

type Section = readonly ContextMenuItem[];

/** A suggestion for each guess the spellchecker has, which only an editable field can take, or No Guesses Found. */
const spelling = (
  params: ContextMenuParams,
  labels: ContextMenuLabels
): Section => {
  const { dictionarySuggestions, isEditable, misspelledWord, selectionText } =
    params;
  if (selectionText === "" || misspelledWord === "") {
    return [];
  }
  if (dictionarySuggestions.length === 0) {
    return [
      {
        enabled: false,
        id: "noGuessesFound",
        kind: "item",
        label: labels.noGuessesFound,
      },
    ];
  }
  return (isEditable ? dictionarySuggestions : []).map((word) => ({
    action: { action: { kind: "replaceMisspelling", word }, kind: "page" },
    enabled: true,
    id: "suggestion",
    kind: "item",
    label: word,
  }));
};

const learnSpelling = (
  params: ContextMenuParams,
  labels: ContextMenuLabels
): Section =>
  params.isEditable &&
  params.selectionText !== "" &&
  params.misspelledWord !== ""
    ? [
        {
          action: {
            action: { kind: "learnSpelling", word: params.misspelledWord },
            kind: "page",
          },
          enabled: true,
          id: "learnSpelling",
          kind: "item",
          label: labels.learnSpelling,
        },
      ]
    : [];

const lookUp = (
  params: ContextMenuParams,
  { labels, platform }: ContextMenuContext
): Section =>
  platform === "darwin" &&
  trimmed(params.selectionText) !== "" &&
  params.linkUrl === ""
    ? [
        {
          action: { action: { kind: "lookUp" }, kind: "page" },
          enabled: true,
          id: "lookUp",
          kind: "item",
          label: labels.lookUp(lookUpName(params.selectionText)),
        },
      ]
    : [];

const search = (
  params: ContextMenuParams,
  labels: ContextMenuLabels
): Section => {
  const text = trimmed(params.selectionText);
  return text === ""
    ? []
    : [
        {
          action: { kind: "openExternal", url: googleSearch(text) },
          enabled: true,
          id: "searchWithGoogle",
          kind: "item",
          label: labels.searchWithGoogle,
        },
      ];
};

const edit = (
  params: ContextMenuParams,
  { labels, platform }: ContextMenuContext
): Section => {
  const { editFlags, isEditable, selectionText } = params;
  const hasText = selectionText !== "";
  const item = (id: EditCommand, enabled: boolean): ContextMenuItem => ({
    action: { action: { command: id, kind: "edit" }, kind: "page" },
    enabled,
    id,
    kind: "item",
    label: labels[id],
  });
  return [
    ...(isEditable ? [item("cut", editFlags.canCut && hasText)] : []),
    ...(isEditable || hasText
      ? [item("copy", editFlags.canCopy && hasText)]
      : []),
    ...(isEditable
      ? [
          item("paste", editFlags.canPaste),
          item("pasteAndMatchStyle", editFlags.canPaste),
        ]
      : []),
    // macOS's own menus leave Select All out of a page's context menu.
    ...(platform === "darwin"
      ? []
      : [item("selectAll", editFlags.canSelectAll)]),
  ];
};

const imageAndEmail = (
  params: ContextMenuParams,
  labels: ContextMenuLabels
): Section => {
  const { linkUrl, mediaType, srcUrl, x, y } = params;
  const email = linkUrl.toLowerCase().startsWith(MAILTO)
    ? emailAddressOf(linkUrl)
    : null;
  return [
    ...(mediaType === "image"
      ? ([
          {
            action: { kind: "saveImageAs", url: srcUrl },
            enabled: SAVEABLE_IMAGE.test(srcUrl),
            id: "saveImageAs",
            kind: "item",
            label: labels.saveImageAs,
          },
          {
            action: { action: { kind: "copyImageAt", x, y }, kind: "page" },
            enabled: true,
            id: "copyImage",
            kind: "item",
            label: labels.copyImage,
          },
          {
            action: { kind: "copyBookmark", title: srcUrl, url: srcUrl },
            enabled: WEB_ADDRESS.test(srcUrl),
            id: "copyImageAddress",
            kind: "item",
            label: labels.copyImageAddress,
          },
        ] satisfies Section)
      : []),
    ...(email === null
      ? []
      : ([
          {
            action: { kind: "copyText", text: email },
            enabled: true,
            id: "copyEmailAddress",
            kind: "item",
            label: labels.copyEmailAddress,
          },
        ] satisfies Section)),
  ];
};

const link = (
  params: ContextMenuParams,
  labels: ContextMenuLabels
): Section => {
  const { linkText, linkUrl, mediaType } = params;
  if (linkUrl === "") {
    return [];
  }
  return [
    ...(mediaType === "none"
      ? ([
          {
            action: { kind: "copyBookmark", title: linkText, url: linkUrl },
            enabled: true,
            id: "copyLink",
            kind: "item",
            label: labels.copyLink,
          },
        ] satisfies Section)
      : []),
    ...(WEB_ADDRESS.test(linkUrl)
      ? ([
          {
            action: { kind: "openExternal", url: linkUrl },
            enabled: true,
            id: "openInDefaultBrowser",
            kind: "item",
            label: labels.openInDefaultBrowser,
          },
        ] satisfies Section)
      : []),
  ];
};

const message = (
  params: ContextMenuParams,
  { labels, mailbox, platform }: ContextMenuContext
): Section => {
  const url = messageLinkOf(params.pageUrl, mailbox);
  if (url === null) {
    return [];
  }
  return [
    {
      action: { kind: "copyText", text: url },
      enabled: true,
      id: "copyMessageLink",
      kind: "item",
      label: labels.copyMessageLink,
    },
    // The Share menu is a macOS role, which takes no click, so elsewhere it would do nothing.
    ...(platform === "darwin"
      ? ([{ kind: "share", label: labels.share, url }] satisfies Section)
      : []),
  ];
};

const page = (
  params: ContextMenuParams,
  { labels, offersPage }: ContextMenuContext
): Section => {
  const { pageUrl } = params;
  if (!offersPage || pageUrl === "") {
    return [];
  }
  return [
    {
      action: { kind: "copyText", text: pageUrl },
      enabled: true,
      id: "copyUrl",
      kind: "item",
      label: labels.copyUrl,
    },
    ...(WEB_ADDRESS.test(pageUrl)
      ? ([
          {
            action: { kind: "openExternal", url: pageUrl },
            enabled: true,
            id: "openPageInDefaultBrowser",
            kind: "item",
            label: labels.openInDefaultBrowser,
          },
        ] satisfies Section)
      : []),
  ];
};

const inspect = (
  params: ContextMenuParams,
  { development, labels }: ContextMenuContext
): Section =>
  development
    ? [
        {
          action: {
            action: { kind: "inspect", x: params.x, y: params.y },
            kind: "page",
          },
          enabled: true,
          id: "inspectElement",
          kind: "item",
          label: labels.inspectElement,
        },
      ]
    : [];

/** The items of the menu a right-click in a pane's page opens, in 3.x's order, its sections apart by a separator. */
export const contextMenuOf = (
  params: ContextMenuParams,
  context: ContextMenuContext
): readonly ContextMenuItem[] => {
  const { labels } = context;
  const sections: readonly Section[] = [
    spelling(params, labels),
    learnSpelling(params, labels),
    lookUp(params, context),
    search(params, labels),
    edit(params, context),
    imageAndEmail(params, labels),
    link(params, labels),
    message(params, context),
    page(params, context),
    inspect(params, context),
  ];
  return sections
    .filter((section) => section.length > 0)
    .flatMap((section, index) =>
      index === 0 ? section : [{ kind: "separator" } as const, ...section]
    );
};
