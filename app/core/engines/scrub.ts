/** The address every `mailto:` link becomes. */
export const EMAIL_PLACEHOLDER = "person@example.com";

/** The origin an address outside Google's own becomes. */
export const ORIGIN_PLACEHOLDER = "https://example.com";

/** What a path or fragment segment that is not one of Gmail's own words becomes. */
export const SEGMENT_PLACEHOLDER = "x";

// The names Gmail gives its own controls, as an `aria-label`, a tooltip, a title, an alt text or a control's text. Anything else a page says may be the user's: a name, an address, a subject, a label.
const CONTROL_WORDS = new Set([
  "Advanced search options",
  "All Mail",
  "Archive",
  "Back to Inbox",
  "Categories",
  "Chat",
  "Compose",
  "Delete",
  "Drafts",
  "Expand all",
  "Forums",
  "Forward",
  "Gmail",
  "Google apps",
  "Important",
  "In new window",
  "Inbox",
  "Labels",
  "Less",
  "Main menu",
  "Mark as read",
  "Mark as unread",
  "Meet",
  "More",
  "More email options",
  "Move to",
  "Newer",
  "Not starred",
  "Older",
  "Primary",
  "Print all",
  "Promotions",
  "Refresh",
  "Reply",
  "Reply all",
  "Report spam",
  "Scheduled",
  "Search mail",
  "Select",
  "Send",
  "Sent",
  "Settings",
  "Show search options",
  "Show trimmed content",
  "Snooze",
  "Snoozed",
  "Social",
  "Spam",
  "Starred",
  "Support",
  "Trash",
  "Updates",
  "Upgrade",
]);

// Gmail's views, the first segment of the fragment that addresses them.
const VIEWS = new Set([
  "all",
  "category",
  "chats",
  "drafts",
  "imp",
  "inbox",
  "label",
  "scheduled",
  "search",
  "sent",
  "settings",
  "snoozed",
  "spam",
  "starred",
  "trash",
]);

// A view whose next segment is the user's own words: a label's name, a category or a search.
const NAMED_VIEWS = new Set(["label", "category", "search"]);

const ID_ATTRIBUTES = new Set([
  "data-legacy-last-message-id",
  "data-legacy-last-non-draft-message-id",
  "data-legacy-message-id",
  "data-legacy-thread-id",
  "data-message-id",
  "data-thread-id",
]);

// ARIA states and properties whose values are tokens or numbers rather than words a page wrote.
const ARIA_TOKENS = new Set([
  "aria-busy",
  "aria-checked",
  "aria-current",
  "aria-disabled",
  "aria-expanded",
  "aria-haspopup",
  "aria-hidden",
  "aria-level",
  "aria-live",
  "aria-modal",
  "aria-multiselectable",
  "aria-orientation",
  "aria-posinset",
  "aria-pressed",
  "aria-readonly",
  "aria-required",
  "aria-selected",
  "aria-setsize",
]);

// ARIA properties that name other elements by id.
const ARIA_REFERENCES = new Set([
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-labelledby",
  "aria-owns",
]);

const WORDED = new Set(["aria-label", "data-tooltip", "title", "alt"]);

// A form field's name compose and search are selected by.
const FIELD_NAMES = new Set(["bcc", "cc", "q", "subjectbox", "to"]);

// The values of a mailbox address's `view` that name one of Gmail's own pages, such as the print view a clipped message links to.
const VIEW_PARAMETERS = new Set(["lg", "om", "pt", "att", "btop", "cv"]);

const TOKEN = /^[\w-]{1,24}$/u;
// The classes and ids Gmail generates are short words; `:1a` is the shape of the ids it numbers.
const GENERATED = /^:?[A-Za-z\d][\w-]{0,31}$/u;
const PATH_DATA = /^[\d\s.,MmLlHhVvCcSsQqTtAaZz-]+$/u;
const PLAIN_SEGMENT = /^(?:[a-z]{1,16}|\d{1,3})$/u;
const GOOGLE_HOST = /^(?:[\w-]+\.)*google\.com$/u;
const ADDRESS =
  /^(?:(?<scheme>[a-z][\w+.-]*):\/\/(?<host>[^/?#]*))?(?<path>[^?#]*)(?:\?(?<query>[^#]*))?(?<hash>#.*)?$/iu;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const TAG =
  /<(?<closing>\/?)(?<name>[a-z][\w-]*)(?<attrs>(?:"[^"]*"|'[^']*'|[^>"'])*)>/giu;
const ATTRIBUTE =
  /(?<name>[A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'=<>`]+)))?/gu;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/gu;
const DOCTYPE = /^\s*<!doctype[^>]*>/iu;
// A script's and a style's contents are dropped whole: Gmail inlines its session state, keys and tokens in one, and avatar addresses in the other.
const RAW_TEXT =
  /(?<open><(?<name>script|style)\b(?:"[^"]*"|'[^']*'|[^>"'])*>)[\s\S]*?(?<close><\/\k<name>\s*>)/giu;

interface Tag {
  readonly attrs: string;
  readonly closing: boolean;
  /** An element with no content of its own, whose close tag is never looked for. */
  readonly empty: boolean;
  /** Where the tag ends in the document, past its `>`. */
  readonly end: number;
  readonly name: string;
  readonly raw: string;
  readonly start: number;
}

/** Every tag of the document in order, as positions into it. */
export const tagsOf = (html: string): readonly Tag[] => {
  const found: Tag[] = [];
  for (const match of html.matchAll(TAG)) {
    const raw = match.groups?.name;
    const attrs = match.groups?.attrs;
    if (raw === undefined || attrs === undefined) {
      continue;
    }
    const name = raw.toLowerCase();
    const start = match.index;
    found.push({
      attrs,
      closing: match.groups?.closing === "/",
      empty: VOID_ELEMENTS.has(name) || attrs.trimEnd().endsWith("/"),
      end: start + match[0].length,
      name,
      raw,
      start,
    });
  }
  return found;
};

/** A placeholder per original value, the same one each time it is seen, numbered per kind. */
const makeIds = () => {
  const seen = new Map<string, string>();
  const counts = new Map<string, number>();
  return (value: string, kind: string): string => {
    const key = `${kind}\u0000${value}`;
    const known = seen.get(key);
    if (known !== undefined) {
      return known;
    }
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    const made = `${kind}-${next}`;
    seen.set(key, made);
    return made;
  };
};

type Ids = ReturnType<typeof makeIds>;

/** A fragment with Gmail's view kept, the user's words in it numbered, and anything else a placeholder. */
const fragmentShape = (hash: string, ids: Ids): string => {
  const [view = "", ...rest] = hash.slice(1).split("/");
  if (!VIEWS.has(view)) {
    return hash === "#" ? hash : `#${SEGMENT_PLACEHOLDER}`;
  }
  const shaped = rest.map((segment, index) => {
    if (index === 0 && NAMED_VIEWS.has(view)) {
      return ids(segment, view);
    }
    return ids(segment, "thread");
  });
  return `#${[view, ...shaped].join("/")}`;
};

const originOf = (
  scheme: string | undefined,
  host: string | undefined
): string => {
  if (scheme === undefined || host === undefined) {
    return "";
  }
  const google =
    GOOGLE_HOST.test(host.toLowerCase()) && /^https?$/iu.test(scheme);
  return google
    ? `${scheme.toLowerCase()}://${host.toLowerCase()}`
    : ORIGIN_PLACEHOLDER;
};

/** What of a Google address's query names one of Gmail's own pages: its `view`, and the message a print view shows, numbered; the rest of the query is the user's. */
const queryShape = (query: string | undefined, ids: Ids): string => {
  // An attribute's text arrives with its ampersands still escaped.
  const parameters = new Map(
    (query ?? "")
      .replaceAll("&amp;", "&")
      .split("&")
      .map((pair): [string, string] => {
        const at = pair.indexOf("=");
        return at === -1 ? [pair, ""] : [pair.slice(0, at), pair.slice(at + 1)];
      })
  );
  const view = parameters.get("view");
  if (view === undefined || !VIEW_PARAMETERS.has(view)) {
    return "";
  }
  const message = parameters.get("permmsgid");
  return message === undefined
    ? `?view=${view}`
    : `?view=${view}&permmsgid=${ids(message, "message")}`;
};

/** The shape of an address: Google's origins kept and any other made one placeholder, each path segment that is not a plain word replaced, the query dropped but for what names a Gmail page, and the fragment as Gmail's views shape it. */
export const addressShape = (address: string, ids: Ids = makeIds()): string => {
  if (address.toLowerCase().startsWith("mailto:")) {
    return `mailto:${EMAIL_PLACEHOLDER}`;
  }
  const parts = ADDRESS.exec(address)?.groups;
  if (parts === undefined) {
    return SEGMENT_PLACEHOLDER;
  }
  const { scheme, host, path = "", query, hash } = parts;
  const origin = originOf(scheme, host);
  // A path on someone else's site says what the user visited there, so only Google's own keeps its words.
  const foreign = origin === ORIGIN_PLACEHOLDER;
  const shapedPath = path
    .split("/")
    .map((segment) =>
      segment === "" || (!foreign && PLAIN_SEGMENT.test(segment))
        ? segment
        : SEGMENT_PLACEHOLDER
    )
    .join("/");
  const view = foreign ? "" : queryShape(query, ids);
  return `${origin}${shapedPath}${view}${hash === undefined ? "" : fragmentShape(hash, ids)}`;
};

/** An address in mail, numbered by its domain, so senders of one domain still share it and no domain or name is kept. */
const emailShape = (value: string, ids: Ids): string | undefined => {
  const at = value.lastIndexOf("@");
  return at === -1
    ? undefined
    : `person@${ids(value.slice(at + 1).toLowerCase(), "domain")}.example.com`;
};

const escapeAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const tokenOf = (value: string): string | undefined =>
  TOKEN.test(value) ? value : undefined;

const generatedOf = (value: string): string | undefined => {
  const kept = value.split(/\s+/u).filter((one) => GENERATED.test(one));
  return kept.length === 0 ? undefined : kept.join(" ");
};

const wordOf = (value: string): string | undefined =>
  CONTROL_WORDS.has(value) ? value : undefined;

type Keep = (value: string, ids: Ids, tag: Tag) => string | undefined;

// Every attribute a fixture keeps, and what of its value; any other is dropped.
const KEPT: Readonly<Record<string, Keep>> = {
  class: generatedOf,
  d: (value) => (PATH_DATA.test(value) ? value : undefined),
  act: tokenOf,
  dir: tokenOf,
  // An attachment's address in Gmail's `type:name:address` form, which a chip carries for a drag out; only that it has one is a marker.
  download_url: () => SEGMENT_PLACEHOLDER,
  email: emailShape,
  gh: tokenOf,
  href: (value, ids) => addressShape(value, ids),
  id: (value) => (GENERATED.test(value) ? value : undefined),
  name: (value) => (FIELD_NAMES.has(value) ? value : undefined),
  role: tokenOf,
  tabindex: (value) => (/^-?\d{1,3}$/u.test(value) ? value : undefined),
  type: tokenOf,
  viewbox: (value) => (/^[\d\s.-]+$/u.test(value) ? value : undefined),
  ...Object.fromEntries(
    [...ID_ATTRIBUTES].map((name): [string, Keep] => [
      name,
      (value, ids) =>
        ids(value, name.includes("message") ? "message" : "thread"),
    ])
  ),
  ...Object.fromEntries(
    [...ARIA_REFERENCES].map((name): [string, Keep] => [name, generatedOf])
  ),
  ...Object.fromEntries(
    [...ARIA_TOKENS].map((name): [string, Keep] => [name, tokenOf])
  ),
  ...Object.fromEntries(
    [...WORDED].map((name): [string, Keep] => [name, wordOf])
  ),
};

const rewriteTag = (
  tag: Tag,
  ids: Ids,
  allowed: Readonly<Record<string, Keep>> = KEPT
): string => {
  if (tag.closing) {
    return `</${tag.raw}>`;
  }
  const kept: string[] = [];
  for (const match of tag.attrs.matchAll(ATTRIBUTE)) {
    const raw = match.groups?.name;
    const name = raw?.toLowerCase();
    const value =
      match.groups?.double ?? match.groups?.single ?? match.groups?.bare ?? "";
    if (raw === undefined || name === undefined) {
      continue;
    }
    const scrubbed = Object.hasOwn(allowed, name)
      ? allowed[name]?.(value, ids, tag)
      : undefined;
    if (scrubbed !== undefined) {
      kept.push(` ${raw}="${escapeAttribute(scrubbed)}"`);
    }
  }
  const selfClosing = tag.attrs.trimEnd().endsWith("/") ? " /" : "";
  return `<${tag.raw}${kept.join("")}${selfClosing}>`;
};

/** A text as long as `text` with every character but whitespace an `x`, unless it is one of Gmail's own control words. */
const placeholderOf = (text: string): string =>
  CONTROL_WORDS.has(text.trim()) ? text : text.replaceAll(/\S/gu, "x");

/**
 * The captured document with nothing of the user's left, so it can be checked into a public
 * repository as a fixture. It keeps what Gmail itself writes and drops the rest: every text becomes
 * a placeholder of its length unless it is one of Gmail's own control words, every attribute not on
 * the allowlist goes (roles, ARIA states, generated classes and ids, icon path data and Gmail's own
 * control names stay), a thread's or message's id becomes a counter, an address keeps only its
 * shape, and comments, scripts' and styles' contents go whole. The counters start afresh on every
 * call, so the same capture always scrubs to the same text.
 */
export const scrubHtml = (input: string): string => {
  const ids = makeIds();
  const doctype = DOCTYPE.exec(input)?.[0].trim();
  const html = input
    .replace(DOCTYPE, "")
    .replaceAll(COMMENT, "")
    .replaceAll(RAW_TEXT, "$<open>$<close>");
  let out = doctype === undefined ? "" : `${doctype}\n`;
  let cursor = 0;
  let raw = false;
  for (const tag of tagsOf(html)) {
    const text = html.slice(cursor, tag.start);
    out += raw ? "" : placeholderOf(text);
    out += rewriteTag(tag, ids);
    raw = !tag.closing && (tag.name === "script" || tag.name === "style");
    cursor = tag.end;
  }
  return out + placeholderOf(html.slice(cursor));
};

// A run of digits this long in a body's class, id or style is a message's id, which Gmail writes into the names it gives a mail's own classes (`msg-…`, `m_…`).
// A hex colour's digits follow its `#` or a hex letter, and stay.
const DIGIT_RUN = /(?<![#\da-f])\d{6,}/giu;
const CSS_URL = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/giu;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//gu;
const DIMENSION = /^\d{1,4}(?:\.\d+)?(?:%|px)?$/u;
const COLOUR = /^#?[\da-z]{1,20}$/iu;
const STYLE_BLOCK =
  /(?<open><style\b(?:"[^"]*"|'[^']*'|[^>"'])*>)(?<css>[\s\S]*?)(?<close><\/style\s*>)/giu;
const SCRIPT_BLOCK =
  /(?<open><script\b(?:"[^"]*"|'[^']*'|[^>"'])*>)[\s\S]*?(?<close><\/script\s*>)/giu;

/** A grey box of the given size, so a mail's layout keeps its images' boxes while nothing of the pictures survives. */
export const imagePlaceholder = (width: number, height: number): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#9e9e9e"/></svg>`)}`;

const UNSIZED_IMAGE = imagePlaceholder(1, 1);

/** A mail's CSS with every address it loads made a placeholder image and message ids made zero. */
const mailCss = (css: string): string =>
  css
    .replaceAll(CSS_COMMENT, "")
    .replaceAll(CSS_URL, `url("${UNSIZED_IMAGE}")`)
    .replaceAll(DIGIT_RUN, "0");

const sizeOf = (tag: Tag, name: string): number => {
  const found = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d{1,4})`, "iu").exec(
    tag.attrs
  )?.[1];
  return found === undefined ? 1 : Number(found);
};

const dimensionOf = (value: string): string | undefined =>
  DIMENSION.test(value) ? value : undefined;

const MAIL_KEPT: Readonly<Record<string, Keep>> = {
  ...KEPT,
  align: tokenOf,
  background: () => UNSIZED_IMAGE,
  bgcolor: (value) => (COLOUR.test(value) ? value : undefined),
  border: dimensionOf,
  cellpadding: dimensionOf,
  cellspacing: dimensionOf,
  class: (value) => generatedOf(value.replaceAll(DIGIT_RUN, "0")),
  color: (value) => (COLOUR.test(value) ? value : undefined),
  colspan: dimensionOf,
  height: dimensionOf,
  id: (value) => {
    const shaped = value.replaceAll(DIGIT_RUN, "0");
    return GENERATED.test(shaped) ? shaped : undefined;
  },
  rowspan: dimensionOf,
  size: dimensionOf,
  src: (_value, _ids, tag) =>
    tag.name === "img"
      ? imagePlaceholder(sizeOf(tag, "width"), sizeOf(tag, "height"))
      : undefined,
  style: mailCss,
  valign: tokenOf,
  width: dimensionOf,
};

/**
 * A captured message body with nothing of the user's left, for the corpus the dark theme's tests read.
 * It differs from `scrubHtml` only in what a mail's look is made of: inline styles, `<style>` rules
 * and the presentational attributes (`bgcolor`, `color`, sizes, alignment) stay, every image becomes
 * a grey placeholder of its `width` and `height`, every address CSS loads a placeholder image, and
 * a message id written into a class, an id or a rule becomes zero. Texts, addresses and every other
 * attribute go as `scrubHtml` takes them.
 */
export const scrubMail = (input: string): string => {
  const ids = makeIds();
  const styles: string[] = [];
  const html = input
    .replaceAll(COMMENT, "")
    .replaceAll(SCRIPT_BLOCK, "")
    .replaceAll(STYLE_BLOCK, (_match, _open, css: string) => {
      styles.push(mailCss(css));
      return `<style></style>`;
    });
  let out = "";
  let cursor = 0;
  let style = 0;
  let inStyle = false;
  for (const tag of tagsOf(html)) {
    out += inStyle ? "" : placeholderOf(html.slice(cursor, tag.start));
    out += rewriteTag(tag, ids, MAIL_KEPT);
    inStyle = !tag.closing && tag.name === "style";
    if (inStyle) {
      out += styles[style] ?? "";
      style += 1;
    }
    cursor = tag.end;
  }
  return out + placeholderOf(html.slice(cursor));
};
