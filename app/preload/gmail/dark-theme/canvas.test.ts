import { afterEach, describe, expect, it } from "vitest";

import { parseColour } from "../../../core/engines/dark-theme.ts";
import { pageCanvas } from "./canvas.ts";
import { themeTree } from "./engine.ts";
import { TEST_MARK, mountMail, theme } from "./testing.ts";

const original = Reflect.get(globalThis, "OffscreenCanvas");

/** A canvas whose context draws but refuses to be read, as one a cross-origin image tainted does. */
class RefusingCanvas {
  readonly #context = {
    clearRect: () => {
      // Nothing is drawn.
    },
    drawImage: () => {
      // Nothing is drawn.
    },
    fillRect: () => {
      // Nothing is drawn.
    },
    fillStyle: "#000000",
    getImageData: () => {
      throw new Error("The canvas has been tainted");
    },
  };

  getContext() {
    return this.#context;
  }
}

const walkWith = () => {
  const canvas = pageCanvas();
  const sheet = mountMail(
    `<div class="a3s"><p id="unread" style="color: oklch(0.3 0 0)">Unread</p></div>`
  );
  themeTree(sheet, {
    ...theme,
    colourOf: (text) => parseColour(text) ?? canvas.colour(text),
  });
  return [
    canvas.colour("oklch(0.5 0 0)"),
    canvas.pixels(document.createElement("img")).length,
    sheet.hasAttribute(TEST_MARK),
  ];
};

describe(pageCanvas, () => {
  afterEach(() => {
    Reflect.set(globalThis, "OffscreenCanvas", original);
  });

  it("answers no colour and no pixels on a page without OffscreenCanvas, and the walk still marks what it looked at", () => {
    Reflect.deleteProperty(globalThis, "OffscreenCanvas");

    expect(walkWith()).toStrictEqual([undefined, 0, true]);
  });

  it("answers no colour and no pixels from a canvas that refuses to be read", () => {
    Reflect.set(globalThis, "OffscreenCanvas", RefusingCanvas);

    expect(walkWith()).toStrictEqual([undefined, 0, true]);
  });
});
