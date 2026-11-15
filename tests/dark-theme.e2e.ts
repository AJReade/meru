import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ElectronApplication, Page } from "@playwright/test";
import { z } from "zod";

import {
  TEXT_CONTRAST,
  contrast,
  parseColour,
} from "../app/core/engines/dark-theme.ts";
import { settings } from "../app/shared/channels/settings.ts";
import { settingSet } from "../app/shared/settings/schema.ts";
import { invokeIn } from "../scripts/lib/app.ts";
import { entitlementKindOf, expect, must, panesOf, test } from "./app.ts";
import { startGmailStub } from "./gmail-stub.ts";

const FIXTURES = path.join(
  import.meta.dirname,
  "..",
  "app/preload/gmail/features/fixtures"
);

/** A conversation under Gmail's dark theme, its sheet light, holding one mail of the corpus. */
const mailbox = async (mail: string): Promise<string> =>
  await conversationOf(
    await readFile(path.join(FIXTURES, "corpus", mail), "utf-8")
  );

/** A conversation under Gmail's dark theme, its sheet light, holding one message whose body is `body`. */
const conversationOf = async (body: string): Promise<string> => {
  const conversation = await readFile(
    path.join(FIXTURES, "conversation-dark.html"),
    "utf-8"
  );
  const style = must(
    /<style>[\s\S]*?<\/style>/u.exec(conversation)?.[0],
    "the fixture's style sheet"
  );
  return `<!doctype html><title>Gmail</title>${style}<div role="main"><div class="nH"><div class="nH a98 iY"><h2 class="hP" data-legacy-thread-id="thread-1">Subject</h2><div role="list"><div role="listitem" class="adn ads" data-message-id="m1"><div class="gs"><div class="ii gt">${body}</div></div></div></div></div></div></div>`;
};

const inPane = async (app: ElectronApplication, code: string) => {
  const [pane] = await panesOf(app);
  const { contentsId } = must(pane, "a pane");
  return await app.evaluate(
    async ({ webContents }, [id, script]) => {
      const answer: unknown = await webContents
        .fromId(id)
        ?.executeJavaScript(script, true);
      return answer;
    },
    [contentsId, code] as const
  );
};

const setTo = async (chrome: Page, value: boolean) => {
  await invokeIn(
    chrome,
    settings.set,
    must(settingSet("gmail.extendDarkTheme", value), "the setting as a switch")
  );
};

// The sheet's ground as Chromium paints it, and how many elements carry the theme's mark, whose name ends in a suffix drawn for the page load.
const STATE = `[getComputedStyle(document.querySelector(".iY")).backgroundColor, [...document.querySelectorAll("*")].filter((element) => element.getAttributeNames().some((name) => name.startsWith("data-meru-dark-"))).length]`;
const STATE_SCHEMA = z.tuple([z.string(), z.number()]);

test("darkens a mail under Gmail's dark theme while the setting is on, and gives it back as it was", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(await mailbox("13-receipt.html"));
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");
    await expect
      .poll(async () => await inPane(app, STATE))
      .toStrictEqual(["rgb(255, 255, 255)", 0]);
    const before = await inPane(
      app,
      `document.querySelector(".a3s").outerHTML`
    );

    await setTo(chrome, true);
    await expect
      .poll(async () => {
        const [ground, marked] = STATE_SCHEMA.parse(await inPane(app, STATE));
        return [ground !== "rgb(255, 255, 255)", marked > 0];
      })
      .toStrictEqual([true, true]);

    await setTo(chrome, false);
    await expect
      .poll(async () => await inPane(app, STATE))
      .toStrictEqual(["rgb(255, 255, 255)", 0]);
    expect(await inPane(app, `document.querySelector(".a3s").outerHTML`)).toBe(
      before
    );
  } finally {
    await gmail.stop();
  }
});

// Each case's text colour and the first ground under it, read while the pointer is over it.
const HOVERED = `(() => {
  const ground = (element) => {
    for (let box = element; box !== null; box = box.parentElement) {
      const colour = getComputedStyle(box).backgroundColor;
      if (colour !== "rgba(0, 0, 0, 0)" && colour !== "transparent") {
        return colour;
      }
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const element = document.querySelector(window.zzCase);
  return [element.matches(":hover"), getComputedStyle(element).color, ground(element)];
})()`;
const HOVERED_SCHEMA = z.tuple([z.boolean(), z.string(), z.string()]);

const HOVER_MAIL = `<div class="a3s aiL"><style>.lit:hover { background-color: #ffffff } .lit-important:hover { background-color: #ffffff !important }</style><div style="background-color: #ffffff; color: #222222">${[
  ["darkened", "lit", "background-color: #f4f4f4; color: #333333"],
  [
    "darkened-important",
    "lit-important",
    "background-color: #f4f4f4; color: #333333",
  ],
  ["clear", "lit", "color: #333333"],
  ["clear-important", "lit-important", "color: #333333"],
]
  .map(
    ([id, name, style]) =>
      `<a id="${id}" class="${name}" style="display: block; height: 60px; ${style}">${id}</a>`
  )
  .join("")}</div></div>`;

// About 5,000 elements, the size of a long marketing mail.
const LONG_MAIL = `<div class="a3s aiL"><div style="background-color: #ffffff">${Array.from(
  { length: 2500 },
  (_, index) =>
    `<p style="color: #${String(index % 9).repeat(3)}"><span>row ${index}</span></p>`
).join("")}</div></div>`;

// What a batch of the feature does once nothing new has arrived, timed over the page's own roots: the body's key and one query under each root for what the mark is missing from.
const IDLE_BATCH = `(() => {
  const sheet = document.querySelector(".iY");
  const mark = sheet.getAttributeNames().find((name) => name.startsWith("data-meru-dark-"));
  const roots = [sheet, ...document.querySelectorAll("[data-message-id]")];
  const times = [];
  let fresh = 0;
  for (let round = 0; round < 21; round += 1) {
    const started = performance.now();
    const key = document.body.className + document.body.getAttribute("style") + document.styleSheets.length;
    for (const root of roots) {
      fresh += root.querySelectorAll(":not([" + mark + "])").length;
    }
    times.push(performance.now() - started);
    fresh += key === null ? 1 : 0;
  }
  times.sort((a, b) => a - b);
  return [document.querySelectorAll("*").length, fresh, times[10]];
})()`;
const IDLE_SCHEMA = z.tuple([z.number(), z.number(), z.number()]);

test("keeps a text readable while the pointer is over it, and a batch with nothing new costs under a millisecond", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(
    await conversationOf(`${HOVER_MAIL}${LONG_MAIL}`)
  );
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");
    await expect
      .poll(async () => await inPane(app, STATE))
      .toStrictEqual(["rgb(255, 255, 255)", 0]);
    await setTo(chrome, true);
    await expect
      .poll(async () => {
        const [, marked] = STATE_SCHEMA.parse(await inPane(app, STATE));
        return marked > 5000;
      })
      .toBe(true);

    const [pane] = await panesOf(app);
    const { contentsId } = must(pane, "a pane");
    const readings: Record<string, number> = {};
    for (const id of [
      "darkened",
      "darkened-important",
      "clear",
      "clear-important",
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one case is under the pointer at a time
      const point = await inPane(
        app,
        `(() => { window.zzCase = "#${id}"; const element = document.querySelector("#${id}"); element.scrollIntoView({ block: "center" }); const rect = element.getBoundingClientRect(); return [Math.round(rect.x + 10), Math.round(rect.y + rect.height / 2)]; })()`
      );
      const [x, y] = z.tuple([z.number(), z.number()]).parse(point);
      // oxlint-disable-next-line no-await-in-loop -- the pointer moves before the case is read
      await app.evaluate(
        ({ webContents }, [contents, px, py]) => {
          webContents
            .fromId(contents)
            ?.sendInputEvent({ type: "mouseMove", x: px, y: py });
        },
        [contentsId, x, y] as const
      );
      // oxlint-disable-next-line no-await-in-loop -- read once the pointer is over it
      await expect
        .poll(async () => HOVERED_SCHEMA.parse(await inPane(app, HOVERED))[0])
        .toBe(true);
      // oxlint-disable-next-line no-await-in-loop -- read once the pointer is over it
      const [, text, ground] = HOVERED_SCHEMA.parse(await inPane(app, HOVERED));
      readings[id] =
        Math.round(
          contrast(
            must(parseColour(text), "a text colour"),
            must(parseColour(ground), "a ground")
          ) * 100
        ) / 100;
    }
    expect(
      Object.values(readings).every((ratio) => ratio >= TEXT_CONTRAST)
    ).toBe(true);

    const [elements, fresh, median] = IDLE_SCHEMA.parse(
      await inPane(app, IDLE_BATCH)
    );
    console.log(
      JSON.stringify({ elements, hover: readings, idleBatchMs: median })
    );
    expect([elements > 5000, fresh, median < 1]).toStrictEqual([true, 0, true]);
  } finally {
    await gmail.stop();
  }
});
