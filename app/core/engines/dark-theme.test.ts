import { describe, expect, it } from "vitest";

import { random } from "../../test/random.ts";
import {
  DARK_SURFACE,
  TEXT_CONTRAST,
  contrast,
  darkBackground,
  darkBorder,
  darkGradient,
  darkText,
  formatColour,
  imageTone,
  luminance,
  parseColour,
} from "./dark-theme.ts";
import type { Rgba } from "./dark-theme.ts";

const colour = (text: string): Rgba => {
  const parsed = parseColour(text);
  if (parsed === undefined) {
    throw new TypeError(`Not a colour: ${text}`);
  }
  return parsed;
};

const randomColour = (draw: () => number): Rgba => ({
  a: 1,
  b: Math.floor(draw() * 256),
  g: Math.floor(draw() * 256),
  r: Math.floor(draw() * 256),
});

describe(parseColour, () => {
  it("reads what getComputedStyle writes and the hex a presentational attribute holds", () => {
    expect([
      parseColour("rgb(51, 51, 51)"),
      parseColour("rgba(0, 0, 0, 0.87)"),
      parseColour("#fff"),
      parseColour("#1a73e8"),
      parseColour("transparent"),
      parseColour("hsla(0, 100%, 50%, 0.1)"),
      parseColour("currentcolor"),
    ]).toStrictEqual([
      { a: 1, b: 51, g: 51, r: 51 },
      { a: 0.87, b: 0, g: 0, r: 0 },
      { a: 1, b: 255, g: 255, r: 255 },
      { a: 1, b: 232, g: 115, r: 26 },
      { a: 0, b: 0, g: 0, r: 0 },
      { a: 0.1, b: 0, g: 0, r: 255 },
      undefined,
    ]);
  });
});

describe(darkBackground, () => {
  it("darkens white to the dark surface and keeps a page's layered greys layered", () => {
    const white = darkBackground(colour("#ffffff"));
    const grey = darkBackground(colour("#f1f3f4"));

    expect(formatColour(white)).toBe(formatColour(DARK_SURFACE));
    expect(luminance(grey)).toBeGreaterThan(luminance(white));
    expect(luminance(grey)).toBeLessThan(0.1);
  });

  it("keeps a dark ground, a brand's button and a highlighter's mark as they are", () => {
    for (const kept of [
      "#121212",
      "#1a73e8",
      "#ff6719",
      "#ffd700",
      "#ffff00",
      "#0b8043",
    ]) {
      const given = colour(kept);
      expect(darkBackground(given)).toBe(given);
    }
  });

  it("darkens a mid-grey ground to a dark one, so its grey text turns light", () => {
    const ground = darkBackground(colour("#888888"));
    const text = darkText(colour("#777777"), ground);

    expect([
      luminance(ground) < 0.1,
      luminance(text) > luminance(ground),
      contrast(text, ground) >= TEXT_CONTRAST,
    ]).toStrictEqual([true, true, true]);
  });

  it("keeps the order of the greys up to where it lands them at its lightest, so a darker panel never ends lighter than a lighter one", () => {
    const greys = Array.from({ length: 13 }, (_, step) => {
      const channel = (step * 17).toString(16).padStart(2, "0");
      return luminance(
        darkBackground(colour(`#${channel}${channel}${channel}`))
      );
    });

    expect(greys).toStrictEqual(greys.toSorted((one, other) => one - other));
  });

  it("darkens a pastel without turning it neon", () => {
    const green = darkBackground(colour("#e8f5e9"));

    expect(luminance(green)).toBeLessThan(0.1);
    expect(green.g).toBeGreaterThan(green.r);
  });
});

describe(darkText, () => {
  it("keeps a text that already reads on its ground", () => {
    const white = colour("#ffffff");
    const faint = colour("#aaaaaa");

    expect(darkText(white, colour("#1a73e8"))).toBe(white);
    expect(darkText(faint, DARK_SURFACE)).toBe(faint);
  });

  it(`reaches ${TEXT_CONTRAST} against any opaque ground, whatever colour it started as`, () => {
    const draw = random(25);
    const failures: string[] = [];
    for (let round = 0; round < 2000; round += 1) {
      const text = randomColour(draw);
      const ground = randomColour(draw);
      const readable = darkText(text, ground);
      if (contrast(readable, ground) < TEXT_CONTRAST - 0.01) {
        failures.push(`${formatColour(text)} on ${formatColour(ground)}`);
      }
    }

    expect(failures).toStrictEqual([]);
  });

  it("turns a dark text light on the dark surface, keeping its hue", () => {
    const red = darkText(colour("#a50e0e"), DARK_SURFACE);

    expect(contrast(red, DARK_SURFACE)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(red.r).toBeGreaterThan(red.g);
  });
});

describe(darkBorder, () => {
  it("darkens a light rule a step above the surface and lifts one that vanishes", () => {
    const rule = darkBorder(colour("#dddddd"), DARK_SURFACE);
    const vanished = darkBorder(colour("#202124"), DARK_SURFACE);

    expect(luminance(rule)).toBeGreaterThan(luminance(DARK_SURFACE));
    expect(luminance(rule)).toBeLessThan(0.2);
    expect(contrast(vanished, DARK_SURFACE)).toBeGreaterThanOrEqual(1.5);
  });
});

describe(darkGradient, () => {
  it("darkens a light gradient's stops and keeps a brand's", () => {
    const light = darkGradient(
      "linear-gradient(rgb(255, 255, 255) 0%, rgb(240, 240, 240) 100%)"
    );
    const brand =
      "linear-gradient(135deg, rgb(102, 126, 234) 0%, rgb(118, 75, 162) 100%)";

    expect(light.image).not.toContain("255, 255, 255");
    expect(luminance(light.ground ?? colour("#fff"))).toBeLessThan(0.1);
    expect(darkGradient(brand).image).toBe(brand);
  });
});

/** A hundred pixels of `rgba`, the first `clear` of them transparent. */
const pixels = (rgba: readonly number[], clear: number) => {
  const sample = new Uint8ClampedArray(400);
  for (let index = 0; index < 100; index += 1) {
    sample.set(index < clear ? [0, 0, 0, 0] : rgba, index * 4);
  }
  return sample;
};

describe(imageTone, () => {
  it("tells dark artwork on a transparent ground from a photograph and a light logo", () => {
    expect([
      imageTone(pixels([20, 20, 20, 255], 40)),
      imageTone(pixels([20, 20, 20, 255], 0)),
      imageTone(pixels([240, 240, 240, 255], 40)),
      imageTone(new Uint8ClampedArray(0)),
    ]).toStrictEqual(["dark", "other", "other", "other"]);
  });
});
