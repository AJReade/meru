import { describe, expect, it } from "vitest";

import { gmail, gmailPushes } from "../../../shared/channels/gmail.ts";
import { mountGmail, testSettings } from "../testing.ts";
import { navigate } from "./navigate.ts";

describe(navigate.id, () => {
  it("takes the page to the fragment main sends and says it did", () => {
    const page = mountGmail({ features: [navigate] });

    page.bridge.push(gmailPushes.navigate, { hash: "#inbox/abc123", id: 3 });

    expect(page.hash()).toBe("#inbox/abc123");
    expect(page.bridge.sentOn(gmail.navigated)).toStrictEqual([
      { id: 3, navigated: true },
    ]);
    page.app.dispose();
  });

  it("leaves a page off the mailbox where it is and says it did not move, so main loads the address", () => {
    const page = mountGmail({
      features: [navigate],
      href: `${testSettings.signIn}/v3/signin/identifier`,
    });

    page.bridge.push(gmailPushes.navigate, { hash: "#inbox/abc123", id: 4 });

    expect(page.hash()).toBeUndefined();
    expect(page.bridge.sentOn(gmail.navigated)).toStrictEqual([
      { id: 4, navigated: false },
    ]);
    page.app.dispose();
  });
});
