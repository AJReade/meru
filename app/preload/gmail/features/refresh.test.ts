import { describe, expect, it } from "vitest";

import { gmailPushes } from "../../../shared/channels/gmail.ts";
import { mountGmail, MAILBOX, withoutFrames } from "../testing.ts";
import attachments from "./fixtures/attachments.html?raw";
import inboxRows from "./fixtures/inbox-rows.html?raw";
import {
  INBOX_LINK,
  REFRESH_BUTTON,
  REFRESH_INTERVAL,
  refresh,
} from "./refresh.ts";

const withoutRefresh = (html: string) =>
  html.replaceAll('act="20"', 'act="none"');

const clicksOn = (selector: string): string[] => {
  const seen: string[] = [];
  for (const type of ["mousedown", "mouseup", "click"]) {
    document.querySelector(selector)?.addEventListener(type, (event) => {
      // happy-dom would follow the inbox link's address.
      event.preventDefault();
      seen.push(type);
    });
  }
  return seen;
};

describe(refresh, () => {
  it("presses Refresh on the captured inbox as a pointer would and leaves the focus where it was", () => {
    const page = mountGmail({
      features: [refresh()],
      html: `${inboxRows}<textarea></textarea>`,
    });
    const pressed = clicksOn(REFRESH_BUTTON);
    const followed = clicksOn(INBOX_LINK);
    const reply = document.querySelector("textarea");
    reply?.focus();
    document
      .querySelector<HTMLElement>(REFRESH_BUTTON)
      ?.addEventListener("mousedown", (event) => {
        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.focus();
        }
      });

    page.bridge.push(gmailPushes.refresh, {});

    expect({
      focused: document.activeElement === reply,
      followed,
      pressed,
    }).toStrictEqual({
      focused: true,
      followed: [],
      pressed: ["mousedown", "mouseup", "click"],
    });
    page.app.dispose();
  });

  it("presses at most once an interval, a push that found nothing to press while Gmail loads not counting", () => {
    let now = 0;
    const page = mountGmail({ features: [refresh(() => now)], html: "" });

    page.bridge.push(gmailPushes.refresh, {});
    document.body.innerHTML = withoutFrames(inboxRows);
    const pressed = clicksOn(REFRESH_BUTTON);
    now = 1;
    page.bridge.push(gmailPushes.refresh, {});
    now = REFRESH_INTERVAL;
    page.bridge.push(gmailPushes.refresh, {});
    const withinInterval = pressed.length;
    now = REFRESH_INTERVAL + 1;
    page.bridge.push(gmailPushes.refresh, {});

    expect([withinInterval, pressed.length]).toStrictEqual([3, 6]);
    page.app.dispose();
  });

  it("follows the inbox's link on the captured inbox's list when Gmail shows no Refresh", () => {
    const page = mountGmail({
      features: [refresh()],
      html: withoutRefresh(inboxRows),
    });
    const followed = clicksOn(INBOX_LINK);

    page.bridge.push(gmailPushes.refresh, {});

    expect(followed).toStrictEqual(["click"]);
    page.app.dispose();
  });

  it("leaves a captured open message open, and a page outside the inbox where it is, when Gmail shows no Refresh", () => {
    const followed = [`${MAILBOX}/#inbox/FMfcgz`, `${MAILBOX}/#label/Work`].map(
      (href) => {
        const page = mountGmail({
          features: [refresh()],
          href,
          html: withoutRefresh(attachments),
        });
        const clicks = clicksOn(INBOX_LINK);
        page.bridge.push(gmailPushes.refresh, {});
        page.app.dispose();
        return clicks;
      }
    );

    expect(followed).toStrictEqual([[], []]);
  });
});
