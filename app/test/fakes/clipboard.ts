import type { ClipboardPort } from "../../core/ports.ts";

/** What was put on the clipboard, newest last: text, or an address with the bookmark's title. */
export type Copied =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bookmark"; readonly title: string; readonly url: string };

export class FakeClipboard implements ClipboardPort {
  readonly copied: Copied[] = [];
  /** Whether the next writes are refused, as a system clipboard another app holds can refuse one. */
  refusing = false;

  readonly writeText = async (text: string) => {
    await this.#write({ kind: "text", text });
  };

  readonly writeBookmark = async (title: string, url: string) => {
    await this.#write({ kind: "bookmark", title, url });
  };

  async #write(copied: Copied): Promise<void> {
    await Promise.resolve();
    if (this.refusing) {
      throw new Error("The clipboard refused the write");
    }
    this.copied.push(copied);
  }
}
