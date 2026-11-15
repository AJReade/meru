import type { Rgba } from "../../../core/engines/dark-theme.ts";

/** What the theme asks of a 2D canvas in the page. */
export interface PageCanvas {
  /** A colour CSS Color 4 writes, such as `oklch()`, `lab()`, `color()` or what `color-mix()` computes to, as sRGB, or undefined when it is none. */
  readonly colour: (text: string) => Rgba | undefined;
  /** A small image's pixels, sampled down to a few hundred, or none when the image cannot be read; nothing is kept once they are answered. */
  readonly pixels: (source: string) => Promise<Uint8ClampedArray>;
}

const SIDE = 24;

const sample = async (source: string): Promise<Uint8ClampedArray> => {
  const response = await fetch(source, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`The image answered ${response.status}`);
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    resizeHeight: SIDE,
    resizeQuality: "low",
    resizeWidth: SIDE,
  });
  try {
    const context = new OffscreenCanvas(SIDE, SIDE).getContext("2d");
    if (context === null) {
      throw new Error("No canvas to sample the image on");
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, SIDE, SIDE).data;
  } finally {
    bitmap.close();
  }
};

// Enough for every colour a conversation's mails write; past it the answers start over rather than grow.
const COLOURS_KEPT = 256;

/**
 * Reads a colour by painting it on a canvas of one pixel and reading the pixel back, which converts
 * any space CSS knows to sRGB and maps it into its gamut. A computed style would not: Chromium keeps
 * a CSS Color 4 colour in its own space in `getComputedStyle`, and an element that is not in the
 * page has no computed style at all.
 */
const paintedColour = (
  context: OffscreenCanvasRenderingContext2D,
  text: string
): Rgba | undefined => {
  // A canvas keeps its fill when given a colour it cannot read, so two fills that differ before it tell a refusal from a colour.
  context.fillStyle = "#000000";
  context.fillStyle = text;
  const overBlack = context.fillStyle;
  context.fillStyle = "#ffffff";
  context.fillStyle = text;
  if (overBlack !== context.fillStyle) {
    return undefined;
  }
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, alpha = 0] = context.getImageData(
    0,
    0,
    1,
    1
  ).data;
  return { a: alpha / 255, b, g, r };
};

const colourReader = (): ((text: string) => Rgba | undefined) => {
  const answers = new Map<string, Rgba | undefined>();
  let context: OffscreenCanvasRenderingContext2D | null | undefined;
  return (text) => {
    if (answers.has(text)) {
      return answers.get(text);
    }
    context ??= new OffscreenCanvas(1, 1).getContext("2d", {
      willReadFrequently: true,
    });
    const colour = context === null ? undefined : paintedColour(context, text);
    if (answers.size >= COLOURS_KEPT) {
      answers.clear();
    }
    answers.set(text, colour);
    return colour;
  };
};

export const pageCanvas = (): PageCanvas => ({
  colour: colourReader(),
  // Reads an image's pixels through a CORS request of its own, since the copy the page drew is tainted: Gmail's image proxy answers one, and the browser's cache usually holds what it fetched; a mail's own inline image is the mailbox's, so it goes with the session's cookies. An image the request cannot reach, such as one whose host sends no CORS header, answers no pixels and is left as it is.
  pixels: async (source) => {
    try {
      return await sample(source);
    } catch {
      return new Uint8ClampedArray(0);
    }
  },
});
