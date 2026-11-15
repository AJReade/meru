/** The names interface text keeps capitalised after its first word beside the catalog's app names, which hold Google's apps: the product, Google, the system's places and the acronyms. A generic word such as Calendar or Chat passes only as a catalog app's name. */
export const INTERFACE_NAMES: readonly string[] = [
  "CSS",
  "File Explorer",
  "Finder",
  "Google",
  "KB",
  "Meru",
  "Meru Pro",
  "URL",
];

const escape = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** The words of `text` out of sentence case, empty for none: a sentence whose first word starts in lower case, and after that word each word, or part of a hyphenated word, that starts with a capital and belongs to none of `names`. An ampersand marking an access key is read past, and a word with no letter, such as a placeholder, is no first word to fault. */
export const outOfSentenceCase = (
  text: string,
  names: readonly string[]
): string[] => {
  let rest = text.replaceAll("&", "");
  for (const name of names.toSorted((a, b) => b.length - a.length)) {
    rest = rest.replaceAll(
      new RegExp(`(?<![\\p{L}\\d])${escape(name)}(?![\\p{L}\\d])`, "gu"),
      "#"
    );
  }
  return rest
    .trim()
    .split(/(?<=[.!?])\s+/u)
    .flatMap((sentence) => {
      const [first = "", ...parts] = sentence
        .split(/\s+/u)
        .flatMap((word) => word.split("-"));
      return [
        ...(/^[^\p{L}\d]*\p{Ll}/u.test(first) ? [first] : []),
        ...parts.filter((part) => /^[^\p{L}\d]*\p{Lu}/u.test(part)),
      ];
    });
};
