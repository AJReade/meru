/** A small image's pixels, sampled down to a few hundred, or none when the image cannot be read; nothing is kept once they are answered. */
export type ImagePixels = (source: string) => Promise<Uint8ClampedArray>;

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

/**
 * Reads an image's pixels through a CORS request of its own, since the copy the page drew is
 * tainted: Gmail's image proxy answers one, and the browser's cache usually holds what it fetched;
 * a mail's own inline image is the mailbox's, so it goes with the session's cookies.
 * An image the request cannot reach, such as one whose host sends no CORS header, answers no pixels
 * and is left as it is.
 */
export const pagePixels: ImagePixels = async (source) => {
  try {
    return await sample(source);
  } catch {
    return new Uint8ClampedArray(0);
  }
};
