import {
  DARK_SURFACE,
  contrast,
  formatColour,
  over,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import type { Rgba } from "../../../core/engines/dark-theme.ts";
import { isHtmlElement, queryAll } from "../../content/query.ts";
import { markOf } from "./engine.ts";
import type { Theme } from "./engine.ts";

export const styleOf = (element: Element) => getComputedStyle(element);

/** The mark a test's walks write, fixed so a test can look for it. */
export const TEST_MARK = markOf("test");

export const theme: Theme = { colourOf: parseColour, mark: TEST_MARK, styleOf };

export const corpus = Object.entries(
  import.meta.glob("../features/fixtures/corpus/*.html", {
    eager: true,
    import: "default",
    query: "?raw",
  })
).map(([file, html]) => ({
  html,
  name: file.slice(file.lastIndexOf("/") + 1, -".html".length),
}));

/** Puts a mail's body on a conversation sheet as Gmail's light page paints it, and answers the sheet. */
export const mountMail = (html: string): HTMLElement => {
  document.head.innerHTML = "";
  document.body.innerHTML = `<div id="sheet" style="background-color: rgb(255, 255, 255); color: rgb(34, 34, 34)">${html}</div>`;
  const sheet = queryAll(document, "#sheet", isHtmlElement).at(0);
  if (sheet === undefined || sheet.querySelector(".a3s") === null) {
    throw new TypeError("The mail has no body");
  }
  return sheet;
};

const COLOUR_TOKEN = /rgba?\([^)]*\)|#[\da-f]{3,8}\b/giu;

/** The average of a gradient's colours, what text over it sits on. */
const gradientGround = (image: string): Rgba | undefined => {
  const stops = (image.match(COLOUR_TOKEN) ?? []).flatMap((token) => {
    const colour = parseColour(token);
    return colour === undefined ? [] : [colour];
  });
  if (stops.length === 0) {
    return undefined;
  }
  const mean = (channel: "r" | "g" | "b") =>
    stops.reduce((sum, stop) => sum + stop[channel], 0) / stops.length;
  return { a: 1, b: mean("b"), g: mean("g"), r: mean("r") };
};

/** What an element's text sits on as the page paints it where its pictures do not show, as when Gmail hides a mail's images or one fails to load. */
const groundOf = (element: Element): Rgba | undefined => {
  const layers: Rgba[] = [];
  for (
    let box: Element | null = element;
    box !== null;
    box = box.parentElement
  ) {
    const style = styleOf(box);
    const gradient = gradientGround(style.backgroundImage);
    if (gradient !== undefined) {
      layers.push(gradient);
      break;
    }
    const colour = parseColour(style.backgroundColor);
    if (colour !== undefined && colour.a > 0) {
      layers.push(colour);
      if (colour.a >= 1) {
        break;
      }
    }
  }
  let ground = DARK_SURFACE;
  for (const layer of layers.toReversed()) {
    ground = over(layer, ground);
  }
  return ground;
};

/** An element's inline `color`, the `!important` one when it has one, read off its attribute since happy-dom's `style` answers the first it was given. */
const inlineColour = (element: HTMLElement): string | undefined => {
  const declared = (element.getAttribute("style") ?? "")
    .split(";")
    .map((declaration) => declaration.split(":"))
    .filter(([name]) => name?.trim().toLowerCase() === "color")
    .map(([, value]) => value ?? "");
  const value =
    declared.find((one) => one.includes("!important")) ?? declared.at(-1);
  return value?.replace("!important", "").trim();
};

/**
 * The text colour Chromium shows for an element of the corpus, whose mails style themselves
 * inline: its own inline colour, else its nearest ancestor's. happy-dom lets an ancestor's
 * `!important` colour win over an element's own, which no browser does, so its computed colour
 * would report the theme's text colour where the mail's button keeps its own.
 */
const shownColour = (element: HTMLElement): string => {
  for (
    let box: HTMLElement | null = element;
    box !== null;
    box = box.parentElement
  ) {
    const inline = inlineColour(box);
    if (inline !== undefined) {
      return inline;
    }
  }
  return styleOf(element).color;
};

/** Every element holding text of its own, with the contrast its text has on its ground, its pictures left out. */
export const textContrasts = (root: Element) =>
  queryAll(root, "*", isHtmlElement).flatMap((element) => {
    const holdsText = [...element.childNodes].some(
      (node) =>
        node.nodeType === node.TEXT_NODE &&
        (node.textContent ?? "").trim() !== ""
    );
    const ground = groundOf(element);
    const colour = parseColour(shownColour(element));
    if (!holdsText || ground === undefined || colour === undefined) {
      return [];
    }
    const text = over(colour, ground);
    return [
      {
        contrast: contrast(text, ground),
        ground: formatColour(ground),
        text: formatColour(text),
      },
    ];
  });
