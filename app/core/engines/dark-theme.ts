/** A colour as CSS gives it, channels 0 to 255 and alpha 0 to 1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** The ground a themed message sits on, Gmail's own dark surface. */
export const DARK_SURFACE: Rgba = { a: 1, b: 31, g: 31, r: 31 };

const WHITE: Rgba = { a: 1, b: 255, g: 255, r: 255 };
const BLACK: Rgba = { a: 1, b: 0, g: 0, r: 0 };

/** The contrast every text keeps against what it sits on, WCAG's AA for body text. */
export const TEXT_CONTRAST = 4.5;

// A border or rule needs only to be told apart from its ground, not read.
const RULE_CONTRAST = 1.5;

// A background this dark already reads as part of a dark page.
const DARK_LUMINANCE = 0.18;
// A dark colour this saturated is the sender's tint, such as a purple a gradient ends on, rather than a grey whose lightness is all it says.
const DARK_TINT = 0.2;

// A colour this saturated and no lighter is a brand's or a highlight's: a button, a banner, a marker; darkening it would wreck what it says, and its text is checked against it as it stands.
const BRAND_SATURATION = 0.4;
const BRAND_LIGHTNESS = 0.8;

// The lightest a darkened background lands, and the lightness from which a background is darkened, so a mid-grey ground ends dark under light text rather than a mid-grey that dark text and light text both read poorly on.
const DARKEST_LAYER = 0.3;
// How the band from DARKEST_LAYER to white bends onto the dark band: under 1 it spreads the near-whites a page layers its panels in further apart than the mid-greys, which still land apart.
const LAYER_CURVE = 0.6;
// A light border lands this much lighter than a background of its tone, so a rule between two darkened surfaces still shows.
const BORDER_LIFT = 0.08;
// A darkened colour keeps at most this saturation, which stops a pastel turning neon on black.
const DARK_SATURATION = 0.5;

const RGB =
  /^rgba?\(\s*(?<r>[\d.]+)[\s,]+(?<g>[\d.]+)[\s,]+(?<b>[\d.]+)(?:[\s,/]+(?<a>[\d.]+%?))?\s*\)$/u;
const HSL =
  /^hsla?\(\s*(?<h>[\d.]+)(?:deg)?[\s,]+(?<s>[\d.]+)%[\s,]+(?<l>[\d.]+)%(?:[\s,/]+(?<a>[\d.]+%?))?\s*\)$/u;
const HEX = /^#(?<digits>[\da-f]{3,8})$/iu;
const COLOUR_TOKEN = /rgba?\([^)]*\)|#[\da-f]{3,8}\b/giu;

const alphaOf = (text: string | undefined): number => {
  if (text === undefined) {
    return 1;
  }
  return text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
};

const fromHex = (hex: string): Rgba | undefined => {
  const digits = hex.length <= 4 ? hex.replaceAll(/[\da-f]/giu, "$&$&") : hex;
  if (digits.length !== 6 && digits.length !== 8) {
    return undefined;
  }
  const channel = (index: number) =>
    Number.parseInt(digits.slice(index, index + 2), 16);
  return {
    a: digits.length === 8 ? channel(6) / 255 : 1,
    b: channel(4),
    g: channel(2),
    r: channel(0),
  };
};

/** A colour as `getComputedStyle` writes it, `rgb()` or `rgba()`, or a hex a presentational attribute holds; anything else is undefined. */
export const parseColour = (text: string): Rgba | undefined => {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "transparent") {
    return { a: 0, b: 0, g: 0, r: 0 };
  }
  const digits = HEX.exec(trimmed)?.groups?.digits;
  if (digits !== undefined) {
    return fromHex(digits);
  }
  const hsl = HSL.exec(trimmed)?.groups;
  if (hsl !== undefined) {
    return fromHsl(
      {
        h: Number(hsl.h) % 360,
        l: Number(hsl.l) / 100,
        s: Number(hsl.s) / 100,
      },
      alphaOf(hsl.a)
    );
  }
  const rgb = RGB.exec(trimmed)?.groups;
  if (rgb === undefined) {
    return undefined;
  }
  return {
    a: alphaOf(rgb.a),
    b: Number(rgb.b),
    g: Number(rgb.g),
    r: Number(rgb.r),
  };
};

const round = (value: number) => Math.round(Math.min(255, Math.max(0, value)));

export const formatColour = ({ r, g, b, a }: Rgba): string =>
  a >= 1
    ? `rgb(${round(r)}, ${round(g)}, ${round(b)})`
    : `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${Math.round(a * 1000) / 1000})`;

const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** WCAG's relative luminance. */
export const luminance = ({ r, g, b }: Rgba): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** WCAG's contrast ratio between two opaque colours. */
export const contrast = (one: Rgba, other: Rgba): number => {
  const a = luminance(one);
  const b = luminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** `top` painted over the opaque `ground`. */
export const over = (top: Rgba, ground: Rgba): Rgba => ({
  a: 1,
  b: top.b * top.a + ground.b * (1 - top.a),
  g: top.g * top.a + ground.g * (1 - top.a),
  r: top.r * top.a + ground.r * (1 - top.a),
});

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

const toHsl = ({ r, g, b }: Rgba): Hsl => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, l, s: 0 };
  }
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === red) {
    h = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    h = (blue - red) / delta + 2;
  } else {
    h = (red - green) / delta + 4;
  }
  return { h: h * 60, l, s };
};

const fromHsl = ({ h, s, l }: Hsl, a: number): Rgba => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  const sector = Math.floor(h / 60) % 6;
  const sectors: readonly (readonly [number, number, number])[] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [red, green, blue] = sectors[sector] ?? [0, 0, 0];
  return {
    a,
    b: (blue + m) * 255,
    g: (green + m) * 255,
    r: (red + m) * 255,
  };
};

/** Whether a colour says something as it stands, a brand's button or a highlighter's mark, rather than being a page's ground. */
const isBrand = (colour: Rgba): boolean => {
  const { s, l } = toHsl(colour);
  return s >= BRAND_SATURATION && l <= BRAND_LIGHTNESS;
};

/** The colour's lightness from DARKEST_LAYER to white mapped, in reverse and without two landing together, onto the dark band from DARKEST_LAYER down to the surface, its hue kept and its saturation damped, then lifted by `lift`. */
const darkened = (colour: Rgba, lift: number): Rgba => {
  const { h, s, l } = toHsl(colour);
  const surface = toHsl(DARK_SURFACE).l;
  const below = Math.min(1, Math.max(0, (1 - l) / (1 - DARKEST_LAYER)));
  return fromHsl(
    {
      h,
      l: surface + (DARKEST_LAYER - surface) * below ** LAYER_CURVE + lift,
      s: Math.min(s, DARK_SATURATION),
    },
    colour.a
  );
};

/**
 * What a background becomes on the dark page: a light ground is darkened, keeping its hue and its
 * place among the page's other grounds, a lighter one landing darker; a dark one, a brand's colour
 * and a transparent one stay. A grey is kept as dark up to DARKEST_LAYER, where the darkened band
 * starts, so a grey just lighter than one kept lands beside it; a dark tint is the sender's colour
 * and is kept as it is.
 */
export const darkBackground = (colour: Rgba): Rgba => {
  if (colour.a === 0 || isBrand(colour)) {
    return colour;
  }
  const { s, l } = toHsl(colour);
  if (
    luminance(colour) <= DARK_LUMINANCE &&
    (l <= DARKEST_LAYER || s >= DARK_TINT)
  ) {
    return colour;
  }
  return darkened(colour, 0);
};

/** `colour` moved in lightness until it keeps `floor` against `ground`, its lightness turned over first, since a dark text on a darkened ground was light text's opposite. */
const readableOn = (colour: Rgba, ground: Rgba, floor: number): Rgba => {
  const opaque = over(colour, ground);
  if (contrast(opaque, ground) >= floor) {
    return colour;
  }
  const { h, s, l } = toHsl(opaque);
  // Whichever pole the ground is further from, since only one of them reaches the floor on a mid-tone ground.
  const lighter = contrast(WHITE, ground) >= contrast(BLACK, ground);
  let lightness = lighter ? Math.max(l, 1 - l) : Math.min(l, 1 - l);
  let candidate = fromHsl({ h, l: lightness, s }, 1);
  while (
    contrast(candidate, ground) < floor &&
    lightness > 0 &&
    lightness < 1
  ) {
    lightness = lighter
      ? Math.min(1, lightness + 0.02)
      : Math.max(0, lightness - 0.02);
    candidate = fromHsl({ h, l: lightness, s }, 1);
  }
  return candidate;
};

/** A text colour that reads on the opaque `ground`: kept when it already does, else turned and moved until it reaches `TEXT_CONTRAST`. */
export const darkText = (colour: Rgba, ground: Rgba): Rgba =>
  colour.a === 0 ? colour : readableOn(colour, ground, TEXT_CONTRAST);

/**
 * A border or rule's colour on the opaque `ground`: a light one darkened a step above the surfaces
 * beside it, and any that vanishes into its ground turned until it shows. A translucent one is a
 * shade of whatever lies under it, a hairline as faint on the light page as it was drawn, so it
 * stays as translucent with its lightness turned over: made opaque and turned until it showed, a
 * dark 12% seam became a light line across a dark sheet.
 */
export const darkBorder = (colour: Rgba, ground: Rgba): Rgba => {
  if (colour.a === 0) {
    return colour;
  }
  if (colour.a < 1) {
    const { h, s, l } = toHsl(colour);
    return l >= 0.5 ? colour : fromHsl({ h, l: 1 - l, s }, colour.a);
  }
  const shifted =
    luminance(colour) > DARK_LUMINANCE && !isBrand(colour)
      ? darkened(colour, BORDER_LIFT)
      : colour;
  return readableOn(shifted, ground, RULE_CONTRAST);
};

/** A gradient with each colour in it darkened as a background is, and the colour its stops average to, which is what text over it sits on. */
export const darkGradient = (
  image: string
): { readonly image: string; readonly ground: Rgba | undefined } => {
  const stops: Rgba[] = [];
  const themed = image.replaceAll(COLOUR_TOKEN, (token) => {
    const colour = parseColour(token);
    if (colour === undefined) {
      return token;
    }
    const dark = darkBackground(colour);
    stops.push(dark);
    return formatColour(dark);
  });
  if (stops.length === 0) {
    return { ground: undefined, image };
  }
  const sum = (channel: "r" | "g" | "b" | "a") =>
    stops.reduce((total, stop) => total + stop[channel], 0) / stops.length;
  return {
    ground: { a: sum("a"), b: sum("b"), g: sum("g"), r: sum("r") },
    image: themed,
  };
};

/** A box shadow with each colour in it darkened as a background is: a light shadow drawn as a seam on a light page, such as Gmail's above its stuck reply bar, would draw a light line on a dark one, while a dark shadow stays. */
export const darkShadow = (shadow: string): string =>
  darkGradient(shadow).image;

/** What an image's sampled pixels say about it on a dark page: `dark` is dark artwork on a transparent ground, a logo or an icon that would vanish, which is turned light; anything else is left as it is. */
export const imageTone = (pixels: Uint8ClampedArray): "dark" | "other" => {
  let transparent = 0;
  let dark = 0;
  let opaque = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    if (alpha < 13) {
      transparent += 1;
      continue;
    }
    opaque += 1;
    const colour = {
      a: 1,
      b: pixels[index + 2] ?? 0,
      g: pixels[index + 1] ?? 0,
      r: pixels[index] ?? 0,
    };
    if (luminance(colour) < 0.1) {
      dark += 1;
    }
  }
  const total = transparent + opaque;
  return total > 0 &&
    transparent / total >= 0.1 &&
    opaque > 0 &&
    dark / opaque >= 0.7
    ? "dark"
    : "other";
};
