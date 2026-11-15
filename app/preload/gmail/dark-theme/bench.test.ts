// Measures the dark theme over the corpus against 3.x's engine, read from a 3.x checkout, and prints the table; skipped unless asked for:
// MERU_DARK_BENCH=1 [MERU_3X=<3.x checkout, ~/projects/zoidsh/meru by default>] vp test run app/preload/gmail/dark-theme/bench.test.ts
import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { TEXT_CONTRAST } from "../../../core/engines/dark-theme.ts";
import { EDITOR, releaseTree, themeTree } from "./engine.ts";
import {
  TEST_MARK,
  corpus,
  mountMail,
  styleOf,
  textContrasts,
  theme,
} from "./testing.ts";

// Node gives a test no collector to call unless one is exposed, which a fresh context can take after the flag is set.
setFlagsFromString("--expose-gc");
const collector: unknown = runInNewContext("gc");
const isCollector = (value: unknown): value is () => void =>
  typeof value === "function";

const THREE_X = path.join(
  process.env.MERU_3X ?? path.join(homedir(), "projects/zoidsh/meru"),
  "packages/dark-theme"
);
// Vite serves a test nothing outside the workspace, so 3.x's engine is read from a copy inside it, which git ignores.
const COPY = path.join(process.cwd(), ".meru/bench/dark-theme-3x");

interface Controller {
  readonly revert: () => void;
}
type Apply = (root: HTMLElement, options: object) => Controller;

const isApply = (value: unknown): value is Apply => typeof value === "function";

const loadThreeX = async (): Promise<Apply | undefined> => {
  if (!existsSync(path.join(THREE_X, "index.ts"))) {
    return undefined;
  }
  await rm(COPY, { force: true, recursive: true });
  await cp(THREE_X, COPY, { recursive: true });
  const module: unknown = await import(path.join(COPY, "index.ts"));
  const apply =
    typeof module === "object" && module !== null && "applyDarkTheme" in module
      ? module.applyDarkTheme
      : undefined;
  return isApply(apply) ? apply : undefined;
};

/** One engine as the bench drives it: theme the sheet, answering how to leave it. */
interface Engine {
  readonly name: string;
  readonly theme: (sheet: HTMLElement) => () => void;
}

const meru: Engine = {
  name: "4.0",
  theme: (sheet) => {
    themeTree(sheet, theme, EDITOR);
    return () => {
      releaseTree(sheet, TEST_MARK);
    };
  },
};

const untouched: Engine = {
  name: "none",
  theme: (sheet) => {
    for (const element of sheet.querySelectorAll("*")) {
      styleOf(element);
    }
    return () => {
      // Nothing was written.
    };
  },
};

const threeX = (apply: Apply): Engine => ({
  name: "3.x",
  // As 3.x's Gmail preload calls it on an opened conversation, less the observer, which one walk has no use for.
  theme: (sheet) => {
    const controller = apply(sheet, {
      backgroundColor: "rgb(19, 19, 19)",
      observe: false,
    });
    return () => {
      controller.revert();
    };
  },
});

const ROUNDS = 7;

const median = (values: readonly number[]): number =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const heap = (): number => {
  if (isCollector(collector)) {
    collector();
    collector();
  }
  return process.memoryUsage().heapUsed;
};

const kb = (bytes: number): string => `${Math.round(bytes / 1024)}`;

interface Row {
  readonly ms: number;
  readonly touched: number;
  readonly unreadable: number;
}

const measureMail = (engine: Engine, html: string): Row => {
  const times: number[] = [];
  let touched = 0;
  let unreadable = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const sheet = mountMail(html);
    const started = performance.now();
    const leave = engine.theme(sheet);
    times.push(performance.now() - started);
    touched = sheet.querySelectorAll(
      `[${TEST_MARK}], [data-dark-theme]`
    ).length;
    unreadable = textContrasts(sheet).filter(
      ({ contrast }) => contrast < TEXT_CONTRAST - 0.01
    ).length;
    leave();
  }
  return { ms: median(times), touched, unreadable };
};

/** The heap the engine holds with every mail themed and still open, and once each was left and taken away. */
const measureMemory = async (engine: Engine) => {
  document.body.innerHTML = "";

  const sheets = corpus.map(({ html }) => {
    const sheet = document.createElement("div");
    sheet.setAttribute(
      "style",
      "background-color: rgb(255, 255, 255); color: rgb(34, 34, 34)"
    );
    sheet.innerHTML = html;
    document.body.append(sheet);
    return sheet;
  });
  const bare = heap();
  const leaves = sheets.map((sheet) => engine.theme(sheet));
  const themed = heap() - bare;
  for (const leave of leaves) {
    leave();
  }
  const gone = sheets.map((sheet) => {
    sheet.remove();
    return new WeakRef(sheet);
  });
  sheets.length = 0;
  leaves.length = 0;
  // A weak reference made or read in a task holds its target through that task, and clears only after the task that collected.
  await pause(0);
  heap();
  await pause(0);
  return {
    kept: gone.filter((sheet) => sheet.deref() !== undefined).length,
    themed,
  };
};

const sumOf = (
  rows: readonly (Row | undefined)[],
  pick: (row: Row) => number
) =>
  rows.reduce((total, row) => total + (row === undefined ? 0 : pick(row)), 0);

const tableOf = async (engines: readonly Engine[]) => {
  // The first walk of either engine pays for happy-dom's own warming, which neither would on Gmail's page.
  for (const engine of engines) {
    for (const { html } of corpus) {
      measureMail(engine, html);
    }
  }
  const rows = corpus.map(({ html, name }) => ({
    name,
    results: engines.map((engine) => measureMail(engine, html)),
  }));
  // happy-dom keeps what it computed for a page, so each engine is read against a walk of the same mails that themes nothing.
  await measureMemory(untouched);
  const bare = await measureMemory(untouched);
  const memory: { kept: number; themed: number }[] = [];
  for (const engine of engines) {
    // oxlint-disable-next-line no-await-in-loop -- one engine's heap is read at a time
    const held = await measureMemory(engine);
    memory.push({
      kept: held.kept - bare.kept,
      themed: held.themed - bare.themed,
    });
  }
  const header = engines.flatMap(({ name }) => [
    `${name} ms`,
    `${name} nodes`,
    `${name} <4.5`,
  ]);
  const totals = engines.map((_, index) =>
    rows.map(({ results }) => results[index])
  );
  return {
    lines: [
      `| Mail | ${header.join(" | ")} |`,
      `| --- | ${header.map(() => "---:").join(" | ")} |`,
      ...rows.map(
        ({ name, results }) =>
          `| ${name} | ${results
            .flatMap(({ ms, touched, unreadable }) => [
              ms.toFixed(2),
              `${touched}`,
              `${unreadable}`,
            ])
            .join(" | ")} |`
      ),
      `| **Total** | ${totals
        .flatMap((of) => [
          sumOf(of, ({ ms }) => ms).toFixed(1),
          `${sumOf(of, ({ touched }) => touched)}`,
          `${sumOf(of, ({ unreadable }) => unreadable)}`,
        ])
        .join(" | ")} |`,
      "",
      `| Engine | Heap held with all ${corpus.length} themed (KB) | Mails still reachable after leaving |`,
      "| --- | ---: | ---: |",
      ...engines.map(
        ({ name }, index) =>
          `| ${name} | ${kb(memory[index]?.themed ?? 0)} | ${memory[index]?.kept ?? 0} |`
      ),
    ],
    unreadable: sumOf(totals[0] ?? [], ({ unreadable }) => unreadable),
  };
};

describe("the dark theme against 3.x", () => {
  it.runIf(process.env.MERU_DARK_BENCH === "1")(
    "measures the corpus against 3.x's engine",
    async () => {
      const apply = await loadThreeX();
      const engines = apply === undefined ? [meru] : [meru, threeX(apply)];
      if (apply === undefined) {
        console.log(`No 3.x engine at ${THREE_X}; measuring 4.0 alone`);
      }
      const { lines, unreadable } = await tableOf(engines);
      console.log(lines.join("\n"));

      expect(unreadable).toBe(0);
    },
    600_000
  );
});
