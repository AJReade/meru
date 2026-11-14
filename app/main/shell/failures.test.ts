import { describe, expect, it } from "vitest";

import { FakeClock } from "../../test/fakes/clock.ts";
import { FakeLifecycle } from "../../test/fakes/lifecycle.ts";
import { FakeLog } from "../../test/fakes/log.ts";
import {
  logFailures,
  PAGE_ERROR_WINDOW,
  PAGE_ERRORS_PER_WINDOW,
} from "./failures.ts";

const OWN = "file:///app/dist/renderer/chrome.html?platform=darwin";
const GMAIL = "https://mail.google.com/mail/u/0/#inbox";

const setup = () => {
  const clock = new FakeClock();
  const lifecycle = new FakeLifecycle("darwin", false, clock);
  const log = new FakeLog();
  const stop = logFailures({
    clock,
    lifecycle,
    log: log.scoped("app"),
    ownPage: (url) => url.startsWith("file:///app/dist/renderer/"),
  });
  return { clock, lifecycle, log, stop };
};

describe(logFailures, () => {
  it("writes an unhandled rejection and carries on, and writes an uncaught exception and quits", () => {
    const { lifecycle, log } = setup();
    const thrown = new Error("boom");
    lifecycle.fail({ error: "no reason", kind: "unhandledRejection" });
    const afterRejection = lifecycle.quitting;
    lifecycle.fail({ error: thrown, kind: "uncaught" });
    expect([afterRejection, lifecycle.quitting]).toStrictEqual([false, true]);
    expect(log.entries).toStrictEqual([
      {
        fields: { error: "no reason" },
        level: "error",
        message: "A rejected promise was not handled",
        scope: "app",
      },
      {
        fields: { error: thrown },
        level: "error",
        message: "An exception was not caught",
        scope: "app",
      },
    ]);
  });

  it("writes a process that crashed or was killed, and not one that exited cleanly", () => {
    const { lifecycle, log } = setup();
    lifecycle.fail({
      exitCode: 0,
      kind: "processGone",
      process: "renderer",
      reason: "clean-exit",
      url: GMAIL,
    });
    lifecycle.fail({
      exitCode: 11,
      kind: "processGone",
      process: "renderer",
      reason: "crashed",
      url: GMAIL,
    });
    lifecycle.fail({
      exitCode: 9,
      kind: "processGone",
      process: "GPU",
      reason: "killed",
      url: "",
    });
    expect(log.entries.map((entry) => entry.fields)).toStrictEqual([
      { exitCode: 11, process: "renderer", reason: "crashed", url: GMAIL },
      { exitCode: 9, process: "GPU", reason: "killed", url: "" },
    ]);
  });

  it("writes a console error from the app's own pages only, and stops hearing any other page's console at its first", () => {
    const { lifecycle, log } = setup();
    for (const [contentsId, url] of [
      [1, OWN],
      [2, GMAIL],
    ] as const) {
      lifecycle.fail({
        contentsId,
        kind: "consoleError",
        line: 12,
        message: "Uncaught TypeError: x is undefined",
        source: url,
        url,
      });
    }
    expect(log.entries).toStrictEqual([
      {
        fields: {
          line: 12,
          source: OWN,
          text: "Uncaught TypeError: x is undefined",
          url: OWN,
        },
        level: "error",
        message: "A page logged an error",
        scope: "app",
      },
    ]);
    expect([...lifecycle.muted.keys()]).toStrictEqual([2]);
  });

  it("writes a page's first errors in a window and stops hearing the rest of the window's, saying so once", () => {
    const { clock, lifecycle, log } = setup();
    const flood = (contentsId: number, count: number) => {
      for (let index = 0; index < count; index += 1) {
        lifecycle.fail({
          contentsId,
          kind: "consoleError",
          line: 1,
          message: `flood ${index}`,
          source: OWN,
          url: OWN,
        });
      }
    };
    clock.advance(1000);
    flood(1, PAGE_ERRORS_PER_WINDOW + 500);
    flood(2, 1);
    const written = log.entries.map(({ message }) => message);
    clock.advance(PAGE_ERROR_WINDOW);
    flood(1, 1);
    expect({
      afterWindow: log.entries
        .slice(written.length)
        .map(({ fields }) => fields),
      errors: written.filter((message) => message === "A page logged an error")
        .length,
      muted: lifecycle.muted.get(1),
      warnings: log.at("warn"),
    }).toStrictEqual({
      afterWindow: [{ line: 1, source: OWN, text: "flood 0", url: OWN }],
      errors: PAGE_ERRORS_PER_WINDOW + 1,
      muted: 1000 + PAGE_ERROR_WINDOW,
      warnings: [
        "A page wrote too many errors, so the rest of the minute's go unheard",
      ],
    });
  });

  it("writes nothing once stopped", () => {
    const { lifecycle, log, stop } = setup();
    stop();
    lifecycle.fail({ error: new Error("late"), kind: "uncaught" });
    expect(log.entries).toStrictEqual([]);
  });
});
