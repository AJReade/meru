const HTML = "http://www.w3.org/1999/xhtml";

/** What mail is written in: text and its formatting, lists, tables and images. */
const KEPT_ELEMENTS = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "b",
  "bdi",
  "bdo",
  "big",
  "blockquote",
  "br",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "font",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "tt",
  "u",
  "ul",
  "var",
  "wbr",
]);

/** Taken out with everything inside them, since what they hold is code, a style sheet, a form, a frame or media rather than the message's text; every other element off the list gives way to what it holds. */
const DROPPED_ELEMENTS = new Set([
  "applet",
  "area",
  "audio",
  "base",
  "button",
  "canvas",
  "datalist",
  "dialog",
  "embed",
  "form",
  "frame",
  "frameset",
  "head",
  "iframe",
  "input",
  "link",
  "map",
  "marquee",
  "meta",
  "noembed",
  "noframes",
  "noscript",
  "object",
  "optgroup",
  "option",
  "output",
  "param",
  "picture",
  "plaintext",
  "script",
  "select",
  "slot",
  "source",
  "style",
  "template",
  "textarea",
  "title",
  "track",
  "video",
  "xmp",
]);

const KEPT_ATTRIBUTES = new Set([
  "abbr",
  "align",
  "alt",
  "background",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "cite",
  "color",
  "colspan",
  "datetime",
  "dir",
  "face",
  "headers",
  "height",
  "href",
  "hspace",
  "lang",
  "nowrap",
  "reversed",
  "rowspan",
  "scope",
  "size",
  "span",
  "src",
  "start",
  "style",
  "summary",
  "title",
  "type",
  "valign",
  "value",
  "vspace",
  "width",
]);

const URL_ATTRIBUTES = new Set(["background", "cite", "href", "src"]);

const URL_PROTOCOLS = new Set(["cid:", "http:", "https:", "mailto:"]);

// A declaration that loads something or runs something, written plainly or behind a CSS escape, which could spell either.
const UNSAFE_STYLE =
  /url\(|image-set\(|image\(|expression|behavior|-moz-binding|\\/iu;

const allowedUrl = (value: string, base: string): boolean =>
  URL.canParse(value, base) && URL_PROTOCOLS.has(new URL(value, base).protocol);

const keepsAttribute = (name: string, value: string, base: string): boolean =>
  KEPT_ATTRIBUTES.has(name) &&
  (!URL_ATTRIBUTES.has(name) || allowedUrl(value, base)) &&
  (name !== "style" || !UNSAFE_STYLE.test(value));

const cleanAttributes = (element: Element, base: string): void => {
  for (const name of element.getAttributeNames()) {
    if (!keepsAttribute(name, element.getAttribute(name) ?? "", base)) {
      element.removeAttribute(name);
    }
  }
  // A link with no target would replace Gmail itself rather than open through the window-open handler.
  if (element.localName === "a" && element.hasAttribute("href")) {
    element.setAttribute("target", "_blank");
    element.setAttribute("rel", "noopener noreferrer");
  }
};

// Each child is looked at once: one unwrapped hands up children already cleaned, so the walk moves on to the sibling that followed it. An element is known by its tag name, since a prefixed one such as Outlook's `o:p` would otherwise pass for the `p` after its prefix.
const cleanChildren = (parent: Element, base: string): void => {
  let child = parent.firstChild;
  while (child !== null) {
    const next = child.nextSibling;
    if (!(child instanceof Element)) {
      if (child.nodeType !== child.TEXT_NODE) {
        child.remove();
      }
    } else if (
      child.namespaceURI !== HTML ||
      DROPPED_ELEMENTS.has(child.nodeName.toLowerCase())
    ) {
      child.remove();
    } else {
      cleanChildren(child, base);
      if (KEPT_ELEMENTS.has(child.nodeName.toLowerCase())) {
        cleanAttributes(child, base);
      } else {
        child.replaceWith(...child.childNodes);
      }
    }
    child = next;
  }
};

/** Leaves only the elements and attributes mail is written in, every address `http`, `https`, `mailto` or `cid` resolved against `base`, and every link opening a window: no style sheet, no SVG or MathML, no frame, no form, no handler, no id or class that could pass for Gmail's own. */
export const sanitise = (root: Element, base: string): void => {
  cleanChildren(root, base);
  cleanAttributes(root, base);
};
