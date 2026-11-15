import type { Rgba } from "../../../core/engines/dark-theme.ts";

/** What the theme asks of a 2D canvas in the page. */
export interface PageCanvas {
  /** A colour CSS Color 4 writes, such as `oklch()`, `lab()`, `color()` or what `color-mix()` computes to, as sRGB, or undefined when it is none. */
  readonly colour: (text: string) => Rgba | undefined;
  /** A loaded image's pixels, drawn from the element itself at 24 by 24, or none when the image taints the canvas; nothing is kept once they are answered. */
  readonly pixels: (image: HTMLImageElement) => Uint8ClampedArray;
}

const SIDE = 24;

const imageSampler = (): ((image: HTMLImageElement) => Uint8ClampedArray) => {
  let context: OffscreenCanvasRenderingContext2D | null | undefined;
  return (image) => {
    context ??= new OffscreenCanvas(SIDE, SIDE).getContext("2d", {
      willReadFrequently: true,
    });
    if (context === null) {
      return new Uint8ClampedArray(0);
    }
    context.clearRect(0, 0, SIDE, SIDE);
    try {
      context.drawImage(image, 0, 0, SIDE, SIDE);
      return context.getImageData(0, 0, SIDE, SIDE).data;
    } catch {
      // A broken image refuses to be drawn, and a canvas an image tainted refuses to be read.
      return new Uint8ClampedArray(0);
    }
  };
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
  pixels: imageSampler(),
});
