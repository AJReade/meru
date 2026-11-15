import { describe, expect, it } from "vitest";

import { mountGmail, switchesWith } from "../testing.ts";
import compose from "./fixtures/compose.html?raw";
import { popOuts } from "./pop-outs.ts";

/** Each click the element's page hears, by whether Shift was held. */
const listen = (selector: string) => {
  const heard: boolean[] = [];
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.matches(selector)) {
      heard.push(event.shiftKey);
    }
  });
  return heard;
};

const click = (selector: string, shiftKey = false) => {
  document
    .querySelector(selector)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey }));
};

describe(popOuts.id, () => {
  it("turns a click on Compose into a Shift-click, which Gmail opens in a window", () => {
    const page = mountGmail({
      features: [popOuts],
      html: compose,
      settings: { switches: switchesWith("openComposeInNewWindow") },
    });
    page.run();
    const heard = listen('[gh="cm"]');

    click('[gh="cm"]');
    click('[gh="cm"]', true);

    expect([
      heard,
      document.querySelector('[gh="cm"][data-meru-shift-click]') !== null,
    ]).toStrictEqual([[true, true], true]);
    page.app.dispose();
  });

  it("turns a click on Reply or Forward into a Shift-click under its own setting", () => {
    const page = mountGmail({
      features: [popOuts],
      html: compose,
      settings: { switches: switchesWith("replyForwardInPopOut") },
    });
    page.run();
    const replies = listen(".bkH");
    const composes = listen('[gh="cm"]');

    click(".bkH");
    click('[gh="cm"]');

    expect(replies).toStrictEqual([true]);
    expect(composes).toStrictEqual([false]);
    page.app.dispose();
  });

  it("leaves clicks alone once turned off, and leaves a strip of other than two links alone", () => {
    const page = mountGmail({
      features: [popOuts],
      html: compose,
      settings: {
        switches: switchesWith(
          "openComposeInNewWindow",
          "replyForwardInPopOut"
        ),
      },
    });
    page.run();
    page.change({ switches: switchesWith() });
    const heard = listen('[gh="cm"]');
    click('[gh="cm"]');
    expect(heard).toStrictEqual([false]);
    page.app.dispose();

    const changed = mountGmail({
      features: [popOuts],
      html: compose,
      settings: { switches: switchesWith("replyForwardInPopOut") },
    });
    document.querySelector(".bkG")?.remove();
    changed.run();
    const replies = listen(".bkH");
    click(".bkH");
    expect(replies).toStrictEqual([false]);
    changed.app.dispose();
  });
});
