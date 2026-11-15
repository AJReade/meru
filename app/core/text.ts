/** The names interface text keeps capitalised after its first word: the product, Google's apps beyond the catalog's own names, the system's places and dialogs, and the acronyms. */
export const INTERFACE_NAMES: readonly string[] = [
  "1Password",
  "CSS",
  "Calendar",
  "Chat",
  "File Explorer",
  "Finder",
  "Gmail",
  "Google",
  "Meet",
  "Meru",
  "Meru Pro",
  "Save As",
  "Touch ID",
  "URL",
  "Windows Hello",
];

const escape = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** The words of `text` after its first that start with a capital and belong to none of `names`; empty for sentence case. An ampersand marking an access key is read past. */
export const capitalsOutOfPlace = (
  text: string,
  names: readonly string[]
): string[] => {
  let rest = text.replaceAll("&", "");
  for (const name of names.toSorted((a, b) => b.length - a.length)) {
    rest = rest.replaceAll(
      new RegExp(`(?<![\\p{L}\\d])${escape(name)}(?![\\p{L}\\d])`, "gu"),
      "name"
    );
  }
  return rest
    .split(/\s+/u)
    .slice(1)
    .filter((word) => /^[^\p{L}\d]*\p{Lu}/u.test(word));
};
