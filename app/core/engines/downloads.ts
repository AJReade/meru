import type { Download } from "../records/download.ts";
import type { Platform } from "../records/platform.ts";

/** What two names share when a disk would take them for one file. Disks on macOS and Windows fold case by default, more widely than either JavaScript mapping: lowering alone keeps `ς` from `σ` and `ß` from `ss`, and raising alone keeps `ẞ` from `ß`. Normalising comes last because raising can leave a decomposed form. Joining names a disk keeps apart, such as `I` and `ı` or any pair on a case-sensitive disk, only costs a ` (1)`. */
export const nameKey = (name: string, platform: Platform): string =>
  platform === "linux"
    ? name
    : name.toLowerCase().toUpperCase().normalize("NFC");

/** The name's extension with its dot, or nothing for a name with none or a dotfile's. */
const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
};

const PREFERRED_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["application/epub+zip", "epub"],
  ["application/gzip", "gz"],
  ["application/json", "json"],
  ["application/msword", "doc"],
  ["application/oxps", "oxps"],
  ["application/pdf", "pdf"],
  ["application/pkcs7-signature", "p7s"],
  ["application/rtf", "rtf"],
  ["application/vnd.android.package-archive", "apk"],
  ["application/vnd.apple.pkpass", "pkpass"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.ms-excel.addin.macroenabled.12", "xlam"],
  ["application/vnd.ms-excel.sheet.binary.macroenabled.12", "xlsb"],
  ["application/vnd.ms-excel.sheet.macroenabled.12", "xlsm"],
  ["application/vnd.ms-excel.template.macroenabled.12", "xltm"],
  ["application/vnd.ms-outlook", "msg"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.ms-powerpoint.addin.macroenabled.12", "ppam"],
  ["application/vnd.ms-powerpoint.presentation.macroenabled.12", "pptm"],
  ["application/vnd.ms-powerpoint.slideshow.macroenabled.12", "ppsm"],
  ["application/vnd.ms-powerpoint.template.macroenabled.12", "potm"],
  ["application/vnd.ms-word.document.macroenabled.12", "docm"],
  ["application/vnd.ms-word.template.macroenabled.12", "dotm"],
  ["application/vnd.oasis.opendocument.presentation", "odp"],
  ["application/vnd.oasis.opendocument.spreadsheet", "ods"],
  ["application/vnd.oasis.opendocument.text", "odt"],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pptx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
    "ppsx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.template",
    "potx",
  ],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    "xltx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    "dotx",
  ],
  ["application/vnd.rar", "rar"],
  ["application/x-7z-compressed", "7z"],
  ["application/x-apple-diskimage", "dmg"],
  ["application/x-gzip", "gz"],
  ["application/x-rar-compressed", "rar"],
  ["application/x-tar", "tar"],
  ["application/x-zip-compressed", "zip"],
  ["application/xml", "xml"],
  ["application/zip", "zip"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/x-m4a", "m4a"],
  ["audio/x-wav", "wav"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
  ["image/gif", "gif"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/pjpeg", "jpg"],
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
  ["image/tiff", "tiff"],
  ["image/vnd.microsoft.icon", "ico"],
  ["image/webp", "webp"],
  ["image/x-icon", "ico"],
  ["message/rfc822", "eml"],
  ["text/calendar", "ics"],
  ["text/css", "css"],
  ["text/csv", "csv"],
  ["text/html", "html"],
  ["text/plain", "txt"],
  ["text/rtf", "rtf"],
  ["text/tab-separated-values", "tsv"],
  ["text/vcard", "vcf"],
  ["text/x-vcard", "vcf"],
  ["text/xml", "xml"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
  ["video/x-msvideo", "avi"],
]);

/** The name with the extension a file of `mimeType` usually has, when it has none and the type is known, since some servers send an attachment under a bare name. */
export const withPreferredExtension = (
  name: string,
  mimeType: string
): string => {
  if (extensionOf(name) !== "") {
    return name;
  }
  const [type = ""] = mimeType.split(";");
  const extension = PREFERRED_EXTENSIONS.get(type.trim().toLowerCase());
  return extension === undefined ? name : `${name}.${extension}`;
};

/** `name (n + 1).ext` after `name (n).ext`, and `name (1).ext` after `name.ext`. */
const nextName = (name: string): string => {
  const extension = extensionOf(name);
  const stem = name.slice(0, name.length - extension.length);
  const { base = stem, count = "0" } =
    /^(?<base>.*)\((?<count>\d+)\)$/u.exec(stem)?.groups ?? {};
  return `${base.trim()} (${Number(count) + 1})${extension}`;
};

/** `suggested` itself, or the first of `name (1).ext`, `name (2).ext` and on that none of `existing` would share a file with on the platform's disks. */
export const uniqueName = (
  existing: Iterable<string>,
  suggested: string,
  platform: Platform
): string => {
  const taken = new Set(
    Array.from(existing, (name) => nameKey(name, platform))
  );
  let candidate = suggested;
  while (taken.has(nameKey(candidate, platform))) {
    candidate = nextName(candidate);
  }
  return candidate;
};

/** How long the history keeps a download, and how many it keeps at most. */
export const HISTORY_DAYS = 30;
export const HISTORY_LIMIT = 200;

const DAY = 86_400_000;

/** The history as it is kept at `now`, newest first: nothing older than `HISTORY_DAYS` and no more than `HISTORY_LIMIT`. */
export const pruneHistory = (
  items: readonly Download[],
  now: number
): readonly Download[] =>
  items
    .filter((item) => now - item.createdAt < HISTORY_DAYS * DAY)
    .toSorted((a, b) => b.createdAt - a.createdAt)
    .slice(0, HISTORY_LIMIT);

/** What the Dock or the taskbar shows of the downloads under way. */
export type DownloadProgress =
  | { readonly kind: "none" }
  | { readonly kind: "indeterminate" }
  | { readonly kind: "fraction"; readonly value: number };

/** The share of the bytes under way that have arrived, counting what finished while others ran so the bar never runs backwards, or indeterminate while any download's size is unknown. */
export const progressOf = (
  active: readonly { readonly received: number; readonly total: number }[],
  finishedBytes: number
): DownloadProgress => {
  if (active.length === 0) {
    return { kind: "none" };
  }
  if (active.some(({ total }) => total <= 0)) {
    return { kind: "indeterminate" };
  }
  const received = active.reduce((sum, item) => sum + item.received, 0);
  const total = active.reduce((sum, item) => sum + item.total, 0);
  return {
    kind: "fraction",
    value: (finishedBytes + received) / (finishedBytes + total),
  };
};
