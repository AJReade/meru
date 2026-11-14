import type { DialogPort } from "../../core/ports.ts";

/** File dialogs a test answers one at a time, in the order they were asked. */
export class FakeDialogs implements DialogPort {
  /** Each dialog still open, with the path it started at. */
  readonly open: {
    readonly kind: "save" | "folder";
    readonly defaultPath: string;
    readonly answer: (path: string | null) => void;
  }[] = [];

  readonly save = async (defaultPath: string) =>
    await this.#ask("save", defaultPath);

  readonly chooseFolder = async (defaultPath: string) =>
    await this.#ask("folder", defaultPath);

  /** Answers the dialog asked first. */
  answer(path: string | null) {
    const [first] = this.open.splice(0, 1);
    if (first === undefined) {
      throw new Error("No dialog is open");
    }
    first.answer(path);
  }

  async #ask(kind: "save" | "folder", defaultPath: string) {
    const { promise, resolve } = Promise.withResolvers<string | null>();
    this.open.push({ answer: resolve, defaultPath, kind });
    return await promise;
  }
}
