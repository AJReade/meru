import { describe, expect, it } from "vitest";

import type { PageRoutes } from "../../core/ports.ts";
import { FakeBlankPopupWindow } from "../../test/fakes/blank-popup-window.ts";
import { FakeClock } from "../../test/fakes/clock.ts";
import { FakeLog } from "../../test/fakes/log.ts";
import { BLANK_POPUP_TIMEOUT, holdBlankPopup } from "./blank-popup.ts";

const SIGN_IN = "https://accounts.google.com/o/oauth2/auth";

const setup = () => {
  const clock = new FakeClock();
  const log = new FakeLog();
  const popup = new FakeBlankPopupWindow();
  const opened: string[] = [];
  const opener: PageRoutes = {
    open: (url) => {
      opened.push(url);
      return true;
    },
    popOut: () => null,
    popup: (url) => url.startsWith("https://accounts.google.com/"),
  };
  const routes = holdBlankPopup(popup, opener, {
    clock,
    log: log.scoped("views"),
  });
  return { clock, log, opened, popup, routes };
};

describe(holdBlankPopup, () => {
  it("shows a popup whose first navigation heads for sign-in, and hands what follows to the opener", () => {
    const { clock, opened, popup, routes } = setup();
    const kept = routes.open(SIGN_IN, "inPlace");
    clock.advance(BLANK_POPUP_TIMEOUT * 2);
    const next = routes.open("https://example.com/next", "inPlace");
    expect([kept, popup.visible, popup.destroyed, next, opened]).toStrictEqual([
      false,
      true,
      false,
      true,
      ["https://example.com/next"],
    ]);
  });

  it("destroys a popup sent elsewhere only once the navigation's listener has returned", () => {
    const { clock, popup, routes } = setup();
    const taken = routes.open("https://example.com/elsewhere", "inPlace");
    const duringNavigation = popup.destroyed;
    clock.advance(0);
    expect([taken, duringNavigation, popup.destroyed]).toStrictEqual([
      true,
      false,
      true,
    ]);
  });

  it("destroys a popup that never navigates once the timeout is out, and lets go of it", () => {
    const { clock, popup } = setup();
    clock.advance(BLANK_POPUP_TIMEOUT - 1);
    const early = popup.destroyed;
    clock.advance(1);
    expect([
      early,
      popup.destroyed,
      popup.listening,
      clock.pending,
    ]).toStrictEqual([false, true, 0, 0]);
  });

  it("destroys a popup whose renderer crashed, with a warning, and decides nothing after", () => {
    const { clock, log, opened, popup, routes } = setup();
    popup.end("crashed");
    clock.advance(0);
    routes.open(SIGN_IN, "inPlace");
    expect([popup.destroyed, popup.visible, opened, log.entries]).toStrictEqual(
      [
        true,
        false,
        [SIGN_IN],
        [
          {
            fields: { reason: "crashed" },
            level: "warn",
            message: "A popup's page ended",
            scope: "views",
          },
        ],
      ]
    );
  });

  it("destroys a shown sign-in popup whose renderer ends, and writes nothing for a clean exit", () => {
    const { clock, log, popup, routes } = setup();
    routes.open(SIGN_IN, "inPlace");
    popup.end("clean-exit");
    clock.advance(0);
    expect([popup.destroyed, log.entries, clock.pending]).toStrictEqual([
      true,
      [],
      0,
    ]);
  });

  it("forgets its timer and listeners when the window closes by other means", () => {
    const { clock, popup } = setup();
    popup.destroy();
    expect([popup.listening, clock.pending]).toStrictEqual([0, 0]);
  });
});
