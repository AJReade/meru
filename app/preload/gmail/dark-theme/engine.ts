import {
  DARK_SURFACE,
  darkBackground,
  darkBorder,
  darkGradient,
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
 * recipient; the walk leaves every editor alone. Compose is themed apart, through an entry of its
 * own on the editor that writes a style sheet rather than inline styles, once it is built.
 */
export const EDITOR = '[contenteditable="true"]';

const SIDES = ["top", "right", "bottom", "left"] as const;

// A ground this dark hides dark artwork drawn for a light page.
const DARK_GROUND = 0.2;

// Gmail draws its own icons in a conversation as dark glyphs on transparent images under these addresses, which a cross-origin image cannot be read to tell; 3.x's list.
const DARK_ICON_PREFIXES = [
  "https://www.gstatic.com/images/icons/material/system_gm/",
  "https://ssl.gstatic.com/ui/v1/icons/mail/gm3/",
];
// Of those, the ones drawn in colour or already light, which turning over would spoil.
const COLOURED_ICONS = [
  "star_googyellow500",
  "archive_white",
  "schedule_send_googblue",
  "label_important_fill_googyellow500",
];

const isDarkIcon = (image: string): boolean =>
  DARK_ICON_PREFIXES.some((prefix) => image.includes(prefix)) &&
  !COLOURED_ICONS.some((name) => image.includes(name));

// Turns a dark glyph light while keeping its hues where it has any.
export const TURN_LIGHT = "invert(1) hue-rotate(180deg)";

/** What reads an element's computed style, which the page gives. */
export type StyleOf = (element: Element) => CSSStyleDeclaration;

/** What a walk needs of the page: the mark it writes and how to read a computed style. */
export interface Theme {
  readonly mark: string;
  readonly styleOf: StyleOf;
}

interface Write {
  readonly element: HTMLElement;
  readonly property: string;
  readonly value: string;
}

interface Frame {
  readonly element: Element;
  /** The opaque colour its parent's content sits on, or undefined over an image, where text is left as the mail set it. */
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
const groundAbove = (root: Element, styleOf: StyleOf): Rgba => {
  for (
    let ancestor = root.parentElement;
    ancestor !== null;
    ancestor = ancestor.parentElement
  ) {
    const colour = parseColour(styleOf(ancestor).backgroundColor);
    if (colour !== undefined && colour.a > 0) {
      return over(darkBackground(colour), DARK_SURFACE);
    }
  }
  return DARK_SURFACE;
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

/** The element's own background and background image, darkened, and the ground they leave for what the element holds. */
const paintBackground = (
  style: CSSStyleDeclaration,
  inherited: Paint,
  write: WriteTo
): Paint => {
  let { ground, darkened } = inherited;
  const background = parseColour(style.backgroundColor);
  if (background !== undefined && background.a > 0) {
    const dark = darkBackground(background);
    if (dark !== background) {
      write("background-color", formatColour(dark));
    }
    darkened = dark !== background || (darkened && ground === undefined);
    ground = over(dark, ground ?? DARK_SURFACE);
  }
  const image = style.backgroundImage;
  if (image.includes("gradient(")) {
    const gradient = darkGradient(image);
    if (gradient.image !== image) {
      write("background-image", gradient.image);
    }
    if (gradient.ground !== undefined) {
      ground = over(gradient.ground, ground ?? DARK_SURFACE);
    }
  } else if (image.includes("url(")) {
    if (isDarkIcon(image)) {
      write("filter", TURN_LIGHT);
    } else {
      ground = undefined;
    }
  }
  return { darkened, ground };
};

const paintBorders = (
  style: CSSStyleDeclaration,
  ground: Rgba,
  write: WriteTo
): void => {
  for (const side of SIDES) {
    // A computed border width is always in pixels.
    const width = Number(
      style.getPropertyValue(`border-${side}-width`).replace("px", "")
    );
    const border = parseColour(style.getPropertyValue(`border-${side}-color`));
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
};

/** Writes what the element's own style needs on the dark page, and answers the ground and the text colour it leaves for its children. */
const paintElement = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
  frame: Frame,
  write: WriteTo
): Painted => {
  const paint = paintBackground(style, frame, write);
  const { ground } = paint;
  const colour = parseColour(style.color);
  if (colour === undefined) {
    return { ...paint, text: frame.parentText };
  }
  // A text that inherits its colour shows what was written on its parent unless it is given its own. A computed colour cannot say whether it was inherited or declared again, so one a mail sets inline or as `<font color>`, as mail does, counts as its own.
  const inherits =
    style.color === frame.parentColour &&
    element.style.color === "" &&
    !element.hasAttribute("color");
  const shown = inherits ? frame.parentText : formatColour(colour);
  const text = formatColour(
    ground === undefined ? colour : darkText(colour, ground)
  );
  if (text !== shown) {
    write("color", text);
  }
  if (ground !== undefined) {
    paintBorders(style, ground, write);
  }
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

// A mark's value is a flag, a kind and, for an element written to, the `style` attribute it had: the flag says whether its hover ground is held (`HOLD`) or not (`PLAIN`), the kind whether the walk only looked at it (`LOOKED`), wrote to an element that had no `style` attribute (`NO_STYLE`) or wrote over the one that follows (`HAD_STYLE`).
const HOLD = "t";
const PLAIN = "-";
const LOOKED = ".";
const NO_STYLE = "0";
const HAD_STYLE = "1";

const writtenValue = (flag: string, element: Element): string => {
  const style = element.getAttribute("style");
  return style === null ? `${flag}${NO_STYLE}` : `${flag}${HAD_STYLE}${style}`;
};

/**
 * Darkens `root` and what it holds, in one pass: every computed style is read before anything is
 * written, since a colour written on a parent changes what its children report. A light background
 * is darkened, a text colour is kept wherever it already reads on its new ground and turned until
 * it does otherwise, a border is darkened, and what sits on an image is left as the mail set it.
 * Every element the walk looks at carries the mark, holding its former `style` when it was written
 * to; one already marked is not written to again, so a walk over a subtree a former walk covered
 * only reaches what is new. Nothing is kept.
 */
export const themeTree = (
  root: Element,
  { mark, styleOf }: Theme,
  skip: string = EDITOR
): Themed => {
  const writes: Write[] = [];
  const images: HTMLImageElement[] = [];
  const touched = new Set<Element>();
  const looked = new Map<Element, string>();
  const stack: Frame[] = [
    {
      darkened: true,
      element: root,
      ground: groundAbove(root, styleOf),
      parentColour: "",
      parentText: "",
    },
  ];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const { element } = frame;
    if (element.matches(skip)) {
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
            }
      );
      if (
        element instanceof HTMLImageElement &&
        !marked &&
        paint.darkened &&
        paint.ground !== undefined &&
        luminance(paint.ground) < DARK_GROUND
      ) {
        images.push(element);
      }
    }
    if (!marked) {
      looked.set(element, holdsHover(style, frame) ? HOLD : PLAIN);
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
  for (const { element, property, value } of writes) {
    element.style.setProperty(property, value, "important");
  }
  return { images, touched: touched.size };
};

const NOTHING: Themed = { images: [], touched: 0 };

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
  const fresh = root.querySelectorAll(`:not([${theme.mark}])`);
  if (fresh.length === 0) {
    return NOTHING;
  }
  const images: HTMLImageElement[] = [];
  let touched = 0;
  let top: Element | undefined;
  for (const element of fresh) {
    // In document order an element's descendants follow it, so one walk from the top takes them all; an editor is never marked, so what it holds is passed over here rather than walked.
    if (top?.contains(element) === true || element.closest(skip) !== null) {
      continue;
    }
    top = element;
    const themed = themeTree(element, theme, skip);
    images.push(...themed.images);
    touched += themed.touched;
  }
  return { images, touched };
};

/** Turns a dark image on a darkened ground light, marking it as the walk marks what it writes. */
export const turnLight = (image: HTMLImageElement, mark: string): void => {
  const value = image.getAttribute(mark);
  if (value === null || value.charAt(1) === LOOKED) {
    image.setAttribute(mark, writtenValue(value?.charAt(0) ?? PLAIN, image));
  }
  image.style.setProperty("filter", TURN_LIGHT, "important");
};

/** Puts back what the theme wrote under `root`, each element's `style` as the mail had it, and takes its marks off. */
export const releaseTree = (root: ParentNode, mark: string): number => {
  const marked = root.querySelectorAll(`[${mark}]`);
  for (const element of marked) {
    const value = element.getAttribute(mark) ?? "";
    const kind = value.charAt(1);
    if (kind === NO_STYLE) {
      element.removeAttribute("style");
    } else if (kind === HAD_STYLE) {
      element.setAttribute("style", value.slice(2));
    }
    element.removeAttribute(mark);
  }
  return marked.length;
};

/**
 * The feature's style sheet: an element the walk left without a ground of its own, on a ground it
 * darkened, keeps that ground while the pointer is over it. A mail's own `:hover` rule would paint
 * its light hover ground under the text the walk lightened; the walk cannot see a `:hover` rule,
 * and a ground it darkened is held already by its inline `!important`. The layer is what lets this
 * rule's `!important` beat a mail's own `!important` whatever its selector's weight.
 */
export const hoverSheet = (mark: string): string =>
  `@layer meru-dark { :is(.a3s, [data-meru-clipped]) [${mark}^="${HOLD}"]:hover { background-color: transparent !important; } }`;
