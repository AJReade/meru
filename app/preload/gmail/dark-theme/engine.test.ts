import { describe, expect, it } from "vitest";

import {
  DARK_SURFACE,
  TEXT_CONTRAST,
  contrast,
  parseColour,
} from "../../../core/engines/dark-theme.ts";
import { MARK, releaseTree, themeTree } from "./engine.ts";
import { corpus, mountMail, styleOf, textContrasts } from "./testing.ts";

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
      themeTree(sheet, styleOf, "#nothing");

      const unreadable = textContrasts(sheet).filter(
        ({ contrast: ratio }) => ratio < TEXT_CONTRAST - 0.01
      );
      expect(unreadable).toStrictEqual([]);
    }
  );

  it.each(corpus)("puts $name back exactly as the mail had it", ({ html }) => {
    const body = mount(html);
    const before = body.outerHTML;
    themeTree(body, styleOf);

    releaseTree(document);

    expect(body.outerHTML).toBe(before);
    expect(document.querySelectorAll(`[${MARK}]`)).toHaveLength(0);
  });

  it("darkens what is light and keeps what is the mail's own colour", () => {
    const body = mount(
      `<div class="a3s"><div id="light" style="background-color: rgb(249, 249, 249)">Text</div><a id="button" style="background-color: rgb(26, 115, 232); color: rgb(255, 255, 255)">Go</a></div>`
    );
    themeTree(body, styleOf);

    const light = body.querySelector("#light");
    const ground = parseColour(
      light === null ? "" : styleOf(light).backgroundColor
    );

    expect([
      ground === undefined ? 1 : contrast(ground, DARK_SURFACE) < 1.2,
      light?.getAttribute(MARK),
      body.querySelector("#button")?.hasAttribute(MARK),
    ]).toStrictEqual([true, "background-color: rgb(249, 249, 249)", false]);
  });

  it("reaches only what is new when it walks a subtree again", () => {
    const body = mount(
      `<div class="a3s"><p style="color: rgb(51, 51, 51)">Old</p></div>`
    );
    const first = themeTree(body, styleOf);
    const added = document.createElement("p");
    added.setAttribute("style", "background-color: rgb(255, 255, 255)");
    body.append(added);

    expect([first.touched, themeTree(body, styleOf).touched]).toStrictEqual([
      2, 1,
    ]);
  });

  it("leaves an editor alone, since Gmail sends its markup", () => {
    const body = mount(
      `<div class="a3s"><div contenteditable="true" style="color: rgb(34, 34, 34)"><p style="background-color: rgb(255, 255, 255)">Draft</p></div></div>`
    );
    themeTree(body, styleOf);

    expect(
      document.querySelectorAll(
        `[contenteditable] [${MARK}], [contenteditable][${MARK}]`
      )
    ).toHaveLength(0);
  });
});
