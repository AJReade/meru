import { act } from "react";
import { describe, expect, it } from "vitest";

import type { Download } from "../../../core/records/download.ts";
import {
  downloads,
  downloadsPushes,
} from "../../../shared/channels/downloads.ts";
import { answer, mountOverlay, settle } from "../../testing.tsx";
import { Downloads } from "./downloads.tsx";
import { relativeTime } from "./relative-time.ts";

const HOUR = 3_600_000;

const item = (id: string, more: Partial<Download> = {}): Download => ({
  createdAt: Date.now() - 2 * HOUR,
  exists: true,
  fileName: `${id}.pdf`,
  filePath: `/Users/me/Downloads/${id}.pdf`,
  id,
  state: "done",
  ...more,
});

const mount = (items: readonly Download[]) =>
  mountOverlay(<Downloads />, [
    answer(downloads.snapshot, { items: [...items] }),
    answer(downloads.openFile, null),
    answer(downloads.showInFolder, null),
    answer(downloads.remove, null),
    answer(downloads.clear, null),
  ]);

const row = (id: string) =>
  document.querySelector<HTMLElement>(`[data-download-id="${id}"]`);

const rowButton = (id: string) => row(id)?.querySelector("button");

const click = (element: Element | null | undefined) => {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const press = (key: string) => {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key })
    );
  });
};

describe(Downloads, () => {
  it("lists the downloads with how long ago each started, a file that has gone struck through and one that failed marked", () => {
    mount([
      item("report"),
      item("moved", { exists: false }),
      item("broken", { exists: false, state: "failed" }),
    ]);
    const texts = ["report", "moved", "broken"].map(
      (id) => row(id)?.textContent
    );
    expect(texts).toStrictEqual([
      `report.pdf${relativeTime(Date.now() - 2 * HOUR, Date.now())}`,
      `moved.pdf${relativeTime(Date.now() - 2 * HOUR, Date.now())} · File moved or deleted`,
      `broken.pdf${relativeTime(Date.now() - 2 * HOUR, Date.now())} · Failed`,
    ]);
    expect(
      ["report", "moved"].map(
        (id) => row(id)?.querySelector(".line-through")?.textContent
      )
    ).toStrictEqual([undefined, "moved.pdf"]);
  });

  it("opens a file by its id on a click, and a file that has gone not at all", async () => {
    const { sentOn } = mount([
      item("report"),
      item("moved", { exists: false }),
    ]);
    click(rowButton("report"));
    click(rowButton("moved"));
    await settle();
    expect(sentOn(downloads.openFile)).toStrictEqual([{ id: "report" }]);
  });

  it("shows a file in its folder, takes one off the list and clears the list, each by its id", async () => {
    const { sentOn } = mount([item("report")]);
    click(row("report")?.querySelector('[aria-label="Show in folder"]'));
    click(row("report")?.querySelector('[aria-label="Remove from history"]'));
    click(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Clear all"
      )
    );
    await settle();
    expect([
      sentOn(downloads.showInFolder),
      sentOn(downloads.remove),
      sentOn(downloads.clear),
    ]).toStrictEqual([[{ id: "report" }], [{ id: "report" }], [{}]]);
  });

  it("moves through the rows with the arrows, opens one with Enter and takes one off with Delete", async () => {
    const { sentOn } = mount([item("a"), item("b"), item("c")]);
    act(() => {
      rowButton("a")?.focus();
    });
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    const focused = document.activeElement === rowButton("c");
    press("Home");
    press("Enter");
    press("End");
    press("ArrowUp");
    press("Delete");
    await settle();
    expect([
      focused,
      sentOn(downloads.openFile),
      sentOn(downloads.remove),
    ]).toStrictEqual([true, [{ id: "a" }], [{ id: "b" }]]);
  });

  it("keeps the keyboard on the list after a Delete, on the row that moved into the removed one's place", async () => {
    const { push, sentOn } = mount([item("a"), item("b"), item("c")]);
    // The dialog moves the focus to its first row a moment after it opens.
    await settle();
    act(() => {
      rowButton("a")?.focus();
    });
    press("ArrowDown");
    press("Delete");
    await settle();
    push(downloadsPushes.changed, { items: [item("a"), item("c")] });
    const afterFirst = document.activeElement === rowButton("c");
    press("Delete");
    await settle();
    push(downloadsPushes.changed, { items: [item("a")] });
    const afterLast = document.activeElement === rowButton("a");
    press("Delete");
    await settle();
    expect([afterFirst, afterLast, sentOn(downloads.remove)]).toStrictEqual([
      true,
      true,
      [{ id: "b" }, { id: "c" }, { id: "a" }],
    ]);
  });

  it("follows the history main pushes, and says so when it is empty", () => {
    const { push } = mount([]);
    const empty = document.body.textContent.includes("No downloads yet");
    push(downloadsPushes.changed, { items: [item("new")] });
    expect([empty, row("new") === null]).toStrictEqual([true, false]);
  });

  it("closes on a click on the backdrop", async () => {
    const { sentOn } = mount([item("report")]);
    const backdrop = document.querySelector<HTMLElement>(
      "[data-slot=dialog-overlay]"
    );
    act(() => {
      for (const name of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        backdrop?.dispatchEvent(
          new PointerEvent(name, { bubbles: true, button: 0 })
        );
      }
      backdrop?.click();
    });
    await settle();
    expect([backdrop !== null, sentOn(downloads.close)]).toStrictEqual([
      true,
      [{}],
    ]);
  });

  it("closes on Escape and when the window loses focus", () => {
    const { sentOn } = mount([item("report")]);
    press("Escape");
    const escaped = sentOn(downloads.close).length;
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect([escaped, sentOn(downloads.close).length]).toStrictEqual([1, 2]);
  });
});
