import { describe, expect, it } from "vitest";

import {
  DARK_SURFACE,
  TEXT_CONTRAST,
  contrast,
  formatColour,
  over,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import type { Rgba } from "../../../core/engines/dark-theme.ts";
import { isHtmlElement, queryAll } from "../../content/query.ts";
import { MARK, releaseTree, themeTree } from "./engine.ts";

const corpus = import.meta.glob("../features/fixtures/corpus/*.html", {
  eager: true,
  import: "default",
  query: "?raw",
});

const styleOf = (element: Element) => getComputedStyle(element);

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

/** What an element's text sits on as the page paints it, or undefined over an image. */
const groundOf = (element: Element): Rgba | undefined => {
  const layers: Rgba[] = [];
  for (
    let box: Element | null = element;
    box !== null;
    box = box.parentElement
  ) {
    const style = styleOf(box);
    if (style.backgroundImage.includes("url(")) {
      return undefined;
    }
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

/** Every element holding text of its own, with the contrast its text has on its ground. */
const textContrasts = (root: Element) =>
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
        text: formatColour(text),
        ground: formatColour(ground),
      },
    ];
  });

const mount = (html: string): HTMLElement => {
  document.head.innerHTML = "";
  document.body.innerHTML = `<div id="sheet" style="background-color: rgb(255, 255, 255); color: rgb(34, 34, 34)">${html}</div>`;
  const body = queryAll(document, ".a3s", isHtmlElement).at(0);
  if (body === undefined) {
    throw new TypeError("The mail has no body");
  }
  return body;
};

const mails = Object.entries(corpus).map(([file, html]) => ({
  html,
  name: file.slice(file.lastIndexOf("/") + 1),
}));

describe(themeTree, () => {
  it("has a corpus of real mails' shapes to theme", () => {
    expect(mails.length).toBeGreaterThanOrEqual(25);
  });

  it.each(mails)(
    `themes $name with every text at ${TEXT_CONTRAST} against its ground`,
    ({ html }) => {
      const body = mount(html);
      const sheet = body.closest("#sheet");
      if (sheet === null) {
        throw new TypeError("No sheet");
      }
      themeTree(sheet, styleOf, "#nothing");

      const unreadable = textContrasts(sheet).filter(
        ({ contrast: ratio }) => ratio < TEXT_CONTRAST - 0.01
      );
      expect(unreadable).toStrictEqual([]);
    }
  );

  it.each(mails)("puts $name back exactly as the mail had it", ({ html }) => {
    const body = mount(html);
    const before = body.outerHTML;
    themeTree(body, styleOf);

    releaseTree(document);

    expect(body.outerHTML).toBe(before);
    expect(document.querySelectorAll(`[${MARK}]`)).toHaveLength(0);
  });

  it("darkens what is light and keeps what is the mail's own colour", () => {
    const body = mount(
      `<div class="a3s"><div id="light" style="background-color: rgb(249, 249, 249)">Text</div><a id="button" style="background-color: rgb(26, 115, 232); color: rgb(255, 255, 255)">Go</a></div>`
    );
    themeTree(body, styleOf);

    const light = body.querySelector("#light");
    const ground = parseColour(
      light === null ? "" : styleOf(light).backgroundColor
    );

    expect([
      ground === undefined ? 1 : contrast(ground, DARK_SURFACE) < 1.2,
      light?.getAttribute(MARK),
      body.querySelector("#button")?.hasAttribute(MARK),
    ]).toStrictEqual([true, "background-color: rgb(249, 249, 249)", false]);
  });

  it("reaches only what is new when it walks a subtree again", () => {
    const body = mount(
      `<div class="a3s"><p style="color: rgb(51, 51, 51)">Old</p></div>`
    );
    const first = themeTree(body, styleOf);
    const added = document.createElement("p");
    added.setAttribute("style", "background-color: rgb(255, 255, 255)");
    body.append(added);

    expect([first.touched, themeTree(body, styleOf).touched]).toStrictEqual([
      2, 1,
    ]);
  });

  it("leaves an editor alone, since Gmail sends its markup", () => {
    const body = mount(
      `<div class="a3s"><div contenteditable="true" style="color: rgb(34, 34, 34)"><p style="background-color: rgb(255, 255, 255)">Draft</p></div></div>`
    );
    themeTree(body, styleOf);

    expect(
      document.querySelectorAll(
        `[contenteditable] [${MARK}], [contenteditable][${MARK}]`
      )
    ).toHaveLength(0);
  });
});
