const hex = (code: number): string => `\\${code.toString(16)} `;

// CSSOM's "serialize a string": NUL becomes U+FFFD, a control character its hex escape, a quote or a backslash escaped by itself. U+2028 and U+2029 end a line in JavaScript though not in CSS, and are escaped too so the text reads the same wherever it is pasted.
const escapeChar = (char: string): string => {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0) {
    return "\uFFFD";
  }
  if (code < 0x20 || code === 0x7f || code === 0x20_28 || code === 0x20_29) {
    return hex(code);
  }
  if (char === '"' || char === "\\") {
    return `\\${char}`;
  }
  return char;
};

/** `value` as a quoted CSS string, from which no text can end the string, the rule or the sheet. */
export const cssString = (value: string): string =>
  `"${Array.from(value, escapeChar).join("")}"`;
