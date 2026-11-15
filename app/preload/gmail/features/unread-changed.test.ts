import { describe, expect, it } from "vitest";

import { gmail } from "../../../shared/channels/gmail.ts";
import { mountGmail, MAILBOX } from "../testing.ts";
import { unreadChanged } from "./unread-changed.ts";

const navigation = (count: string) =>
  `<div role="navigation"><div class="TO" data-tooltip="Inbox"><span class="nU n1"><a href="${MAILBOX}/#inbox" aria-label="Inbox ${count} unread">Inbox</a></span><div class="bsU">${count}</div></div></div><a href="${MAILBOX}/#inbox" aria-label="Gmail"></a>`;

describe(unreadChanged, () => {
  it("says nothing of the count the page loads with, then each time Gmail shows another", async () => {
    const page = mountGmail({
      features: [unreadChanged()],
      html: navigation("3"),
    });
    page.run();
    expect(page.bridge.sentOn(gmail.unreadChanged)).toStrictEqual([]);

    const count = document.querySelector(".bsU");
    if (count !== null) {
      count.textContent = "2";
    }
    await page.settle();
    expect(page.bridge.sentOn(gmail.unreadChanged)).toStrictEqual([{}]);

    // A change elsewhere in the page is not a change of the count.
    document.body.append(document.createElement("p"));
    await page.settle();
    if (count !== null) {
      count.textContent = "";
    }
    await page.settle();
    expect(page.bridge.sentOn(gmail.unreadChanged)).toStrictEqual([{}, {}]);
    page.app.dispose();
  });

  it("waits for the navigation when the page has none yet, and says nothing of the count it first shows", async () => {
    const page = mountGmail({ features: [unreadChanged()], html: "" });
    page.run();
    document.body.innerHTML = navigation("5");
    await page.settle();
    expect(page.bridge.sentOn(gmail.unreadChanged)).toStrictEqual([]);
    page.app.dispose();
  });
});
