import {
  imageTone,
  luminance,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import type { SelectorEntry } from "../../content/selectors.ts";
import type { GmailFeature } from "../feature.ts";
import {
  EDITOR,
  SKIPPED,
  newMark,
  releaseArrived,
  releaseTree,
  settle,
  skipEditor,
  themeAfresh,
  themeAgain,
  themeSheet,
  turnLight,
} from "./engine.ts";
import type { StyleOf, Theme, Themed } from "./engine.ts";

// An image larger than this is a photograph or a banner, which darkening would only spoil.
const LARGEST_ICON = 512 * 512;

// Enough for every image a conversation shows; past it the failures are forgotten rather than grow.
const FAILURES_KEPT = 256;

/** Whether the canvas may read the image as the page loaded it, which it may only when the image is the page's own or was fetched with CORS; any other taints the canvas, and a second fetch to read it is not made. */
const readable = (image: HTMLImageElement, origin: string): boolean => {
  const source = image.currentSrc;
  if (source.startsWith("data:") || image.crossOrigin !== null) {
    return true;
  }
  try {
    return new URL(source).origin === origin;
  } catch {
    return false;
  }
};

// Gmail's dark theme marks itself only by its style sheet, which paints the page's own ground dark (`.aAU`) while leaving the conversation's sheet white.
const DARK_PAGE = 0.2;

const MESSAGE = "[data-message-id]";

// The attributes Gmail changes an element's state by: a starred star, a selected row, an open toggle, a hover class, and a colour it writes into the style attribute itself.
const STATES = [
  "class",
  "style",
  "aria-checked",
  "aria-expanded",
  "aria-pressed",
  "aria-selected",
];

// What of a style attribute Gmail writes is a state the walk decided from; a position or a size written on every frame of an animation is not.
const STATE_COLOURS = [
  "background",
  "background-color",
  "background-image",
  "box-shadow",
  "border-color",
  "color",
];

const conversationEntry: SelectorEntry = {
  anchor: "h2[data-legacy-thread-id]",
  id: "extendDarkTheme",
};

const messageEntry: SelectorEntry = {
  anchor: MESSAGE,
  id: "extendDarkThemeMessage",
};

// What the clipped messages feature puts in a body once it has loaded the rest of the message.
const clippedEntry: SelectorEntry = {
  anchor: "[data-meru-clipped]",
  id: "extendDarkThemeClipped",
};

/** Whether a node is an editor's or inside one. */
const insideEditor = (node: Node): boolean =>
  ((node instanceof Element ? node : node.parentElement)?.closest(EDITOR) ??
    null) !== null;

/** Whether Gmail's own dark theme is on, read off the body's ground or, while the body's is clear, the root's; no other mark of the theme is known. */
export const isGmailDark = (document: Document, styleOf: StyleOf): boolean => {
  for (const box of [document.body, document.documentElement]) {
    const ground = parseColour(styleOf(box).backgroundColor);
    if (ground !== undefined && ground.a > 0) {
      return luminance(ground) < DARK_PAGE;
    }
  }
  return false;
};

/** The conversation's sheet: the nearest box under its subject that paints a ground, Gmail's white one. */
const sheetOf = (
  subject: HTMLElement,
  styleOf: StyleOf
): HTMLElement | undefined => {
  const { body } = subject.ownerDocument;
  for (
    let box = subject.parentElement;
    box !== null && box !== body;
    box = box.parentElement
  ) {
    const ground = parseColour(styleOf(box).backgroundColor);
    if (ground !== undefined && ground.a > 0) {
      return box;
    }
  }
  return undefined;
};

/**
 * Extends Gmail's dark theme to the conversation it leaves light: its sheet, each message as it
 * comes and a clipped message's rest once loaded, each walked in the frame it appears in, before it
 * is painted, and walked again on every batch for whatever arrived under it since. What it wrote
 * lives on the elements, which go with the message; it holds only the roots still on the page, and
 * turning it off or Gmail's theme turning light puts every element back.
 */
export const extendDarkTheme = (mark: string = newMark()): GmailFeature => {
  // Images whose pixels could not be read, which this page load does not try again.
  const unread = new Set<string>();
  // Whether the last apply's undo left the page themed for this apply to keep: every change of a `gmail.*` setting undoes and applies every feature, and putting the conversation back only to theme it again would cost a walk and could show it light for a frame.
  let pending = false;
  return {
    apply: ({ canvas, document, scheduler, settings, style, undo }) => {
      const kept = pending;
      pending = false;
      const view = document.defaultView;
      if (!settings.switches.extendDarkTheme || view === null) {
        if (kept) {
          releaseTree(document, mark);
        }
        style("");
        return;
      }
      const styleOf: StyleOf = (element, pseudo) =>
        view.getComputedStyle(element, pseudo);
      const theme: Theme = {
        colourOf: (text) => parseColour(text) ?? canvas.colour(text),
        mark,
        styleOf,
      };
      // Each root with what its walk passes over.
      const roots = new Map<Element, string>();
      let dark = false;
      // Whether anything arrived outside an editor since the last batch, the only change in which a walk again finds work: typing into a reply that quotes a long mail adds nodes on every key.
      let arrived = true;
      // An element made editable after it was themed, as when Gmail opens a reply inside a quoted body, would send what the theme wrote on it; one no longer editable is the mail's again, for the next batch to walk.
      const editable = (node: Node) => {
        if (!(node instanceof Element)) {
          return;
        }
        if (node.matches(EDITOR)) {
          // Compose and every other editor the walk never reached stay unmarked.
          if (
            node.hasAttribute(mark) ||
            node.querySelector(`[${mark}]`) !== null
          ) {
            skipEditor(node, mark);
          }
        } else if (node.getAttribute(mark) === SKIPPED) {
          node.removeAttribute(mark);
          arrived = true;
        }
      };
      // What arrived in an element a walk marked, which the next batch walks wherever it is: Gmail builds a menu inside a message, moves it to the body and only then fills it, out of reach of every root.
      const landed = new Set<Element>();
      // Marked elements whose state Gmail changed since the last batch, which the next batch decides again.
      const changed = new Set<Element>();
      const coloursOf = (text: string | null) => {
        const declared = document.createElement("div").style;
        declared.cssText = text ?? "";
        return STATE_COLOURS.map((property) =>
          declared.getPropertyValue(property)
        );
      };
      const restyled = (record: MutationRecord, target: Element) =>
        record.attributeName !== "style" ||
        coloursOf(record.oldValue).join(";") !==
          coloursOf(target.getAttribute("style")).join(";");
      // An element a walk themed, other than an editor it skipped.
      const themed = (node: Node): node is Element =>
        node instanceof Element &&
        node.hasAttribute(mark) &&
        node.getAttribute(mark) !== SKIPPED;
      const notice = (records: readonly MutationRecord[]) => {
        for (const record of records) {
          const { target } = record;
          if (record.type === "attributes") {
            if (record.attributeName === "contenteditable") {
              editable(target);
            } else if (
              themed(target) &&
              !insideEditor(target) &&
              restyled(record, target)
            ) {
              changed.add(target);
              scheduler.request();
            }
            continue;
          }
          const inEditor = insideEditor(target);
          arrived ||= !inEditor && record.addedNodes.length > 0;
          const into = !inEditor && themed(target);
          for (const node of record.addedNodes) {
            if (node instanceof Element) {
              releaseArrived(node, mark, inEditor);
              if (into) {
                landed.add(node);
              }
            }
          }
        }
      };
      const watcher = new MutationObserver(notice);
      watcher.observe(document, {
        attributeFilter: ["contenteditable", ...STATES],
        attributeOldValue: true,
        childList: true,
        subtree: true,
      });
      undo(() => {
        watcher.disconnect();
      });
      // Gmail can turn its theme by any change to a sheet, a rewritten text among them, which nothing short of reading the body's ground tells; one computed colour a batch costs microseconds.
      const follow = () => {
        const was = dark;
        dark = isGmailDark(document, styleOf);
        if (was && !dark) {
          releaseTree(document, mark);
        }
        if (dark && !was) {
          arrived = true;
        }
      };
      const look = (images: readonly HTMLImageElement[]) => {
        for (const image of images) {
          const source = image.currentSrc;
          if (
            source === "" ||
            unread.has(source) ||
            image.naturalWidth * image.naturalHeight > LARGEST_ICON ||
            !readable(image, view.location.origin)
          ) {
            continue;
          }
          const sampled = canvas.pixels(image);
          if (sampled.length === 0) {
            if (unread.size >= FAILURES_KEPT) {
              unread.clear();
            }
            unread.add(source);
          } else if (imageTone(sampled) === "dark") {
            turnLight(image, mark);
          }
        }
      };
      // Every write of the theme's goes through here, so Gmail's changes before it are heard and its own are not: the records its writes leave are dropped, which no change of Gmail's can be among, since none runs while the theme does.
      const writing = (root: Element, write: () => Themed) => {
        notice(watcher.takeRecords());
        const done = write();
        if (done.touched > 0) {
          settle(root);
        }
        watcher.takeRecords();
        look(done.images);
      };
      const walk = (root: Element, skip: string) => {
        if (dark) {
          writing(root, () => themeAgain(root, theme, skip));
        }
      };
      // An image the walk marked is looked at again whenever it loads, the first time or after its address changed, from what the mail set: one listener for the page rather than one per image.
      const loaded = (event: Event) => {
        const image = event.target;
        if (
          dark &&
          image instanceof HTMLImageElement &&
          image.hasAttribute(mark)
        ) {
          writing(image, () => themeAfresh(image, theme));
        }
      };
      const held = (element: Element) =>
        [...roots.keys()].some((root) => root.contains(element));
      // A state Gmail changed is decided again with the messages in it, since a sheet's walk that passes over them leaves them taken back and unwalked.
      const redecide = () => {
        for (const element of changed) {
          if (dark && element.isConnected) {
            writing(element, () => themeAfresh(element, theme));
          }
        }
        changed.clear();
        for (const element of landed) {
          if (element.isConnected && !held(element)) {
            walk(element, EDITOR);
          }
        }
        landed.clear();
      };
      document.addEventListener("load", loaded, true);
      document.addEventListener("error", loaded, true);
      undo(() => {
        document.removeEventListener("load", loaded, true);
        document.removeEventListener("error", loaded, true);
      });
      const found = (skip: string) => (root: Element) => {
        roots.set(root, skip);
        follow();
        walk(root, skip);
      };
      style(themeSheet(mark));
      undo(() => {
        roots.clear();
        // The page goes back as the mail had it unless the apply that follows in the same turn keeps the theme on.
        pending = true;
        queueMicrotask(() => {
          if (pending) {
            pending = false;
            releaseTree(document, mark);
          }
        });
      });
      undo(
        scheduler.register(conversationEntry, (subject) => {
          const sheet = sheetOf(subject, styleOf);
          if (sheet !== undefined) {
            // Each message is walked as its own entry finds it, so the sheet's walk leaves them to it.
            found(`${EDITOR}, ${MESSAGE}`)(sheet);
          }
        })
      );
      undo(scheduler.register(messageEntry, found(EDITOR)));
      undo(scheduler.register(clippedEntry, found(EDITOR)));
      undo(
        scheduler.everyBatch(() => {
          notice(watcher.takeRecords());
          follow();
          const due = arrived;
          arrived = false;
          for (const [root, skip] of roots) {
            if (!root.isConnected) {
              roots.delete(root);
            } else if (due) {
              walk(root, skip);
            }
          }
          redecide();
        })
      );
    },
    id: "extendDarkTheme",
  };
};
