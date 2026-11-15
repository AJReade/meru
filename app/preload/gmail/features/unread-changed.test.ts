import { describe, expect, it } from "vitest";

import { gmail } from "../../../shared/channels/gmail.ts";
import { mountGmail, withoutFrames } from "../testing.ts";
import inboxRows from "./fixtures/inbox-rows.html?raw";
import { INBOX_LINK } from "./refresh.ts";
import { unreadChanged } from "./unread-changed.ts";

// The captured inbox's count, which Gmail draws beside the link in the row's tooltip holder.
const shownCount = () =>
  document
    .querySelector(INBOX_LINK)
    ?.closest("[data-tooltip]")
    ?.querySelector(".bsU");

describe(unreadChanged, () => {
  it("says nothing of the count the page loads with, then each time Gmail shows another", async () => {
    const page = mountGmail({ features: [unreadChanged()], html: inboxRows });
    page.run();
    const count = shownCount();
    const loaded = page.bridge.sentOn(gmail.unreadChanged);

    if (count !== null && count !== undefined) {
      count.textContent = "2";
    }
    await page.settle();
    expect([
      count?.isConnected,
      loaded,
      page.bridge.sentOn(gmail.unreadChanged),
    ]).toStrictEqual([true, [], [{}]]);

    // A change elsewhere in the page is not a change of the count.
    document.body.append(document.createElement("p"));
    await page.settle();
    if (count !== null && count !== undefined) {
      count.textContent = "";
    }
    await page.settle();
    expect(page.bridge.sentOn(gmail.unreadChanged)).toStrictEqual([{}, {}]);
    page.app.dispose();
  });

  it("waits for the navigation when the page has none yet, and says nothing of the count it first shows", async () => {
    const page = mountGmail({ features: [unreadChanged()], html: "" });
    page.run();
    document.body.innerHTML = withoutFrames(inboxRows);
    await page.settle();
    expect(page.bridge.sentOn(gmail.unreadChanged)).toStrictEqual([]);
    page.app.dispose();
  });
});
