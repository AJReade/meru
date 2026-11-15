import { describe, expect, it } from "vitest";

import type {
  ContextMenuItem,
  ContextMenuParams,
} from "../records/context-menu.ts";
import type { Platform } from "../records/platform.ts";
import {
  SEARCH_QUERY_LIMIT,
  contextMenuOf,
  emailAddressOf,
  lookUpName,
  messageLinkOf,
} from "./context-menu.ts";
import type { ContextMenuLabels } from "./context-menu.ts";

const LABELS: ContextMenuLabels = {
  copy: "Copy",
  copyEmailAddress: "Copy Email Address",
  copyImage: "Copy Image",
  copyImageAddress: "Copy Image Address",
  copyLink: "Copy Link Address",
  copyMessageLink: "Copy Message Link",
  copyUrl: "Copy URL",
  cut: "Cut",
  inspectElement: "Inspect Element",
  learnSpelling: "Learn Spelling",
  lookUp: (selection) => `Look Up “${selection}”`,
  noGuessesFound: "No Guesses Found",
  openInDefaultBrowser: "Open in Default Browser",
  paste: "Paste",
  pasteAndMatchStyle: "Paste and Match Style",
  saveImageAs: "Save Image As…",
  searchWithGoogle: "Search with Google",
  selectAll: "Select All",
  share: "Share",
};

const MAILBOX = "https://mail.google.com/mail/u/0";
const MESSAGE = "FMfcgzQbfLZkzXqGvNbdgmRkhHPCWvLb";

const NOTHING: ContextMenuParams = {
  dictionarySuggestions: [],
  editFlags: {
    canCopy: true,
    canCut: true,
    canPaste: true,
    canSelectAll: true,
  },
  isEditable: false,
  linkText: "",
  linkUrl: "",
  mediaType: "none",
  misspelledWord: "",
  pageUrl: "https://docs.google.com/document/d/1",
  selectionText: "",
  srcUrl: "",
  x: 10,
  y: 20,
};

const menu = (
  params: Partial<ContextMenuParams>,
  options: {
    platform?: Platform;
    development?: boolean;
    offersPage?: boolean;
  } = {}
) =>
  contextMenuOf(
    { ...NOTHING, ...params },
    {
      development: options.development ?? false,
      labels: LABELS,
      mailbox: MAILBOX,
      offersPage: options.offersPage ?? false,
      platform: options.platform ?? "linux",
    }
  );

/** Each item as its id, `-` for a separator and `share` for the Share menu, with `(off)` after a disabled one. */
const layout = (items: readonly ContextMenuItem[]) =>
  items.map((item) => {
    if (item.kind === "separator") {
      return "-";
    }
    if (item.kind === "share") {
      return `share ${item.url}`;
    }
    return item.enabled ? item.id : `${item.id} (off)`;
  });

const itemOf = (items: readonly ContextMenuItem[], id: string) =>
  items.find((item) => item.kind === "item" && item.id === id);

const LINK = { linkText: "Example", linkUrl: "https://example.com/" };
const IMAGE = {
  mediaType: "image",
  srcUrl: "https://example.com/a.png",
} as const;
const MISSPELLED = {
  isEditable: true,
  misspelledWord: "Mreu",
  selectionText: "Mreu",
};

/** The address Search with Google opens for the selection, or null when it is not offered. */
const searchOf = (selectionText: string) => {
  const item = itemOf(menu({ selectionText }), "searchWithGoogle");
  return item?.kind === "item" && item.action?.kind === "openExternal"
    ? item.action.url
    : null;
};

describe(contextMenuOf, () => {
  it("offers only Select All on a page with nothing under the click, outside macOS, and nothing on macOS", () => {
    expect([
      layout(menu({})),
      layout(menu({}, { platform: "win32" })),
      layout(menu({}, { platform: "darwin" })),
    ]).toStrictEqual([["selectAll"], ["selectAll"], []]);
  });

  it("enables Select All as the page's edit flags say", () => {
    expect(
      layout(menu({ editFlags: { ...NOTHING.editFlags, canSelectAll: false } }))
    ).toStrictEqual(["selectAll (off)"]);
  });

  it("offers Look Up on macOS, Search with Google and Copy for selected text", () => {
    expect(
      layout(menu({ selectionText: "Meru" }, { platform: "darwin" }))
    ).toStrictEqual(["lookUp", "-", "searchWithGoogle", "-", "copy"]);
  });

  it("leaves Look Up out on a link and off macOS", () => {
    expect([
      layout(
        menu({ ...LINK, selectionText: "Example" }, { platform: "darwin" })
      ),
      layout(menu({ selectionText: "Meru" })),
    ]).toStrictEqual([
      [
        "searchWithGoogle",
        "-",
        "copy",
        "-",
        "copyLink",
        "openInDefaultBrowser",
      ],
      ["searchWithGoogle", "-", "copy", "selectAll"],
    ]);
  });

  it("disables Copy when the page cannot copy the selection", () => {
    expect(
      layout(
        menu({
          editFlags: { ...NOTHING.editFlags, canCopy: false },
          selectionText: "Meru",
        })
      )
    ).toStrictEqual(["searchWithGoogle", "-", "copy (off)", "selectAll"]);
  });

  it("searches Google for the selection without the space around it", () => {
    expect(
      itemOf(menu({ selectionText: "  Fish & Chips\n" }), "searchWithGoogle")
    ).toMatchObject({
      action: {
        kind: "openExternal",
        url: "https://www.google.com/search?q=Fish%20%26%20Chips",
      },
    });
  });

  it("searches Google for at most SEARCH_QUERY_LIMIT graphemes of the selection, in an address Windows will open, never splitting one", () => {
    const search = "https://www.google.com/search?q=";
    const emoji = encodeURIComponent("😀");
    const long = searchOf("é".repeat(1000)) ?? "";
    expect([
      searchOf("a".repeat(10_000)),
      searchOf(`${"a".repeat(SEARCH_QUERY_LIMIT - 1)}😀b`),
      long.length <= 2081 && long.length > 2070,
      long.endsWith(encodeURIComponent("é")),
    ]).toStrictEqual([
      `${search}${"a".repeat(SEARCH_QUERY_LIMIT)}`,
      `${search}${"a".repeat(SEARCH_QUERY_LIMIT - 1)}${emoji}`,
      true,
      true,
    ]);
  });

  it("offers neither Look Up nor Search with Google for a selection of only space", () => {
    expect(
      layout(menu({ selectionText: " \n" }, { platform: "darwin" }))
    ).toStrictEqual(["copy"]);
  });

  it("offers every edit item in a text field, each enabled as the page says, Cut and Copy only with a selection", () => {
    expect([
      layout(menu({ isEditable: true, selectionText: "Meru" })),
      layout(menu({ isEditable: true })),
      layout(
        menu({
          editFlags: {
            canCopy: false,
            canCut: false,
            canPaste: false,
            canSelectAll: false,
          },
          isEditable: true,
          selectionText: "Meru",
        })
      ),
    ]).toStrictEqual([
      [
        "searchWithGoogle",
        "-",
        "cut",
        "copy",
        "paste",
        "pasteAndMatchStyle",
        "selectAll",
      ],
      ["cut (off)", "copy (off)", "paste", "pasteAndMatchStyle", "selectAll"],
      [
        "searchWithGoogle",
        "-",
        "cut (off)",
        "copy (off)",
        "paste (off)",
        "pasteAndMatchStyle (off)",
        "selectAll (off)",
      ],
    ]);
  });

  it("runs each edit item on the page", () => {
    expect(itemOf(menu({ isEditable: true }), "paste")).toMatchObject({
      action: { action: { command: "paste", kind: "edit" }, kind: "page" },
    });
  });

  it("puts the spelling suggestions first, each replacing the word, then Learn Spelling", () => {
    const items = menu(
      { ...MISSPELLED, dictionarySuggestions: ["Meru", "Menu"] },
      { platform: "darwin" }
    );
    expect([
      layout(items).slice(0, 4),
      items[0],
      itemOf(items, "learnSpelling"),
    ]).toMatchObject([
      ["suggestion", "suggestion", "-", "learnSpelling"],
      {
        action: {
          action: { kind: "replaceMisspelling", word: "Meru" },
          kind: "page",
        },
        label: "Meru",
      },
      { action: { action: { kind: "learnSpelling", word: "Mreu" } } },
    ]);
  });

  it("says No Guesses Found, disabled, when the spellchecker has none", () => {
    expect(layout(menu(MISSPELLED)).slice(0, 3)).toStrictEqual([
      "noGuessesFound (off)",
      "-",
      "learnSpelling",
    ]);
  });

  it("offers no suggestion or Learn Spelling outside a text field, but still says there is no guess", () => {
    const outside = { ...MISSPELLED, isEditable: false };
    expect([
      layout(menu({ ...outside, dictionarySuggestions: ["Meru"] })),
      layout(menu(outside)),
    ]).toStrictEqual([
      ["searchWithGoogle", "-", "copy", "selectAll"],
      [
        "noGuessesFound (off)",
        "-",
        "searchWithGoogle",
        "-",
        "copy",
        "selectAll",
      ],
    ]);
  });

  it("offers no spelling items for a misspelled word nothing is selected on", () => {
    expect(
      layout(
        menu({
          dictionarySuggestions: ["Meru"],
          isEditable: true,
          misspelledWord: "Mreu",
        })
      )
    ).toStrictEqual([
      "cut (off)",
      "copy (off)",
      "paste",
      "pasteAndMatchStyle",
      "selectAll",
    ]);
  });

  it("offers Save Image As, Copy Image and Copy Image Address for an image", () => {
    const items = menu(IMAGE);
    expect([
      layout(items),
      itemOf(items, "saveImageAs"),
      itemOf(items, "copyImage"),
      itemOf(items, "copyImageAddress"),
    ]).toMatchObject([
      ["selectAll", "-", "saveImageAs", "copyImage", "copyImageAddress"],
      { action: { kind: "saveImageAs", url: IMAGE.srcUrl } },
      { action: { action: { kind: "copyImageAt", x: 10, y: 20 } } },
      {
        action: {
          kind: "copyBookmark",
          title: IMAGE.srcUrl,
          url: IMAGE.srcUrl,
        },
      },
    ]);
  });

  it("disables saving or copying the address of an image Chromium gave no address for", () => {
    expect(layout(menu({ mediaType: "image", srcUrl: "" }))).toStrictEqual([
      "selectAll",
      "-",
      "saveImageAs (off)",
      "copyImage",
      "copyImageAddress (off)",
    ]);
  });

  it("offers nothing of an image for a video", () => {
    expect(
      layout(menu({ mediaType: "video", srcUrl: "https://example.com/a.mp4" }))
    ).toStrictEqual(["selectAll"]);
  });

  it("offers Copy Link Address and Open in Default Browser for a link", () => {
    const items = menu(LINK);
    expect([
      layout(items),
      itemOf(items, "copyLink"),
      itemOf(items, "openInDefaultBrowser"),
    ]).toMatchObject([
      ["selectAll", "-", "copyLink", "openInDefaultBrowser"],
      {
        action: { kind: "copyBookmark", title: "Example", url: LINK.linkUrl },
      },
      { action: { kind: "openExternal", url: LINK.linkUrl } },
    ]);
  });

  it("opens a linked image's link in the browser, without copying it as a link", () => {
    expect(layout(menu({ ...IMAGE, linkUrl: LINK.linkUrl }))).toStrictEqual([
      "selectAll",
      "-",
      "saveImageAs",
      "copyImage",
      "copyImageAddress",
      "-",
      "openInDefaultBrowser",
    ]);
  });

  it("offers Copy Email Address for a mailto link, and no browser for it", () => {
    const items = menu({
      linkText: "someone",
      linkUrl: "mailto:some%20one@example.com?subject=Hi",
    });
    expect([layout(items), itemOf(items, "copyEmailAddress")]).toMatchObject([
      ["selectAll", "-", "copyEmailAddress", "-", "copyLink"],
      { action: { kind: "copyText", text: "some one@example.com" } },
    ]);
  });

  it("leaves Open in Default Browser out for a link the browser does not take", () => {
    expect(
      layout(menu({ linkUrl: "blob:https://example.com/1" }))
    ).toStrictEqual(["selectAll", "-", "copyLink"]);
  });

  it("offers no Copy Message Link on a page off the mailbox", () => {
    expect(
      layout(menu({ pageUrl: `https://example.com/#inbox/${MESSAGE}` }))
    ).toStrictEqual(["selectAll"]);
  });

  it("offers Copy Message Link on a Gmail page showing a message, with Share on macOS", () => {
    const pageUrl = `${MAILBOX}/#inbox/${MESSAGE}`;
    const link = `${MAILBOX}/#inbox/${MESSAGE}`;
    const items = menu({ pageUrl }, { platform: "darwin" });
    expect([
      layout(items),
      itemOf(items, "copyMessageLink"),
      layout(menu({ pageUrl })),
    ]).toMatchObject([
      ["copyMessageLink", `share ${link}`],
      { action: { kind: "copyText", text: link } },
      ["selectAll", "-", "copyMessageLink"],
    ]);
  });

  it("offers Copy URL and Open in Default Browser for the page's own address where asked, after a message's link", () => {
    const pageUrl = "https://calendar.google.com/calendar/u/0/r";
    const items = menu({ pageUrl }, { offersPage: true });
    expect([
      layout(items),
      itemOf(items, "copyUrl"),
      itemOf(items, "openPageInDefaultBrowser"),
      layout(menu({ pageUrl })),
      layout(menu({ pageUrl: "about:blank" }, { offersPage: true })),
      layout(
        menu(
          { pageUrl: `${MAILBOX}/#inbox/${MESSAGE}` },
          { development: true, offersPage: true }
        )
      ),
    ]).toMatchObject([
      ["selectAll", "-", "copyUrl", "openPageInDefaultBrowser"],
      {
        action: { kind: "copyText", text: pageUrl },
        label: "Copy URL",
      },
      {
        action: { kind: "openExternal", url: pageUrl },
        label: "Open in Default Browser",
      },
      ["selectAll"],
      ["selectAll", "-", "copyUrl"],
      [
        "selectAll",
        "-",
        "copyMessageLink",
        "-",
        "copyUrl",
        "openPageInDefaultBrowser",
        "-",
        "inspectElement",
      ],
    ]);
  });

  it("offers Inspect Element last, only in a run from the repository", () => {
    const items = menu(LINK, { development: true });
    expect([layout(items).at(-1), items.at(-1)]).toMatchObject([
      "inspectElement",
      { action: { action: { kind: "inspect", x: 10, y: 20 } } },
    ]);
  });

  it("orders every section as 3.x does when everything is under the click", () => {
    expect(
      layout(
        menu(
          {
            ...MISSPELLED,
            ...IMAGE,
            dictionarySuggestions: ["Meru"],
            linkUrl: "mailto:someone@example.com",
            pageUrl: `${MAILBOX}/#inbox/${MESSAGE}`,
          },
          { development: true, platform: "darwin" }
        )
      )
    ).toStrictEqual([
      "suggestion",
      "-",
      "learnSpelling",
      "-",
      "searchWithGoogle",
      "-",
      "cut",
      "copy",
      "paste",
      "pasteAndMatchStyle",
      "-",
      "saveImageAs",
      "copyImage",
      "copyImageAddress",
      "copyEmailAddress",
      "-",
      "copyMessageLink",
      `share ${MAILBOX}/#inbox/${MESSAGE}`,
      "-",
      "inspectElement",
    ]);
  });
});

describe(lookUpName, () => {
  it("names the selection trimmed, with its ampersands doubled for the menu", () => {
    expect(lookUpName("  Fish & Chips\n")).toBe("Fish && Chips");
  });

  it("keeps 25 characters whole and cuts 26 to 24 and an ellipsis", () => {
    expect([
      lookUpName("あ".repeat(25)),
      lookUpName("あ".repeat(26)),
    ]).toStrictEqual(["あ".repeat(25), `${"あ".repeat(24)}…`]);
  });

  it("counts an emoji sequence as one", () => {
    const family = "👨‍👩‍👧‍👦";
    expect(lookUpName(family.repeat(25))).toBe(family.repeat(25));
  });

  it("escapes an ampersand that survives the cut and drops one past it", () => {
    expect([
      lookUpName(`${"a".repeat(30)} & more`),
      lookUpName(`& ${"a".repeat(30)}`),
    ]).toStrictEqual([`${"a".repeat(24)}…`, `&& ${"a".repeat(22)}…`]);
  });
});

describe(messageLinkOf, () => {
  it("links the message of a label's or a search's view under the mailbox's address", () => {
    const link = `${MAILBOX}/#inbox/${MESSAGE}`;
    expect([
      messageLinkOf(`${MAILBOX}/#inbox/${MESSAGE}`, MAILBOX),
      messageLinkOf(`${MAILBOX}#sent/${MESSAGE}`, MAILBOX),
      messageLinkOf(`${MAILBOX}/#search/from%3Ame/${MESSAGE}`, MAILBOX),
      messageLinkOf(`${MAILBOX}/#label/Work/${MESSAGE}?compose=new`, MAILBOX),
    ]).toStrictEqual([link, link, link, link]);
  });

  it("keeps the account slot and the origin of the page, whatever its query", () => {
    expect([
      messageLinkOf(
        `https://mail.google.com/mail/u/1/#inbox/${MESSAGE}`,
        MAILBOX
      ),
      messageLinkOf(`${MAILBOX}/?ui=2#inbox/${MESSAGE}`, MAILBOX),
      messageLinkOf(
        `http://127.0.0.1:8080/mail/u/2/?ui=2#label/Work/${MESSAGE}`,
        "http://127.0.0.1:8080/mail/u/0"
      ),
    ]).toStrictEqual([
      `https://mail.google.com/mail/u/1/#inbox/${MESSAGE}`,
      `${MAILBOX}/#inbox/${MESSAGE}`,
      `http://127.0.0.1:8080/mail/u/2/#inbox/${MESSAGE}`,
    ]);
  });

  it("finds none in a list, a short id, or a page off the mailbox", () => {
    expect([
      messageLinkOf(`${MAILBOX}/#inbox`, MAILBOX),
      messageLinkOf(`${MAILBOX}/#search/${MESSAGE}`, MAILBOX),
      messageLinkOf(`${MAILBOX}/#inbox/abc`, MAILBOX),
      messageLinkOf(`https://example.com/mail/u/0/#inbox/${MESSAGE}`, MAILBOX),
      messageLinkOf(
        `https://mail.google.com/calendar/u/0/#inbox/${MESSAGE}`,
        MAILBOX
      ),
      messageLinkOf(`${MAILBOX}/`, MAILBOX),
    ]).toStrictEqual([null, null, null, null, null, null]);
  });
});

describe(emailAddressOf, () => {
  it("keeps the address of a mailto link, decoded and without its query", () => {
    expect([
      emailAddressOf("mailto:someone@example.com"),
      emailAddressOf("mailto:some%2Bone@example.com?cc=x@example.com"),
      emailAddressOf("mailto:bad%E0@example.com"),
    ]).toStrictEqual([
      "someone@example.com",
      "some+one@example.com",
      "bad%E0@example.com",
    ]);
  });
});
