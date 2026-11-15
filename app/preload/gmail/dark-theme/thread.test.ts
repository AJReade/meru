import { setTimeout as pause } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import {
  TEXT_CONTRAST,
  contrast,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import thread from "../features/fixtures/thread-replying.html?raw";
import { mountGmail, switchesWith } from "../testing.ts";
import { SKIPPED, themeSheet, themeTree, turnedOf } from "./engine.ts";
import { extendDarkTheme } from "./extend-dark-theme.ts";
import { TEST_MARK, theme } from "./testing.ts";

// The fixture's scrub takes out Gmail's sheets, so the rules the cases turn on are written back as the live account's page computed them under Gmail's dark theme.
const GMAIL_RULES = `<style>
  body { background-color: rgb(17, 17, 17); }
  .iY { background-color: rgb(255, 255, 255); color: rgb(32, 33, 36); }
  .G3.G2 { border-top: 1px solid rgba(100, 121, 143, 0.12); }
  .T-KT::before { content: ""; background-image: url("https://www.gstatic.com/images/icons/material/system_gm/1x/star_border_black_20dp.png"); }
  .tB5Jxf-M-X { background-color: rgb(255, 255, 255); }
  .aqdrmf-Kf-fpDzbe-K0 { color: rgb(31, 31, 31); }
  .I5 { border: 1px solid rgb(225, 227, 225); background-color: rgb(255, 255, 255); }
  .I5.bzE { border-color: transparent; }
  .rT5Apb { background-color: rgb(255, 255, 255); }
  .rT5Apb.tyMQmc { box-shadow: rgb(232, 234, 237) 0px -3px 2px -2px; }
</style>`;

const on = { switches: switchesWith("extendDarkTheme") };

const mount = () => {
  const page = mountGmail({
    features: [extendDarkTheme(TEST_MARK)],
    html: `${GMAIL_RULES}${thread}`,
    settings: on,
  });
  page.run();
  return page;
};

const must = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) {
    throw new Error(`The fixture holds no ${what}`);
  }
  return value;
};

const computed = (element: Element) => getComputedStyle(element);

/** A style as Chromium computes a pseudo-element drawing one of Gmail's icons by name. */
const icon = (name: string) => {
  const { style } = document.createElement("div");
  style.backgroundImage = `url("https://www.gstatic.com/images/icons/material/system_gm/1x/${name}_20dp.png")`;
  return style;
};

// Gmail's changes reach the feature through its observer, whose records arrive after a turn, and the batch they ask for runs in the next frame.
const afterGmail = async (page: ReturnType<typeof mount>) => {
  await pause(0);
  page.run();
};

describe("the extended dark theme over a captured conversation", () => {
  it("keeps the seam between two messages translucent rather than a light line", () => {
    const page = mount();
    const seams = [...document.querySelectorAll(".G3.G2")].map(
      (seam) => parseColour(computed(seam).borderTopColor)?.a
    );

    expect(seams.length).toBeGreaterThan(0);
    expect(
      seams.filter((alpha) => alpha === undefined || alpha >= 1)
    ).toStrictEqual([]);
    page.app.dispose();
  });

  it("turns a dark icon Gmail draws on a pseudo-element light, and leaves one its name says is light", () => {
    document.body.innerHTML = thread;
    const sheet = must(document.querySelector(".iY"), "conversation's sheet");
    sheet.setAttribute("style", "background-color: rgb(255, 255, 255)");
    const [dark, light] = [
      ...document.querySelectorAll('[data-message-id] [role="checkbox"] .T-KT'),
      ...document.querySelectorAll(".T-KT"),
    ];
    // happy-dom computes no pseudo-element's style, so the page's reading of one is handed in, as Chromium answers it for Gmail's star.
    const pseudoTheme = {
      ...theme,
      styleOf: (element: Element, pseudo?: "::before" | "::after") => {
        if (pseudo === "::before" && element === dark) {
          return icon("star_border_black");
        }
        if (pseudo === "::before" && element === light) {
          return icon("star_border_white");
        }
        return getComputedStyle(element);
      },
    };
    themeTree(sheet, pseudoTheme);

    expect([
      dark?.getAttribute(turnedOf(TEST_MARK)),
      light?.getAttribute(turnedOf(TEST_MARK)),
    ]).toStrictEqual(["before", null]);
    expect(themeSheet(TEST_MARK)).toContain(
      `[${turnedOf(TEST_MARK)}~="before"]::before`
    );
  });

  it("themes a menu Gmail builds in a message and fills once it has moved it to the page, in the batch the items arrive", async () => {
    const page = mount();
    const list = must(
      document.querySelector('ul[role="menu"]'),
      "message's More menu"
    );
    const menu = must(list.parentElement?.parentElement, "menu's box");
    const items = [...list.children];
    for (const item of items) {
      item.remove();
    }
    must(document.querySelector("[data-message-id]"), "message").append(menu);
    await afterGmail(page);
    const themedEmpty = menu.hasAttribute(TEST_MARK);
    document.body.append(menu);
    list.append(...items);
    await afterGmail(page);
    const labels = [...list.querySelectorAll(".aqdrmf-Kf-fpDzbe-K0")];
    const ground = must(
      parseColour(computed(menu).backgroundColor),
      "menu's ground"
    );

    expect(themedEmpty).toBeTruthy();
    expect(labels.length).toBeGreaterThan(0);
    expect(
      labels.filter((label) => {
        const ink = parseColour(computed(label).color);
        return ink === undefined || contrast(ink, ground) < TEXT_CONTRAST;
      })
    ).toStrictEqual([]);
    page.app.dispose();
  });

  it("turns the inline reply's editor over through its sheet and writes nothing into it", () => {
    const page = mount();
    const editor = must(
      document.querySelector('[role="main"] [contenteditable="true"]'),
      "inline reply"
    );
    const rule = must(
      (page.sheet("extendDarkTheme") ?? "")
        .split("\n")
        .find((line) => line.includes(`="${SKIPPED}"] {`)),
      "editor's rule"
    );
    const [selector = ""] = rule.split(" {");

    expect([
      editor.getAttribute(TEST_MARK),
      editor.querySelectorAll(`[${TEST_MARK}]`).length,
      editor.matches(selector),
      rule.includes("filter: invert(1) hue-rotate(180deg) !important"),
    ]).toStrictEqual([SKIPPED, 0, true, true]);
    page.app.dispose();
  });

  it("decides a reply box's border again once Gmail takes its focus class off", async () => {
    const page = mountGmail({
      features: [extendDarkTheme(TEST_MARK)],
      html: `${GMAIL_RULES}${thread.replace('class="I5"', 'class="I5 bzE"')}`,
      settings: on,
    });
    page.run();
    const box = must(document.querySelector(".I5"), "reply box");
    const focused = computed(box).borderTopColor;
    box.classList.remove("bzE");
    await afterGmail(page);
    const border = must(
      parseColour(computed(box).borderTopColor),
      "reply box's border"
    );

    expect(parseColour(focused)?.a).toBe(0);
    expect(border.r).toBeLessThan(128);
    page.app.dispose();
  });

  it("darkens the shadow Gmail gives its reply bar once the bar sticks", async () => {
    const page = mount();
    const bar = must(document.querySelector(".rT5Apb"), "reply bar");
    bar.classList.add("tyMQmc");
    await afterGmail(page);
    const shadow = parseColour(computed(bar).boxShadow.split(" 0px")[0] ?? "");

    expect(shadow === undefined ? 255 : shadow.r).toBeLessThan(128);
    page.app.dispose();
  });

  it("leaves a mark on no element of Gmail's own a state change reached once turned off", async () => {
    const page = mount();
    const box = must(document.querySelector(".I5"), "reply box");
    box.classList.add("bzE");
    await afterGmail(page);
    page.change({ switches: switchesWith() });

    expect(document.querySelectorAll(`[${TEST_MARK}]`)).toHaveLength(0);
    page.app.dispose();
  });
});
