import { describe, expect, it } from "vitest";

import { gmail } from "../../shared/channels/gmail.ts";
import { gmailSurface } from "../../shared/channels/surfaces.ts";
import { FakeContentBridge } from "../content/fake-bridge.ts";
import { startGmail } from "./app.ts";
import { FakeImagePixels } from "./dark-theme/fake-pixels.ts";
import { FakeGmailHttp } from "./fake-http.ts";
import { hideGmailLogo } from "./features/hide-gmail-logo.ts";
import { needsSignIn } from "./features/needs-sign-in.ts";
import { mountGmail, stylesWith, testSettings } from "./testing.ts";

describe(startGmail, () => {
  it("says which settings it applied, every time they change", () => {
    const page = mountGmail({ features: [hideGmailLogo] });

    page.change({});
    page.change({});

    expect(page.bridge.sentOn(gmail.settingsAck)).toStrictEqual([
      { version: 1 },
      { version: 2 },
      { version: 2 },
    ]);
    page.app.dispose();
  });

  it("holds a feature of the mailbox back while the page is elsewhere", () => {
    const page = mountGmail({
      features: [hideGmailLogo, needsSignIn],
      href: `${testSettings.signIn}/v3/signin/identifier`,
      settings: { styles: stylesWith("hideGmailLogo") },
    });

    expect(page.sheet("hideGmailLogo")).toBeUndefined();
    expect(page.bridge.sentOn(gmail.needsSignIn)).toStrictEqual([{}]);

    page.go(`${testSettings.mailbox}/#inbox`);
    page.change({});

    expect(page.sheet("hideGmailLogo")).toContain("display: none");
    page.app.dispose();
  });

  it("applies nothing while main has no settings to give", () => {
    const bridge = new FakeContentBridge(gmailSurface);
    document.head.innerHTML = "";

    const app = startGmail({
      bridge,
      cookie: () => "",
      document,
      features: [hideGmailLogo],
      http: new FakeGmailHttp(),
      location: { href: () => testSettings.mailbox, setHash: () => {} },
      pixels: new FakeImagePixels().pixels,
    });

    expect(document.head.innerHTML).toBe("");
    expect(bridge.sentOn(gmail.settingsAck)).toStrictEqual([]);
    app.dispose();
  });

  it("reports a selector miss once per page load, however often the settings change", async () => {
    let now = 0;
    const page = mountGmail({
      features: [hideGmailLogo],
      grace: 1000,
      html: '<header><span aria-label="Gmail">Gmail</span></header>',
      now: () => now,
      settings: { styles: stylesWith("hideGmailLogo") },
    });
    page.run();

    const toggle = async () => {
      page.change({ styles: stylesWith() });
      page.change({ styles: stylesWith("hideGmailLogo") });
      now += 1500;
      document.body.append(document.createElement("p"));
      await page.settle();
    };
    await toggle();
    await toggle();
    await toggle();

    expect(page.bridge.sentOn(gmail.selectorMiss)).toStrictEqual([
      { selector: "hideGmailLogo" },
    ]);
    page.app.dispose();
  });

  it("reports a feature that throws to main and applies the rest, at most five times a page load", () => {
    const broken = {
      apply: () => {
        throw new Error("broken");
      },
      id: "broken",
    };
    const page = mountGmail({
      features: [broken, hideGmailLogo],
      settings: { styles: stylesWith("hideGmailLogo") },
    });
    for (let change = 0; change < 6; change += 1) {
      page.change({});
    }

    expect(page.sheet("hideGmailLogo")).toContain("display: none");
    expect(page.bridge.sentOn(gmail.failed)).toHaveLength(5);
    expect(page.bridge.sentOn(gmail.failed)[0]).toMatchObject({
      message: "broken",
      what: "feature broken",
    });
    page.app.dispose();
  });

  it("takes every sheet down when the page goes", () => {
    const page = mountGmail({
      features: [hideGmailLogo],
      settings: { styles: stylesWith("hideGmailLogo") },
    });

    page.app.dispose();

    expect(page.sheet("hideGmailLogo")).toBeUndefined();
  });
});
