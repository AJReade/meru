import {
  DARK_SURFACE,
  darkBackground,
  darkBorder,
  darkGradient,
  darkShadow,
  darkText,
  formatColour,
  luminance,
  over,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import type { Rgba } from "../../../core/engines/dark-theme.ts";

/**
 * The attribute marking an element the theme wrote to, holding the `style` attribute it had before.
 * Its name carries a suffix drawn afresh for each page load, so a mail cannot carry a mark of its
 * own: one would otherwise opt an element out of the walk or hand the release a style to write.
 */
export const markOf = (nonce: string): string => `data-meru-dark-${nonce}`;

/** A mark no mail can know in advance. */
export const newMark = (): string =>
  markOf(
    Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")
  );

/**
 * Gmail sends an editor's markup as the mail, so an override written into one would reach the
 * recipient; the walk leaves every editor alone, and the feature's sheet themes one it reached.
 */
export const EDITOR = '[contenteditable="true"]';

const SIDES = ["top", "right", "bottom", "left"] as const;

// A ground this dark hides dark artwork drawn for a light page.
const DARK_GROUND = 0.2;

// Gmail's icons are cross-origin images, which a canvas cannot read, but each name says its colour (`star_border_black_20dp`, `reply_baseline_nv700_20dp`, `gm_grey-24dp`); only the dark ones are turned, since a white or coloured one is already drawn for a dark ground.
const DARK_ICON =
  /gstatic\.com\/[^"')]*icons\/[^"')]*[_/](?:gm_)?(?:black|grey|grey[6-9]00|nv[6-9]00|n900|p900)[_-]\d+dp/u;

const isDarkIcon = (image: string): boolean => DARK_ICON.test(image);

/** The pseudo-elements Gmail draws an icon on, as a `content` image or a `background-image`. */
const PSEUDOS = ["::before", "::after"] as const;

// Turns a dark glyph light while keeping its hues where it has any.
export const TURN_LIGHT = "invert(1) hue-rotate(180deg)";

// Gmail's own ink in an editor on its light page, which an editor turned over shows light; an editor would otherwise inherit the light ink the walk wrote on its container and show it dark.
const EDITOR_INK = "rgb(34, 34, 34)";

/** What reads an element's computed style, or one of its pseudo-elements', which the page gives. */
export type StyleOf = (
  element: Element,
  pseudo?: (typeof PSEUDOS)[number]
) => CSSStyleDeclaration;

/** What reads a computed colour, `parseColour` for `rgb()` and the page's canvas for the rest of CSS Color 4, or undefined for one it cannot read. */
export type ColourOf = (text: string) => Rgba | undefined;

/** What a walk needs of the page: the mark it writes, how to read a computed style and how to read a colour in it. */
export interface Theme {
  readonly mark: string;
  readonly styleOf: StyleOf;
  readonly colourOf: ColourOf;
}

const CLEAR: Rgba = { a: 0, b: 0, g: 0, r: 0 };

// A colour function other than `rgb()` left in a computed gradient, whose stops the walk cannot weigh.
const UNREAD_STOP = /\b(?:oklch|oklab|lab|lch|hwb|color|color-mix)\(/u;

/** A computed background colour; an empty one is a property no style set, as a page without layout answers. */
const backgroundOf = (
  style: CSSStyleDeclaration,
  colourOf: ColourOf
): Rgba | undefined =>
  style.backgroundColor === "" ? CLEAR : colourOf(style.backgroundColor);

interface Write {
  readonly element: HTMLElement;
  readonly property: string;
  readonly value: string;
}

interface Frame {
  readonly element: Element;
  /** The opaque colour its parent's content sits on, or undefined where the walk cannot tell it, where text is left as the mail set it. */
  readonly ground: Rgba | undefined;
  /** Whether that ground is one the theme darkened, on which a dark image needs turning light. */
  readonly darkened: boolean;
  /** The parent's text colour as the page computed it before the walk wrote anything. */
  readonly parentColour: string;
  /** The parent's text colour once the walk's writes land. */
  readonly parentText: string;
}

/** What one walk did: the elements it wrote to, and the images on darkened ground worth a look at their pixels. */
export interface Themed {
  readonly touched: number;
  readonly images: readonly HTMLImageElement[];
}

const isHtml = (element: Element): element is HTMLElement =>
  "style" in element && element.namespaceURI === "http://www.w3.org/1999/xhtml";

/** The ground under `root`, read off its nearest ancestor that paints one, darkened as the walk would darken it. */
const groundAbove = (root: Element, { colourOf, styleOf }: Theme): Rgba => {
  const shades: Rgba[] = [];
  let ground = DARK_SURFACE;
  for (
    let ancestor = root.parentElement;
    ancestor !== null;
    ancestor = ancestor.parentElement
  ) {
    const colour = backgroundOf(styleOf(ancestor), colourOf);
    if (colour !== undefined && colour.a >= 1) {
      ground = darkBackground(colour);
      break;
    }
    if (colour !== undefined && colour.a > 0) {
      shades.push(colour);
    }
  }
  for (const shade of shades.toReversed()) {
    ground = darkBackground(over(shade, ground));
  }
  return ground;
};

interface Paint {
  readonly ground: Rgba | undefined;
  readonly darkened: boolean;
}

interface Painted extends Paint {
  /** The text colour the element shows once the walk's writes land, which its children inherit. */
  readonly text: string;
}

type WriteTo = (property: string, value: string) => void;

/** The element's own background colour, darkened, and the ground it leaves for what the element holds. */
const paintColour = (
  background: Rgba,
  pictured: boolean,
  inherited: Paint,
  write: WriteTo
): Paint => {
  const { ground, darkened } = inherited;
  if (background.a === 0) {
    return inherited;
  }
  if (background.a < 1) {
    // A translucent ground is a shade of what lies behind it, a code block's or a quote's on a light page, so it is never the sender's own ground to keep: what it holds is decided against it laid over the ground behind, the one the walk wrote or kept.
    if (ground === undefined) {
      return inherited;
    }
    const shade = over(background, ground);
    const dark = darkened && !pictured ? darkBackground(shade) : shade;
    if (dark !== shade) {
      write("background-color", formatColour(dark));
    }
    return { darkened, ground: dark };
  }
  const dark = pictured ? background : darkBackground(background);
  if (dark !== background) {
    write("background-color", formatColour(dark));
  }
  return {
    darkened: dark !== background || (darkened && ground === undefined),
    ground: over(dark, ground ?? DARK_SURFACE),
  };
};

/**
 * The element's own background and background image, darkened, and the ground they leave for what
 * the element holds. Under a picture the colour is kept: it is what the picture was drawn to sit on
 * and what shows where the picture does not load, so text decided against it reads either way,
 * where a darkened colour would leave light text over a light picture.
 */
const paintBackground = (
  style: CSSStyleDeclaration,
  inherited: Paint,
  write: WriteTo,
  colourOf: ColourOf
): Paint => {
  const image = style.backgroundImage;
  const pictured = image.includes("url(") && !isDarkIcon(image);
  const background = backgroundOf(style, colourOf);
  if (background === undefined) {
    // A ground the walk cannot read is one it cannot decide a text against, so what the element holds is left as the mail set it.
    return { darkened: inherited.darkened, ground: undefined };
  }
  const painted = paintColour(background, pictured, inherited, write);
  const { darkened } = painted;
  let { ground } = painted;
  if (image.includes("gradient(") && UNREAD_STOP.test(image)) {
    ground = undefined;
  } else if (image.includes("gradient(")) {
    const gradient = darkGradient(image);
    if (gradient.image !== image) {
      write("background-image", gradient.image);
    }
    if (gradient.ground !== undefined) {
      ground = over(gradient.ground, ground ?? DARK_SURFACE);
    }
  } else if (image.includes("url(") && !pictured) {
    write("filter", TURN_LIGHT);
  }
  return { darkened, ground };
};

const paintBorders = (
  style: CSSStyleDeclaration,
  ground: Rgba,
  write: WriteTo,
  colourOf: ColourOf
): void => {
  for (const side of SIDES) {
    // A computed border width is always in pixels.
    const width = Number(
      style.getPropertyValue(`border-${side}-width`).replace("px", "")
    );
    const border = colourOf(style.getPropertyValue(`border-${side}-color`));
    if (
      style.getPropertyValue(`border-${side}-style`) !== "none" &&
      width > 0 &&
      border !== undefined
    ) {
      const dark = darkBorder(border, ground);
      if (dark !== border) {
        write(`border-${side}-color`, formatColour(dark));
      }
    }
  }
  const shadow = style.boxShadow;
  if (shadow !== "" && shadow !== "none") {
    const dark = darkShadow(shadow);
    if (dark !== shadow) {
      write("box-shadow", dark);
    }
  }
};

/** Whether the element holds text of its own, rather than only boxes that hold it. */
const holdsText = (element: Element): boolean => {
  for (let node = element.firstChild; node !== null; node = node.nextSibling) {
    if (
      node.nodeType === node.TEXT_NODE &&
      (node.nodeValue ?? "").trim() !== ""
    ) {
      return true;
    }
  }
  return false;
};

/** Writes what the element's own style needs on the dark page, and answers the ground and the text colour it leaves for its children. */
const paintElement = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
  frame: Frame,
  write: WriteTo,
  colourOf: ColourOf
): Painted => {
  const paint = paintBackground(style, frame, write, colourOf);
  const { ground } = paint;
  const colour = colourOf(style.color);
  if (colour === undefined) {
    return { ...paint, text: frame.parentText };
  }
  // A text that inherits its colour shows what was written on its parent unless it is given its own. A computed colour cannot say whether it was inherited or declared again, so one a mail sets inline or as `<font color>`, as mail does, counts as its own.
  const inherits =
    style.color === frame.parentColour &&
    element.style.color === "" &&
    !element.hasAttribute("color");
  const shown = inherits ? frame.parentText : formatColour(colour);
  if (ground === undefined) {
    // On a ground the walk cannot tell, the text stays as it shows rather than be given a colour decided against nothing.
    return { ...paint, text: shown };
  }
  if (!paint.darkened) {
    // A ground the walk kept, a brand's button or the sender's own dark design, looks as it does on a light page, so its text keeps the colour the sender gave it, an inherited one included rather than one written on a darkened parent.
    const own = formatColour(colour);
    if (own !== shown) {
      write("color", own);
    }
    return { ...paint, text: own };
  }
  const text = formatColour(darkText(colour, ground));
  // A mail's `:hover` rule that sets only a colour would paint its light page's ink over the darkened ground, on the element whose text it is even when that element inherits its colour; an inline `!important` beats every rule of a sheet.
  if (text !== shown || (paint.darkened && holdsText(element))) {
    write("color", text);
  }
  paintBorders(style, ground, write, colourOf);
  return { ...paint, text };
};

/** Whether an element shows the ground the walk darkened under it through a ground of its own that is clear, which a mail's `:hover` rule could fill. */
const holdsHover = (style: CSSStyleDeclaration, frame: Frame): boolean => {
  const background = parseColour(style.backgroundColor);
  return (
    frame.darkened &&
    frame.ground !== undefined &&
    background !== undefined &&
    background.a === 0 &&
    !style.backgroundImage.includes("(")
  );
};

const ignore: WriteTo = () => {
  // An element a former walk wrote to keeps what it was given.
};

// A mark's value is a flag, a kind and, for an element written to, the `style` attribute it had: the flag says whether its hover ground is held (`HOLD`), whether what it holds sits on a ground the walk darkened (`PLAIN`) or on one it kept or could not read (`KEPT_GROUND`), the kind whether the walk only looked at it (`LOOKED`), wrote to an element that had no `style` attribute (`NO_STYLE`) or wrote over the one that follows (`HAD_STYLE`). An editor's mark is `SKIPPED` alone.
const HOLD = "t";
export const SKIPPED = "s";
const PLAIN = "-";
const KEPT_GROUND = "k";
const LOOKED = ".";
const NO_STYLE = "0";
const HAD_STYLE = "1";

const flagOf = (
  style: CSSStyleDeclaration,
  frame: Frame,
  paint: Paint
): string => {
  if (holdsHover(style, frame)) {
    return HOLD;
  }
  return paint.darkened && paint.ground !== undefined ? PLAIN : KEPT_GROUND;
};

/** Where a walk starts: on the ground above `root`, darkened unless its parent's mark recorded a ground the walk kept, such as the sender's own dark one under an image that loaded since. */
const rootFrame = (root: Element, theme: Theme): Frame => ({
  darkened:
    root.parentElement?.getAttribute(theme.mark)?.charAt(0) !== KEPT_GROUND,
  element: root,
  ground: groundAbove(root, theme),
  parentColour: "",
  parentText: "",
});

/** Notes what on a darkened ground may be dark artwork: an image to sample, and a pseudo-element drawing one of Gmail's dark icons. */
const lookAtIcons = (
  element: HTMLElement,
  ground: Rgba,
  styleOf: StyleOf,
  images: HTMLImageElement[],
  turns: [Element, string][]
): void => {
  if (element instanceof HTMLImageElement && luminance(ground) < DARK_GROUND) {
    images.push(element);
  }
  const pseudos = darkPseudos(element, styleOf);
  if (pseudos !== "") {
    turns.push([element, pseudos]);
  }
};

const writtenValue = (flag: string, element: Element): string => {
  const style = element.getAttribute("style");
  return style === null ? `${flag}${NO_STYLE}` : `${flag}${HAD_STYLE}${style}`;
};

/**
 * Darkens `root` and what it holds, in one pass: every computed style is read before anything is
 * written, since a colour written on a parent changes what its children report. A light background
 * is darkened, a text colour is kept wherever it already reads on its new ground and turned until
 * it does otherwise, a border is darkened, and a background under a picture keeps its colour.
 * Every element the walk looks at carries the mark, holding its former `style` when it was written
 * to; one already marked is not written to again, so a walk over a subtree a former walk covered
 * only reaches what is new. Nothing is kept.
 */
export const themeTree = (
  root: Element,
  theme: Theme,
  skip: string = EDITOR
): Themed => {
  const { colourOf, mark, styleOf } = theme;
  const writes: Write[] = [];
  const images: HTMLImageElement[] = [];
  const touched = new Set<Element>();
  const looked = new Map<Element, string>();
  const editors: Element[] = [];
  const turns: [Element, string][] = [];
  const stack: Frame[] = [rootFrame(root, theme)];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const { element } = frame;
    if (element.matches(skip)) {
      if (element.matches(EDITOR) && element.getAttribute(mark) !== SKIPPED) {
        editors.push(element);
      }
      continue;
    }
    const style = styleOf(element);
    const marked = element.hasAttribute(mark);
    let paint: Painted = { ...frame, text: frame.parentText };
    if (isHtml(element)) {
      paint = paintElement(
        element,
        style,
        frame,
        marked
          ? ignore
          : (property, value) => {
              writes.push({ element, property, value });
              touched.add(element);
            },
        colourOf
      );
      if (!marked && paint.darkened && paint.ground !== undefined) {
        lookAtIcons(element, paint.ground, styleOf, images, turns);
      }
    }
    if (!marked) {
      looked.set(element, flagOf(style, frame, paint));
    }
    for (
      let child = element.lastElementChild;
      child !== null;
      child = child.previousElementSibling
    ) {
      stack.push({
        darkened: paint.darkened,
        element: child,
        ground: paint.ground,
        parentColour: style.color,
        parentText: paint.text,
      });
    }
  }
  for (const [element, flag] of looked) {
    element.setAttribute(
      mark,
      touched.has(element) ? writtenValue(flag, element) : `${flag}${LOOKED}`
    );
  }
  for (const editor of editors) {
    skipEditor(editor, mark);
  }
  for (const [element, pseudos] of turns) {
    element.setAttribute(turnedOf(mark), pseudos);
  }
  for (const { element, property, value } of writes) {
    element.style.setProperty(property, value, "important");
  }
  return { images, touched: touched.size };
};

/** The attribute naming the pseudo-elements of a marked element whose dark icon the feature's sheet turns light, since no inline style reaches a pseudo-element. */
export const turnedOf = (mark: string): string => `${mark}-turn`;

/** The pseudo-elements of an element that draw one of Gmail's dark icons, by name without the colons. */
const darkPseudos = (element: Element, styleOf: StyleOf): string =>
  PSEUDOS.filter((pseudo) => {
    const style = styleOf(element, pseudo);
    return isDarkIcon(style.content) || isDarkIcon(style.backgroundImage);
  })
    .map((pseudo) => pseudo.slice(2))
    .join(" ");

const NOTHING: Themed = { images: [], touched: 0 };

/** What the query for unmarked elements matches: the elements without the mark, none of them inside an editor the walk marked skipped, so a batch never goes through what an editor holds. */
const freshOf = (mark: string): string =>
  `:not([${mark}]):not([${mark}="${SKIPPED}"] *)`;

/**
 * Themes what arrived under `root` since it was walked: one query for the elements without the
 * mark, nothing more when there are none, and a walk of each new subtree from its top, so a box
 * Gmail adds, a body it redraws and a body it puts into a message it already showed are dark in
 * the frame they appear in.
 */
export const themeAgain = (
  root: Element,
  theme: Theme,
  skip: string = EDITOR
): Themed => {
  if (!root.hasAttribute(theme.mark)) {
    return themeTree(root, theme, skip);
  }
  const fresh = root.querySelectorAll(freshOf(theme.mark));
  if (fresh.length === 0) {
    return NOTHING;
  }
  const images: HTMLImageElement[] = [];
  let touched = 0;
  let top: Element | undefined;
  for (const element of fresh) {
    // In document order an element's descendants follow it, so one walk from the top takes them all; what an element the walk skips holds is passed over, while the element itself is walked, which marks an editor skipped.
    const skipped = element.closest(skip);
    if (
      top?.contains(element) === true ||
      (skipped !== null && skipped !== element)
    ) {
      continue;
    }
    top = element;
    const themed = themeTree(element, theme, skip);
    images.push(...themed.images);
    touched += themed.touched;
  }
  return { images, touched };
};

/**
 * Decides `element` and what it holds again, from the style Gmail gives them now: a class or an
 * ARIA state Gmail swapped, a star starred or a row selected, changes the ground and the ink the
 * walk decided from, and what inherits from the element was decided against it. What the walk
 * wrote is taken back first, then the subtree is walked as new; an editor in it stays skipped.
 */
export const themeAfresh = (
  element: Element,
  theme: Theme,
  skip: string = EDITOR
): Themed => {
  const { mark } = theme;
  if (element.getAttribute(mark) === SKIPPED) {
    return NOTHING;
  }
  release(element, mark);
  for (const marked of element.querySelectorAll(
    `[${mark}]:not([${mark}="${SKIPPED}"])`
  )) {
    release(marked, mark);
  }
  settle(element);
  return themeTree(element, theme, skip);
};

const COLOUR_TRANSITION = /color|background|shadow/u;

/**
 * Ends at once every colour transition under `root`. Gmail eases its states' colours (a reply
 * box's border over 0.15 s), and a computed style read during one answers the colour it starts
 * from, which the walk would decide from and the state then leave behind; an override eased in
 * would show Gmail's light colour fading out.
 */
export const settle = (root: Element): void => {
  if (!("getAnimations" in root) || typeof CSSTransition === "undefined") {
    return;
  }
  for (const animation of root.getAnimations({ subtree: true })) {
    if (
      animation instanceof CSSTransition &&
      COLOUR_TRANSITION.test(animation.transitionProperty)
    ) {
      animation.finish();
    }
  }
};

/** Turns a dark image on a darkened ground light, marking it as the walk marks what it writes. */
export const turnLight = (image: HTMLImageElement, mark: string): void => {
  const value = image.getAttribute(mark);
  if (value === null || value.charAt(1) === LOOKED) {
    image.setAttribute(mark, writtenValue(value?.charAt(0) ?? PLAIN, image));
  }
  image.style.setProperty("filter", TURN_LIGHT, "important");
};

// What a walk writes, each with `!important`; nothing else in a style attribute is the theme's.
const WRITTEN = [
  "background-color",
  "background-image",
  "box-shadow",
  "color",
  "filter",
  ...SIDES.map((side) => `border-${side}-color`),
];

const declarationsOf = (style: CSSStyleDeclaration): string =>
  Array.from(
    style,
    (property) =>
      `${property}:${style.getPropertyValue(property)}:${style.getPropertyPriority(property)}`
  )
    .toSorted()
    .join(";");

/**
 * Takes back what a walk wrote on `element`, from the `style` attribute it had (`had`, undefined
 * for none), leaving whatever Gmail wrote there since, such as a menu's position: a declaration
 * of the theme's is `!important`, and Gmail's own writes replace one rather than add to it. When
 * nothing else changed, the attribute is put back to the very text it had, so a body Gmail quotes
 * into a reply goes out as the mail wrote it.
 */
const takeBack = (element: HTMLElement, had: string | undefined): void => {
  const before = element.ownerDocument.createElement("div").style;
  before.cssText = had ?? "";
  const { style } = element;
  for (const property of WRITTEN) {
    if (style.getPropertyPriority(property) === "important") {
      const was = before.getPropertyValue(property);
      if (was === "") {
        style.removeProperty(property);
      } else {
        style.setProperty(property, was, before.getPropertyPriority(property));
      }
    }
  }
  if (declarationsOf(style) !== declarationsOf(before)) {
    return;
  }
  if (had === undefined) {
    element.removeAttribute("style");
  } else {
    element.setAttribute("style", had);
  }
};

/** Puts back what the theme wrote on `element`, its `style` as the mail had it, and takes its mark off. */
export const release = (element: Element, mark: string): void => {
  const value = element.getAttribute(mark) ?? "";
  const kind = value.charAt(1);
  if ((kind === NO_STYLE || kind === HAD_STYLE) && isHtml(element)) {
    takeBack(element, kind === HAD_STYLE ? value.slice(2) : undefined);
  }
  element.removeAttribute(mark);
  element.removeAttribute(turnedOf(mark));
};

/** Puts back what the theme wrote under `root`, each element's `style` as the mail had it, and takes its marks off. */
export const releaseTree = (root: ParentNode, mark: string): number => {
  const marked = root.querySelectorAll(`[${mark}]`);
  for (const element of marked) {
    release(element, mark);
  }
  return marked.length;
};

/**
 * Marks an editor skipped, putting back what the theme wrote on it and in it first: a reply or a
 * forward quotes the mail's markup, marks and overrides with it, and an element made editable after
 * it was themed holds the overrides it was given, either of which would go out with the message.
 */
export const skipEditor = (editor: Element, mark: string): void => {
  if (editor.getAttribute(mark) === SKIPPED) {
    return;
  }
  release(editor, mark);
  releaseTree(editor, mark);
  editor.setAttribute(mark, SKIPPED);
};

/**
 * Puts back what the theme wrote on what arrived in or with an editor, which Gmail sends as the
 * mail: `element` and what it holds when it landed inside one, and otherwise whatever an editor it
 * brought holds, as when Gmail quotes a marked body into a reply or a forward.
 */
export const releaseArrived = (
  element: Element,
  mark: string,
  inEditor: boolean
): void => {
  if (!inEditor) {
    for (const marked of element.querySelectorAll(`${EDITOR} [${mark}]`)) {
      release(marked, mark);
    }
    return;
  }
  if (element.hasAttribute(mark)) {
    release(element, mark);
  }
  releaseTree(element, mark);
};

/**
 * The feature's style sheet, in a layer, which is what lets its `!important` beat a mail's own
 * `!important` whatever its selector's weight. An element the walk left without a ground of its
 * own, on a ground it darkened, keeps that ground while the pointer is over it: a mail's own
 * `:hover` rule would paint its light hover ground under the text the walk lightened, the walk
 * cannot see a `:hover` rule, and a ground it darkened is held already by its inline `!important`.
 * A pseudo-element's dark icon is turned light here, since no inline style reaches it. An editor
 * the walk reached is turned over whole, its pictures turned back, since Gmail sends what the
 * editor holds as the mail and no override may be written into it: Gmail's own dark ink turned
 * over reads light, a colour the writer picked keeps its hue, and the ground stays clear so the
 * darkened one shows through.
 */
export const themeSheet = (mark: string): string => {
  const turned = turnedOf(mark);
  const editor = `${EDITOR}[${mark}="${SKIPPED}"]`;
  return `@layer meru-dark {
:is(.a3s, [data-meru-clipped]) [${mark}^="${HOLD}"]:hover { background-color: transparent !important; }
[${turned}~="before"]::before, [${turned}~="after"]::after { filter: ${TURN_LIGHT} !important; }
${editor} { background-color: transparent !important; caret-color: ${EDITOR_INK} !important; color: ${EDITOR_INK} !important; filter: ${TURN_LIGHT} !important; }
${editor} :is(img, video) { filter: ${TURN_LIGHT} !important; }
}`;
};
