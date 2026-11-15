import { describe, expect, it } from "vitest";

import {
  DARK_SURFACE,
  TEXT_CONTRAST,
  contrast,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import { newMark, releaseTree, themeTree } from "./engine.ts";
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
  it("has a corpus of real mails' shapes to theme", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(25);
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

  it("leaves an editor alone, since Gmail sends its markup", () => {
    const body = mount(
      `<div class="a3s"><div contenteditable="true" style="color: rgb(34, 34, 34)"><p style="background-color: rgb(255, 255, 255)">Draft</p></div></div>`
    );
    themeTree(body, theme);

    expect(
      document.querySelectorAll(
        `[contenteditable] [${TEST_MARK}], [contenteditable][${TEST_MARK}]`
      )
    ).toHaveLength(0);
  });

  it("leaves a mark the mail carries alone, whatever it holds", () => {
    const mark = newMark();
    const body = mount(
      `<div class="a3s"><div id="spoof" data-meru-dark="position:fixed;inset:0;z-index:2147483647" style="color:#000">Spoof</div><div id="wipe" data-meru-dark="" data-meru-dark-0="" style="background:#fff;color:#000">Wipe</div></div>`
    );
    themeTree(body, { mark, styleOf });

    releaseTree(document, mark);

    expect([
      body.querySelector("#spoof")?.getAttribute("style"),
      body.querySelector("#wipe")?.getAttribute("style"),
      mark.startsWith("data-meru-dark-"),
    ]).toStrictEqual(["color:#000", "background:#fff;color:#000", true]);
  });
});
