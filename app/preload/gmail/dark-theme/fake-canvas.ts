import type { PageCanvas } from "./canvas.ts";

/** The page's canvas as a test gives it: images' pixels by address, any other image answering none, as one the page cannot read. */
export class FakeCanvas implements PageCanvas {
  readonly #answers = new Map<string, Uint8ClampedArray>();
  /** Every address asked for, in order. */
  readonly asked: string[] = [];

  /** Answers `source` with every pixel `rgba`, over `transparent` of them left clear. */
  answer(
    source: string,
    rgba: readonly [number, number, number, number],
    transparent = 0
  ): void {
    const pixels = new Uint8ClampedArray(100 * 4);
    for (let index = 0; index < 100; index += 1) {
      pixels.set(index < transparent ? [0, 0, 0, 0] : rgba, index * 4);
    }
    this.#answers.set(source, pixels);
  }

  readonly pixels = async (source: string): Promise<Uint8ClampedArray> => {
    this.asked.push(source);
    await Promise.resolve();
    return this.#answers.get(source) ?? new Uint8ClampedArray(0);
  };
}
