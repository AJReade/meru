import { createHash } from "node:crypto";

// Gmail numbers a body's ids in the order it drew them and the formatter rewraps what the capture wrote, so neither counts toward the hash, and a mail captured again keeps its name.
const essence = (body: string) =>
  body
    .replaceAll(/\sid="[^"]*"/gu, "")
    .replaceAll(/\s+/gu, "")
    .replaceAll("/>", ">");

/** The corpus file a scrubbed body is written to: a kind a mail was sent to fill by its name alone, which it holds once, and a shape the account's own mail takes by its name and a hash of the body, so a capture adds a new body beside those it already wrote. */
export const corpusFileName = (
  kind: string,
  named: boolean,
  body: string
): string =>
  named
    ? `${kind}.html`
    : `${kind}-${createHash("sha256").update(essence(body)).digest("hex").slice(0, 8)}.html`;
