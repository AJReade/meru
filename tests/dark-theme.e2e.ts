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
import { invokeIn, valueOf } from "../scripts/lib/app.ts";
import { awaitEntitlement, expect, must, panesOf, test } from "./app.ts";
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
  valueOf(
    await invokeIn(
      chrome,
      settings.set,
      must(
        settingSet("gmail.extendDarkTheme", value),
        "the setting as a switch"
      )
    )
  );
};

// Whether the page runs an animation frame within a second: a pane answers scripts before it draws its first frame, and the feature walks only in a frame, so a late first frame would otherwise read as a feature that did nothing.
const FRAMED = `new Promise((resolve) => { requestAnimationFrame(() => resolve(true)); setTimeout(() => resolve(false), 1000); })`;

/** Waits until the pane draws frames, in which the feature walks once it is on. */
const framed = async (app: ElectronApplication) => {
  await expect.poll(async () => await inPane(app, FRAMED)).toBe(true);
};

// The sheet's ground as Chromium paints it, and how many elements carry the theme's mark, whose name ends in a suffix drawn for the page load.
const STATE = `[getComputedStyle(document.querySelector(".iY")).backgroundColor, [...document.querySelectorAll("*")].filter((element) => element.getAttributeNames().some((name) => name.startsWith("data-meru-dark-"))).length]`;
const STATE_SCHEMA = z.tuple([z.string(), z.number()]);

test("darkens a mail under Gmail's dark theme while the setting is on, and gives it back as it was", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(await mailbox("receipt.html"));
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await awaitEntitlement(app, "trial");
    await expect
      .poll(async () => await inPane(app, STATE))
      .toStrictEqual(["rgb(255, 255, 255)", 0]);
    await framed(app);
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

// Whether the case at `CASE` is hovered, its text colour and the first ground under it.
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
  const element = document.querySelector("CASE");
  return [element.matches(":hover"), getComputedStyle(element).color, ground(element)];
})()`;
const HOVERED_SCHEMA = z.tuple([z.boolean(), z.string(), z.string()]);

// Each case's id, the hover rule's class and its own style: four hover rules that light the ground and four that set only the colour, on a text that inherits its colour and on one with its own.
const HOVER_CASES = [
  ["darkened", "lit", "background-color: #f4f4f4; color: #333333"],
  [
    "darkened-important",
    "lit-important",
    "background-color: #f4f4f4; color: #333333",
  ],
  ["clear", "lit", "color: #333333"],
  ["clear-important", "lit-important", "color: #333333"],
  ["ink-inherited", "ink", ""],
  ["ink-inherited-important", "ink-important", ""],
  ["ink-own", "ink", "color: #333333"],
  ["ink-own-important", "ink-important", "color: #333333"],
] as const;

const HOVER_MAIL = `<div class="a3s aiL"><style>.lit:hover { background-color: #ffffff } .lit-important:hover { background-color: #ffffff !important } .ink:hover { color: #000000 } .ink-important:hover { color: #000000 !important }</style><div style="background-color: #ffffff; color: #222222">${HOVER_CASES.map(
  ([id, name, style]) =>
    `<a id="${id}" class="${name}" style="display: block; height: 60px; ${style}">${id}</a>`
).join("")}</div></div>`;

// About 5,000 elements, the size of a long marketing mail.
const LONG_MAIL = `<div class="a3s aiL"><div style="background-color: #ffffff">${Array.from(
  { length: 2500 },
  (_, index) =>
    `<p style="color: #${String(index % 9).repeat(3)}"><span>row ${index}</span></p>`
).join("")}</div></div>`;

// What a batch of the feature does once nothing new has arrived, timed over the page's own roots: the body's ground and one query under each root for what the mark is missing from, each round the mean of 50 batches, since the page's clock steps in tenths of a millisecond.
const IDLE_BATCH = `(() => {
  const sheet = document.querySelector(".iY");
  const mark = sheet.getAttributeNames().find((name) => name.startsWith("data-meru-dark-"));
  const roots = [sheet, ...document.querySelectorAll("[data-message-id]")];
  const times = [];
  let fresh = 0;
  for (let round = 0; round < 21; round += 1) {
    const started = performance.now();
    for (let batch = 0; batch < 50; batch += 1) {
      const ground = getComputedStyle(document.body).backgroundColor;
      for (const root of roots) {
        fresh += root.querySelectorAll(":not([" + mark + "])").length;
      }
      fresh += ground === "" ? 1 : 0;
    }
    times.push((performance.now() - started) / 50);
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
    await awaitEntitlement(app, "trial");
    await expect
      .poll(async () => await inPane(app, STATE))
      .toStrictEqual(["rgb(255, 255, 255)", 0]);
    await framed(app);
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
    for (const [id] of HOVER_CASES) {
      // oxlint-disable-next-line no-await-in-loop -- one case is hovered at a time
      const hovered = await app.evaluate(
        async ({ webContents }, [contents, selector, read]) => {
          // A synthetic mouse move sets no hover state in a window the real pointer has never entered, as on CI's xvfb and Windows runners, so the state is forced through DevTools, as Chromium's own tests force it.
          const page = webContents.fromId(contents);
          if (page === undefined) {
            return null;
          }
          page.debugger.attach("1.3");
          try {
            const command = async (
              method: string,
              params: object = {}
            ): Promise<unknown> =>
              await page.debugger.sendCommand(method, params);
            // oxlint-disable-next-line unicorn/consistent-function-scoping -- app.evaluate sends this function alone to main, so it can reach nothing outside it
            const field = (answer: unknown, key: string): unknown =>
              typeof answer === "object" && answer !== null && key in answer
                ? Object.entries(answer).find(([name]) => name === key)?.[1]
                : null;
            await command("DOM.enable");
            await command("CSS.enable");
            const document = await command("DOM.getDocument");
            const nodeId = field(
              await command("DOM.querySelector", {
                nodeId: field(field(document, "root"), "nodeId"),
                selector,
              }),
              "nodeId"
            );
            await command("CSS.forcePseudoState", {
              nodeId,
              forcedPseudoClasses: ["hover"],
            });
            const answer: unknown = await page.executeJavaScript(read, true);
            return answer;
          } finally {
            page.debugger.detach();
          }
        },
        [contentsId, `#${id}`, HOVERED.replace("CASE", `#${id}`)] as const
      );
      const [isHovered, text, ground] = HOVERED_SCHEMA.parse(hovered);
      expect(isHovered).toBe(true);
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

const MODERN_MAIL = `<div class="a3s aiL"><div style="background-color: #ffffff">${[
  ["oklch", "color: oklch(0.3 0 0)"],
  ["mix", "color: color-mix(in srgb, #000 80%, #fff)"],
  ["lab", "color: lab(20 0 0)"],
  ["lch", "color: lch(25 10 200)"],
  ["p3", "color: color(display-p3 0.1 0.1 0.1)"],
  ["oklab", "color: oklab(0.3 0 0)"],
  ["ground", "background-color: oklch(0.99 0 0); color: #222222"],
]
  .map(([id, style]) => `<p id="${id}" style="${style}">${id}</p>`)
  .join("")}</div></div>`;

// Each case's text colour and ground as the canvas reads them, which turns any CSS colour into sRGB, and the time the canvas takes per colour, read the way the feature reads one.
const MODERN = `(() => {
  const context = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  const read = (text) => {
    context.fillStyle = "#000000";
    context.fillStyle = text;
    context.clearRect(0, 0, 1, 1);
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return "rgb(" + r + ", " + g + ", " + b + ")";
  };
  const ground = (element) => {
    for (let box = element; box !== null; box = box.parentElement) {
      const colour = getComputedStyle(box).backgroundColor;
      if (colour !== "rgba(0, 0, 0, 0)") {
        return read(colour);
      }
    }
    return read(getComputedStyle(document.body).backgroundColor);
  };
  const cases = ["oklch", "mix", "lab", "lch", "p3", "oklab", "ground"].map((id) => {
    const element = document.querySelector("#" + id);
    return [id, read(getComputedStyle(element).color), ground(element)];
  });
  const started = performance.now();
  for (let index = 0; index < 200; index += 1) {
    read("oklch(" + (index / 200).toFixed(3) + " 0.1 200)");
  }
  return [cases, (performance.now() - started) / 200];
})()`;
const MODERN_SCHEMA = z.tuple([
  z.array(z.tuple([z.string(), z.string(), z.string()])),
  z.number(),
]);

test("reads CSS Color 4's colours and keeps every text over them readable", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(await conversationOf(MODERN_MAIL));
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await awaitEntitlement(app, "trial");
    await expect
      .poll(async () => await inPane(app, STATE))
      .toStrictEqual(["rgb(255, 255, 255)", 0]);
    await framed(app);
    await setTo(chrome, true);
    await expect
      .poll(async () => {
        const [ground] = STATE_SCHEMA.parse(await inPane(app, STATE));
        return ground !== "rgb(255, 255, 255)";
      })
      .toBe(true);

    const [cases, perColour] = MODERN_SCHEMA.parse(await inPane(app, MODERN));
    const ratios = Object.fromEntries(
      cases.map(([id, text, ground]) => [
        id,
        Math.round(
          contrast(
            must(parseColour(text), "a text colour"),
            must(parseColour(ground), "a ground")
          ) * 100
        ) / 100,
      ])
    );
    console.log(JSON.stringify({ canvasMsPerColour: perColour, ratios }));
    expect(Object.values(ratios).every((ratio) => ratio >= TEXT_CONTRAST)).toBe(
      true
    );
  } finally {
    await gmail.stop();
  }
});

const FILTERS = `["img.glyph", "img.tile"].map((selector) => getComputedStyle(document.querySelector(selector)).filter)`;

test("turns a dark glyph light and leaves a light picture as it is, read from the images themselves", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(await mailbox("data-images.html"));
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await awaitEntitlement(app, "trial");
    await expect
      .poll(async () => await inPane(app, FILTERS))
      .toStrictEqual(["none", "none"]);
    await framed(app);

    await setTo(chrome, true);
    await expect
      .poll(async () => await inPane(app, FILTERS))
      .toStrictEqual(["invert(1) hue-rotate(180deg)", "none"]);

    await setTo(chrome, false);
    await expect
      .poll(async () => await inPane(app, FILTERS))
      .toStrictEqual(["none", "none"]);
  } finally {
    await gmail.stop();
  }
});

// Gmail's own controls in the conversation's sheet, as the live account draws them under its dark theme: an icon on a pseudo-element named dark and one named white, a menu Gmail builds in a message and fills once it has moved it to the page, an inline reply's editor holding a picture, and a reply bar that sticks below a long mail with a light shadow while mail is left below it, which Gmail turns on and off by a class as the conversation scrolls.
const ICON = "https://www.gstatic.com/images/icons/material/system_gm/1x";
const SHEET_PAGE = `<!doctype html><title>Gmail</title><style>
  body { background-color: rgb(17, 17, 17); margin: 0; }
  .iY { background-color: rgb(255, 255, 255); color: rgb(32, 33, 36); }
  .icon::before { content: none; background-image: url("${ICON}/star_border_black_20dp.png"); }
  .icon.white::before { background-image: url("${ICON}/star_border_white_20dp.png"); }
  .menu { background-color: rgb(255, 255, 255); position: absolute; top: 0; right: 0; }
  .menu li { color: rgb(31, 31, 31); }
  .bar { position: sticky; bottom: 0; background-color: rgb(255, 255, 255); height: 120px; }
  .bar.stuck { box-shadow: rgb(232, 234, 237) 0px -3px 2px -2px; }
</style><div role="main"><div class="nH"><div class="nH a98 iY"><h2 class="hP" data-legacy-thread-id="thread-1">Subject</h2><span class="icon dark">a</span><span class="icon white">b</span><div role="list"><div role="listitem" class="adn ads" data-message-id="m1"><div class="gs"><div class="ii gt"><div class="a3s aiL"><div style="background-color: #ffffff; color: #222222">${Array.from(
  { length: 300 },
  (_, index) => `<p>row ${index}</p>`
).join(
  ""
)}</div></div></div></div></div></div><div class="bar"><div contenteditable="true" role="textbox" style="color: rgb(34, 34, 34)">A reply <img alt="" width="8" height="8" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'/%3E"></div></div></div></div></div><script>
  const bar = document.querySelector(".bar");
  const stick = () => bar.classList.toggle("stuck", scrollY + innerHeight < document.documentElement.scrollHeight - 2);
  addEventListener("scroll", stick);
  stick();
</script>`;

// Builds a menu inside the message, moves it to the page in the next frame and fills it in the one after, as Gmail opens a message's More menu, and answers once two more frames have passed.
const OPEN_MENU = `new Promise((resolve) => {
  const frame = () => new Promise((done) => requestAnimationFrame(() => done()));
  const menu = document.createElement("div");
  menu.className = "menu";
  const list = document.createElement("ul");
  list.setAttribute("role", "menu");
  menu.append(list);
  document.querySelector("[data-message-id]").append(menu);
  frame().then(async () => {
    document.body.append(menu);
    await frame();
    for (const label of ["Reply", "Forward", "Delete"]) {
      const item = document.createElement("li");
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      list.append(item);
    }
    await frame();
    await frame();
    resolve(true);
  });
})`;

// What the theme made of each: the two icons' filters, each menu label's ink on the menu's ground, the editor's and its picture's filters, and whether the bar sticks with the first colour of its shadow.
const SHEET_STATE = `(() => {
  const style = (selector, pseudo) => getComputedStyle(document.querySelector(selector), pseudo);
  const menu = document.querySelector(".menu");
  const bar = document.querySelector(".bar");
  return {
    icons: [style(".icon.dark", "::before").filter, style(".icon.white", "::before").filter],
    menu: menu === null ? [] : [...menu.querySelectorAll("li")].map((item) => [getComputedStyle(item).color, getComputedStyle(menu).backgroundColor]),
    editor: [style('[contenteditable="true"]').filter, style('[contenteditable="true"] img').filter],
    bar: [bar.classList.contains("stuck"), getComputedStyle(bar).boxShadow.split(" 0px")[0]],
  };
})()`;
const SHEET_SCHEMA = z.object({
  bar: z.tuple([z.boolean(), z.string()]),
  editor: z.tuple([z.string(), z.string()]),
  icons: z.tuple([z.string(), z.string()]),
  menu: z.array(z.tuple([z.string(), z.string()])),
});

const TURNED = "invert(1) hue-rotate(180deg)";

const isDark = (colour: string) =>
  (parseColour(colour)?.r ?? 255) < 128 && (parseColour(colour)?.a ?? 0) > 0;

test("themes Gmail's own controls in the sheet: pseudo-element icons, a menu on its first open, the reply's editor and the reply bar's shadow as it scrolls", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(SHEET_PAGE);
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await awaitEntitlement(app, "trial");
    await expect
      .poll(async () => await inPane(app, STATE))
      .toStrictEqual(["rgb(255, 255, 255)", 0]);
    await framed(app);
    await setTo(chrome, true);
    await expect
      .poll(async () => {
        const [ground] = STATE_SCHEMA.parse(await inPane(app, STATE));
        return ground !== "rgb(255, 255, 255)";
      })
      .toBe(true);

    await inPane(app, OPEN_MENU);
    const opened = SHEET_SCHEMA.parse(await inPane(app, SHEET_STATE));
    const labels = opened.menu.map(([ink, ground]) =>
      contrast(
        must(parseColour(ink), "a label's ink"),
        must(parseColour(ground), "the menu's ground")
      )
    );

    await inPane(app, `scrollTo(0, document.documentElement.scrollHeight)`);
    await expect
      .poll(async () => SHEET_SCHEMA.parse(await inPane(app, SHEET_STATE)).bar)
      .toStrictEqual([false, "none"]);
    await inPane(app, `scrollTo(0, 0)`);
    await expect
      .poll(
        async () => SHEET_SCHEMA.parse(await inPane(app, SHEET_STATE)).bar[0]
      )
      .toBe(true);
    const scrolled = SHEET_SCHEMA.parse(await inPane(app, SHEET_STATE));

    console.log(JSON.stringify({ labels, opened, scrolled }));
    expect({
      bar: [opened.bar[0], isDark(opened.bar[1]), isDark(scrolled.bar[1])],
      editor: opened.editor,
      icons: opened.icons,
      labels:
        labels.length === 3 && labels.every((ratio) => ratio >= TEXT_CONTRAST),
    }).toStrictEqual({
      bar: [true, true, true],
      editor: [TURNED, TURNED],
      icons: [TURNED, "none"],
      labels: true,
    });
  } finally {
    await gmail.stop();
  }
});
