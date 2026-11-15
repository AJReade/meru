import { setTimeout as pause } from "node:timers/promises";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  TEXT_CONTRAST,
  contrast,
  luminance,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import conversation from "../features/fixtures/conversation-dark.html?raw";
import { mountGmail, switchesWith } from "../testing.ts";
import { TURN_LIGHT } from "./engine.ts";
import { extendDarkTheme } from "./extend-dark-theme.ts";
import { FakeImagePixels } from "./fake-pixels.ts";
import { TEST_MARK } from "./testing.ts";

// Node gives a test no collector to call unless one is exposed, which a fresh context can take after the flag is set.
setFlagsFromString("--expose-gc");
const collector: unknown = runInNewContext("gc");
const isCollector = (value: unknown): value is () => void =>
  typeof value === "function";

const LIGHT_GMAIL = conversation.replace(
  "background-color: rgb(17, 17, 17);",
  "background-color: rgb(255, 255, 255);"
);

const on = { switches: switchesWith("extendDarkTheme") };

const colourOf = (selector: string, property: "backgroundColor" | "color") => {
  const element = document.querySelector(selector);
  return element === null
    ? undefined
    : parseColour(getComputedStyle(element)[property]);
};

describe(extendDarkTheme, () => {
  it("darkens the conversation's sheet and its message in the frame they appear in", () => {
    const page = mountGmail({
      features: [extendDarkTheme(TEST_MARK)],
      html: conversation,
      settings: on,
    });

    expect(page.run()).toBe(1);
    const sheet = colourOf(".iY", "backgroundColor");
    const text = colourOf(".a3s p", "color");
    const ground = colourOf(".a3s div[style]", "backgroundColor");
    expect([
      sheet === undefined ? 1 : luminance(sheet),
      text === undefined || ground === undefined
        ? 0
        : contrast(text, ground) >= TEXT_CONTRAST,
    ]).toStrictEqual([expect.any(Number), true]);
    expect(sheet === undefined ? 1 : luminance(sheet)).toBeLessThan(0.05);
    page.app.dispose();
  });

  it("keeps the mail's button its own colour and leaves the reply being written alone", () => {
    const page = mountGmail({
      features: [extendDarkTheme(TEST_MARK)],
      html: conversation,
      settings: on,
    });
    page.run();

    expect([
      document
        .querySelector(".a3s a")
        ?.getAttribute("style")
        ?.includes("background-color: rgb(26, 115, 232);"),
      document.querySelector(".editor")?.hasAttribute(TEST_MARK),
      document.querySelector(".editor")?.getAttribute("style"),
    ]).toStrictEqual([true, false, "color: rgb(34, 34, 34)"]);
    page.app.dispose();
  });

  it("puts every element back as the mail had it when turned off", () => {
    const page = mountGmail({
      features: [extendDarkTheme(TEST_MARK)],
      html: conversation,
      settings: on,
    });
    const before = document.body.innerHTML;
    page.run();

    page.change({ switches: switchesWith() });

    expect(document.querySelectorAll(`[${TEST_MARK}]`)).toHaveLength(0);
    expect(document.body.innerHTML).toBe(before);
    page.app.dispose();
  });

  it("leaves the conversation light while Gmail's own theme is light", () => {
    const page = mountGmail({
      features: [extendDarkTheme(TEST_MARK)],
      html: LIGHT_GMAIL,
      settings: on,
    });
    page.run();

    expect(document.querySelectorAll(`[${TEST_MARK}]`)).toHaveLength(0);
    page.app.dispose();
  });

  it("themes the rest of a clipped message once it lands in the body", async () => {
    const page = mountGmail({
      features: [extendDarkTheme(TEST_MARK)],
      html: conversation,
      settings: on,
    });
    page.run();
    const rest = document.createElement("div");
    rest.dataset.meruClipped = "";
    rest.innerHTML = `<p style="color: rgb(0, 0, 0); background-color: rgb(250, 250, 250)">The rest.</p>`;
    document.querySelector(".a3s")?.append(rest);
    await page.settle();

    expect(rest.querySelector("p")?.hasAttribute(TEST_MARK)).toBeTruthy();
    page.app.dispose();
  });

  it("turns a dark logo on a darkened ground light, and nothing it cannot read", async () => {
    const pixels = new FakeImagePixels();
    pixels.answer("https://example.com/logo.png", [20, 20, 20, 255], 40);
    const page = mountGmail({
      features: [extendDarkTheme(TEST_MARK)],
      html: `${conversation}<style>.iY img { width: 74px; }</style>`,
      pixels,
      settings: on,
    });
    const logo = document.querySelector("img.logo");
    if (!(logo instanceof HTMLImageElement)) {
      throw new TypeError("No logo");
    }
    page.run();
    logo.dispatchEvent(new Event("load"));
    await pause(0);

    expect([pixels.asked, logo.style.getPropertyValue("filter")]).toStrictEqual(
      [["https://example.com/logo.png"], TURN_LIGHT]
    );
    page.app.dispose();
  });

  it("holds none of the conversations Gmail took away", async () => {
    if (!isCollector(collector)) {
      throw new TypeError("Node exposed no collector");
    }
    const shell = new DOMParser().parseFromString(conversation, "text/html");
    const page = mountGmail({
      features: [extendDarkTheme(TEST_MARK)],
      html: `${shell.querySelector("style")?.outerHTML ?? ""}<div role="main" id="main"></div>`,
      settings: on,
    });
    page.run();
    const main = document.querySelector("#main");
    const gone: WeakRef<Element>[] = [];
    for (let round = 0; round < 40; round += 1) {
      const opened = document.createElement("div");
      opened.innerHTML =
        shell.body.querySelector('[role="main"]')?.innerHTML ?? "";
      main?.append(opened);
      // oxlint-disable-next-line no-await-in-loop -- each conversation is themed before Gmail takes it away
      await page.settle();
      expect(opened.querySelector(`.iY[${TEST_MARK}]`)).not.toBeNull();
      opened.remove();
      gone.push(new WeakRef(opened));
    }
    main?.append(document.createElement("p"));
    await page.settle();
    for (let round = 0; round < 3; round += 1) {
      collector();
      // oxlint-disable-next-line no-await-in-loop -- a weak reference clears only after the task that collected
      await pause(0);
    }

    // happy-dom keeps the conversation taken away last for as long as its last mutation record stands, whatever the feature holds.
    expect(
      gone.flatMap((opened, index) =>
        opened.deref() === undefined || index === gone.length - 1 ? [] : [index]
      )
    ).toStrictEqual([]);
    page.app.dispose();
  });
});
