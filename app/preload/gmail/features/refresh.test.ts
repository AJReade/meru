import { describe, expect, it } from "vitest";

import { gmailPushes } from "../../../shared/channels/gmail.ts";
import { mountGmail, MAILBOX } from "../testing.ts";
import { refresh } from "./refresh.ts";

// Gmail's own markup for the two, as a signed-in inbox shows them.
const NAVIGATION = `<div role="navigation"><div class="TO" data-tooltip="Inbox"><span class="nU n1"><a href="${MAILBOX}/#inbox" aria-label="Inbox 1 unread">Inbox</a></span><div class="bsU">1</div></div></div>`;
const REFRESH = `<div class="T-I J-J5-Ji nu T-I-ax7 L3" act="20" role="button" tabindex="0" aria-label="Refresh" data-tooltip="Refresh"></div>`;

const clicksOn = (selector: string): string[] => {
  const seen: string[] = [];
  for (const type of ["mousedown", "mouseup", "click"]) {
    document.querySelector(selector)?.addEventListener(type, () => {
      seen.push(type);
    });
  }
  return seen;
};

describe(refresh.id, () => {
  it("presses Gmail's Refresh as a pointer would and leaves the focus where it was", () => {
    const page = mountGmail({
      features: [refresh],
      html: `${NAVIGATION}${REFRESH}<textarea></textarea>`,
    });
    const pressed = clicksOn('[act="20"]');
    const followed = clicksOn('a[href$="#inbox"]');
    const reply = document.querySelector("textarea");
    reply?.focus();
    document
      .querySelector<HTMLElement>('[act="20"]')
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

  it("follows the inbox's link where Gmail shows no Refresh, such as an open message in the inbox", () => {
    const page = mountGmail({
      features: [refresh],
      href: `${MAILBOX}/#inbox/abc123`,
      html: NAVIGATION,
    });
    const followed = clicksOn('a[href$="#inbox"]');

    page.bridge.push(gmailPushes.refresh, {});

    expect(followed).toStrictEqual(["click"]);
    page.app.dispose();
  });

  it("leaves a page outside the inbox with no Refresh where it is", () => {
    const page = mountGmail({
      features: [refresh],
      href: `${MAILBOX}/#label/Work/abc123`,
      html: NAVIGATION,
    });
    const followed = clicksOn('a[href$="#inbox"]');

    page.bridge.push(gmailPushes.refresh, {});

    expect(followed).toStrictEqual([]);
    page.app.dispose();
  });
});
