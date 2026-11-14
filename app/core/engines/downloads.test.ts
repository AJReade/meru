import { describe, expect, it } from "vitest";

import type { Download } from "../records/download.ts";
import {
  HISTORY_DAYS,
  HISTORY_LIMIT,
  nameKey,
  countedReceived,
  progressOf,
  pruneHistory,
  takenAmong,
  uniqueName,
  withPreferredExtension,
} from "./downloads.ts";

describe(uniqueName, () => {
  it.each([
    { existing: [], expected: "report.pdf", suggested: "report.pdf" },
    {
      existing: ["report.pdf"],
      expected: "report (1).pdf",
      suggested: "report.pdf",
    },
    {
      existing: ["report.pdf", "report (1).pdf", "report (2).pdf"],
      expected: "report (3).pdf",
      suggested: "report.pdf",
    },
    {
      existing: ["report (4).pdf"],
      expected: "report (5).pdf",
      suggested: "report (4).pdf",
    },
    { existing: ["notes"], expected: "notes (1)", suggested: "notes" },
    {
      existing: ["archive.tar.gz"],
      expected: "archive.tar (1).gz",
      suggested: "archive.tar.gz",
    },
    { existing: [".env"], expected: ".env (1)", suggested: ".env" },
  ])("names $suggested $expected beside $existing", (fixture) => {
    expect(
      uniqueName(fixture.suggested, takenAmong(fixture.existing, "darwin"))
    ).toBe(fixture.expected);
  });

  it("takes a name that differs only in case for the same file on macOS and Windows, and for another on Linux", () => {
    expect(uniqueName("report.pdf", takenAmong(["Report.PDF"], "darwin"))).toBe(
      "report (1).pdf"
    );
    expect(uniqueName("report.pdf", takenAmong(["Report.PDF"], "win32"))).toBe(
      "report (1).pdf"
    );
    expect(uniqueName("report.pdf", takenAmong(["Report.PDF"], "linux"))).toBe(
      "report.pdf"
    );
  });

  it("folds case wider than either mapping alone, and composed and decomposed forms together", () => {
    expect(nameKey("STRASSE", "darwin")).toBe(nameKey("straße", "darwin"));
    expect(nameKey("ΣΟΦΟΣ", "darwin")).toBe(nameKey("σοφος", "darwin"));
    expect(uniqueName("café.txt", takenAmong(["Café.txt"], "darwin"))).toBe(
      "café (1).txt"
    );
  });
});

describe(withPreferredExtension, () => {
  it("adds the type's extension to a bare name and leaves any other alone", () => {
    expect(withPreferredExtension("invoice", "application/pdf")).toBe(
      "invoice.pdf"
    );
    expect(withPreferredExtension("photo", "Image/JPEG; charset=binary")).toBe(
      "photo.jpg"
    );
    expect(withPreferredExtension("invoice.PDF", "image/png")).toBe(
      "invoice.PDF"
    );
    expect(withPreferredExtension("blob", "application/x-unknown")).toBe(
      "blob"
    );
  });
});

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const download = (id: string, age: number): Download => ({
  createdAt: NOW - age,
  exists: true,
  fileName: `${id}.pdf`,
  filePath: `/Downloads/${id}.pdf`,
  id,
  state: "done",
});

describe(pruneHistory, () => {
  it("drops what is older than the history keeps, newest first", () => {
    const kept = pruneHistory(
      [
        download("old", HISTORY_DAYS * DAY),
        download("older", HISTORY_DAYS * DAY + 1),
        download("last week", 7 * DAY),
        download("now", 0),
      ],
      NOW
    );
    expect(kept.map(({ id }) => id)).toStrictEqual(["now", "last week"]);
  });

  it("reads a time after now as now, and drops one further ahead than the history keeps", () => {
    const kept = pruneHistory(
      [
        download("yesterday", DAY),
        download("tomorrow", -DAY),
        download("next year", -365 * DAY),
      ],
      NOW
    );
    expect(kept.map(({ createdAt, id }) => ({ createdAt, id }))).toStrictEqual([
      { createdAt: NOW, id: "tomorrow" },
      { createdAt: NOW - DAY, id: "yesterday" },
    ]);
  });

  it("keeps the newest of more than the limit", () => {
    const many = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) =>
      download(`d${index}`, index * 1000)
    );
    const kept = pruneHistory(many.toReversed(), NOW);
    expect(kept).toHaveLength(HISTORY_LIMIT);
    expect(kept[0]?.id).toBe("d0");
    expect(kept.at(-1)?.id).toBe(`d${HISTORY_LIMIT - 1}`);
  });
});

const value = (
  active: readonly { received: number; total: number }[],
  settled: number
) => {
  const progress = progressOf(active, settled);
  return progress.kind === "fraction" ? progress.value : Number.NaN;
};

describe(progressOf, () => {
  it("shows nothing with no download under way", () => {
    expect(progressOf([], 500)).toStrictEqual({ kind: "none" });
  });

  it("is indeterminate while any size is unknown", () => {
    expect(
      progressOf(
        [
          { received: 10, total: 100 },
          { received: 10, total: 0 },
        ],
        0
      )
    ).toStrictEqual({ kind: "indeterminate" });
  });

  it("never runs backwards as downloads finish, fail or are cancelled while others run", () => {
    const both = value(
      [
        { received: 10, total: 100 },
        { received: 90, total: 100 },
      ],
      0
    );
    const secondEnded = value([{ received: 10, total: 100 }], 90);
    const firstEnded = value([{ received: 90, total: 100 }], 10);
    expect(both).toBe(0.5);
    expect(secondEnded).toBeGreaterThanOrEqual(both);
    expect(firstEnded).toBeGreaterThanOrEqual(both);
  });

  it("counts settled bytes as arrived", () => {
    expect(progressOf([{ received: 50, total: 100 }], 100)).toStrictEqual({
      kind: "fraction",
      value: 0.75,
    });
  });
});

describe(countedReceived, () => {
  it("counts a restarted download as having the share it had reached until it passes it, and an unknown size as what arrived", () => {
    expect([
      countedReceived(0, 200, 0.75),
      countedReceived(160, 200, 0.75),
      countedReceived(10, 0, 0.75),
      countedReceived(10, 100, 0),
    ]).toStrictEqual([150, 160, 10, 10]);
  });
});
