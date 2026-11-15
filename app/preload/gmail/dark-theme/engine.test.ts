import { describe, expect, it } from "vitest";

import {
  DARK_SURFACE,
  TEXT_CONTRAST,
  contrast,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import {
  SKIPPED,
  newMark,
  releaseTree,
  themeAgain,
  themeTree,
} from "./engine.ts";
import { FakeCanvas } from "./fake-canvas.ts";
import {
  TEST_MARK,
  corpus,
  mountMail,
  styleOf,
  textContrasts,
  theme,
} from "./testing.ts";

const mount = (html: string): HTMLElement => {
  const body = mountMail(html).querySelector(".a3s");
  if (!(body instanceof HTMLElement)) {
    throw new TypeError("The mail has no body");
  }
  return body;
};

describe(themeTree, () => {
  it("has a corpus of real mails' shapes to theme, each headed by where it came from and no date", () => {
    expect([
      corpus.length >= 25,
      corpus.flatMap(({ html, name }) =>
        /^<!-- Corpus: [\s\S]*?-->/u.test(html) &&
        !/\d{4}-\d{2}-\d{2}/u.test(html.slice(0, html.indexOf("-->")))
          ? []
          : [name]
      ),
    ]).toStrictEqual([true, []]);
  });

  it.each(corpus)(
    `themes $name with every text at ${TEXT_CONTRAST} against its ground`,
    ({ html }) => {
      const sheet = mountMail(html);
      themeTree(sheet, theme, "#nothing");

      const unreadable = textContrasts(sheet).filter(
        ({ contrast: ratio }) => ratio < TEXT_CONTRAST - 0.01
      );
      expect(unreadable).toStrictEqual([]);
    }
  );

  it.each(corpus)("puts $name back exactly as the mail had it", ({ html }) => {
    const body = mount(html);
    const before = body.outerHTML;
    themeTree(body, theme);

    releaseTree(document, TEST_MARK);

    expect(body.outerHTML).toBe(before);
    expect(document.querySelectorAll(`[${TEST_MARK}]`)).toHaveLength(0);
  });

  it("darkens what is light and keeps what is the mail's own colour", () => {
    const body = mount(
      `<div class="a3s"><div id="light" style="background-color: rgb(249, 249, 249)">Text</div><a id="button" style="background-color: rgb(26, 115, 232); color: rgb(255, 255, 255)">Go</a></div>`
    );
    themeTree(body, theme);

    const light = body.querySelector("#light");
    const ground = parseColour(
      light === null ? "" : styleOf(light).backgroundColor
    );

    expect([
      ground === undefined ? 1 : contrast(ground, DARK_SURFACE) < 1.2,
      light?.getAttribute(TEST_MARK),
      body.querySelector("#button")?.getAttribute("style"),
    ]).toStrictEqual([
      true,
      "-1background-color: rgb(249, 249, 249)",
      "background-color: rgb(26, 115, 232); color: rgb(255, 255, 255)",
    ]);
  });

  it("holds the colour of every text on a darkened ground, inherited or its own, against a mail's hover rule", () => {
    const body = mount(
      `<div class="a3s"><div style="background-color: rgb(255, 255, 255); color: rgb(34, 34, 34)"><a id="inherits">Inherits</a><a id="own" style="color: rgb(51, 51, 51)">Own</a><div id="boxes"><span>Held by the span</span></div></div></div>`
    );
    themeTree(body, theme);

    expect(
      ["#inherits", "#own", "#boxes", "#boxes span"].map((selector) =>
        body
          .querySelector(selector)
          ?.getAttribute("style")
          ?.includes("!important")
      )
    ).toStrictEqual([true, true, undefined, true]);
  });

  it("reaches only what is new when it walks a subtree again", () => {
    const body = mount(
      `<div class="a3s"><p style="color: rgb(51, 51, 51)">Old</p></div>`
    );
    const first = themeTree(body, theme);
    const added = document.createElement("p");
    added.setAttribute("style", "background-color: rgb(255, 255, 255)");
    body.append(added);

    expect([first.touched, themeTree(body, theme).touched]).toStrictEqual([
      2, 1,
    ]);
  });

  it("leaves an editor alone, since Gmail sends its markup, marking it skipped once so a walk again passes what it holds", () => {
    const body = mount(
      `<div class="a3s"><div id="editor" contenteditable="true" style="color: rgb(34, 34, 34)"><p style="background-color: rgb(255, 255, 255)">Draft</p></div></div>`
    );
    themeTree(body, theme);
    const editor = body.querySelector("#editor");
    editor?.append(document.createElement("p"));
    const again = themeAgain(body, theme);

    expect([
      editor?.getAttribute(TEST_MARK),
      editor?.getAttribute("style"),
      document.querySelectorAll(`[contenteditable] [${TEST_MARK}]`).length,
      again.touched,
    ]).toStrictEqual([SKIPPED, "color: rgb(34, 34, 34)", 0, 0]);
  });

  it("keeps a background under a picture and decides its text against it", () => {
    const body = mount(
      `<div class="a3s"><div style="background-color: rgb(255, 255, 255); color: rgb(51, 51, 51)"><div id="pictured" style="background-image: url('https://example.com/hero.png'); background-color: rgb(255, 255, 255); color: rgb(0, 0, 0) !important">Over a picture</div></div></div>`
    );
    const before = body.querySelector("#pictured")?.getAttribute("style");
    themeTree(body, theme);

    expect(body.querySelector("#pictured")?.getAttribute("style")).toBe(before);
  });

  // happy-dom computes a named colour as it was written and drops CSS Color 4's, so a named one stands here for a colour Chromium computes in a space of its own, such as `oklch()`, which `parseColour` cannot read either.
  it("reads a colour parseColour cannot through the canvas, and leaves what neither can read", () => {
    const canvas = new FakeCanvas();
    canvas.answerColour("dimgray", { a: 1, b: 105, g: 105, r: 105 });
    const body = mount(
      `<div class="a3s"><div style="background-color: rgb(255, 255, 255)"><p id="read" style="color: dimgray">Read</p><div style="background-color: white"><p id="unread" style="color: rgb(34, 34, 34)">Unread</p></div></div></div>`
    );
    themeTree(body, {
      ...theme,
      colourOf: (text) => parseColour(text) ?? canvas.colour(text),
    });
    const read = parseColour(
      body
        .querySelector("#read")
        ?.getAttribute("style")
        ?.replace(
          /^.*color: (?<colour>rgb\([^)]*\)) !important.*$/u,
          "$<colour>"
        ) ?? ""
    );

    expect([
      read === undefined ? 0 : contrast(read, DARK_SURFACE) >= TEXT_CONTRAST,
      body.querySelector("#unread")?.getAttribute("style"),
    ]).toStrictEqual([true, "color: rgb(34, 34, 34)"]);
  });

  it("leaves a mark the mail carries alone, whatever it holds", () => {
    const mark = newMark();
    const body = mount(
      `<div class="a3s"><div id="spoof" data-meru-dark="position:fixed;inset:0;z-index:2147483647" style="color:#000">Spoof</div><div id="wipe" data-meru-dark="" data-meru-dark-0="" style="background:#fff;color:#000">Wipe</div></div>`
    );
    themeTree(body, { ...theme, mark });

    releaseTree(document, mark);

    expect([
      body.querySelector("#spoof")?.getAttribute("style"),
      body.querySelector("#wipe")?.getAttribute("style"),
      mark.startsWith("data-meru-dark-"),
    ]).toStrictEqual(["color:#000", "background:#fff;color:#000", true]);
  });
});
