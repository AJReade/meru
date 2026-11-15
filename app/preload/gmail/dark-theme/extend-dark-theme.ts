import {
  imageTone,
  luminance,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import type { SelectorEntry } from "../../content/selectors.ts";
import type { GmailFeature } from "../feature.ts";
import {
  EDITOR,
  hoverSheet,
  newMark,
  releaseTree,
  themeAgain,
  turnLight,
} from "./engine.ts";
import type { StyleOf, Theme } from "./engine.ts";

// An image larger than this is a photograph or a banner, which darkening would only spoil.
const LARGEST_ICON = 512 * 512;

// Gmail's dark theme marks itself only by its style sheet, which paints the page's own ground dark (`.aAU`) while leaving the conversation's sheet white.
const DARK_PAGE = 0.2;

const MESSAGE = "[data-message-id]";

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

/** Whether Gmail's own dark theme is on. */
export const isGmailDark = (document: Document, styleOf: StyleOf): boolean => {
  const ground = parseColour(styleOf(document.body).backgroundColor);
  return ground !== undefined && ground.a > 0 && luminance(ground) < DARK_PAGE;
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
export const extendDarkTheme = (mark: string = newMark()): GmailFeature => ({
  apply: ({ document, pixels, scheduler, settings, style, undo }) => {
    if (!settings.switches.extendDarkTheme) {
      style("");
      return;
    }
    const view = document.defaultView;
    if (view === null) {
      return;
    }
    const styleOf: StyleOf = (element) => view.getComputedStyle(element);
    const theme: Theme = { mark, styleOf };
    // Each root with what its walk passes over.
    const roots = new Map<Element, string>();
    let on = true;
    let dark = false;
    let looked: string | undefined;
    // Gmail turns its theme by the body's class or style, or by a style sheet arriving, so the body's ground is read again only when one of those changed.
    const follow = () => {
      const { body } = document;
      const key = `${body.className}\n${body.getAttribute("style") ?? ""}\n${document.styleSheets.length}`;
      if (key === looked) {
        return;
      }
      looked = key;
      const was = dark;
      dark = isGmailDark(document, styleOf);
      if (was && !dark) {
        releaseTree(document, mark);
      }
    };
    const look = async (image: HTMLImageElement) => {
      if (
        image.naturalWidth * image.naturalHeight > LARGEST_ICON ||
        image.currentSrc === ""
      ) {
        return;
      }
      const sampled = await pixels(image.currentSrc);
      if (on && image.isConnected && imageTone(sampled) === "dark") {
        turnLight(image, mark);
      }
    };
    const lookAt = (image: HTMLImageElement) => {
      look(image).catch(() => {
        // An image that cannot be read stays as the mail drew it.
      });
    };
    const walk = (root: Element, skip: string) => {
      if (!dark) {
        return;
      }
      for (const image of themeAgain(root, theme, skip).images) {
        if (image.complete) {
          lookAt(image);
        } else {
          image.addEventListener(
            "load",
            () => {
              lookAt(image);
            },
            { once: true }
          );
        }
      }
    };
    const found = (skip: string) => (root: Element) => {
      roots.set(root, skip);
      follow();
      walk(root, skip);
    };
    style(hoverSheet(mark));
    undo(() => {
      on = false;
      roots.clear();
      releaseTree(document, mark);
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
        follow();
        for (const [root, skip] of roots) {
          if (root.isConnected) {
            walk(root, skip);
          } else {
            roots.delete(root);
          }
        }
      })
    );
  },
  id: "extendDarkTheme",
});
