import { describe, expect, it } from "vitest";

import { gmail } from "../../../shared/channels/gmail.ts";
import { mountGmail, switchesWith } from "../testing.ts";
import inboxRows from "./fixtures/inbox-rows.html?raw";
import { senderIcons } from "./sender-icons.ts";

const iconsOf = (rowId: string) =>
  [
    ...(document
      .querySelector(`[id="${rowId}"]`)
      ?.querySelectorAll(".meru-sender-icons img") ?? []),
  ].map((icon) => icon.getAttribute("src"));

describe(senderIcons.id, () => {
  it("puts one icon per sender domain beside each row's senders, each row's icons under an id of its own", () => {
    const page = mountGmail({
      features: [senderIcons],
      html: inboxRows,
      settings: { switches: switchesWith("showSenderIcons") },
    });
    page.run();

    expect(iconsOf(":1a")).toStrictEqual([
      "https://www.google.com/s2/favicons?domain=example.com&sz=32",
    ]);
    expect(iconsOf(":1b")).toStrictEqual([
      "https://www.google.com/s2/favicons?domain=navy.example&sz=32",
      "https://www.google.com/s2/favicons?domain=example.com&sz=32",
    ]);
    expect(
      [...document.querySelectorAll(".meru-sender-icons")].map(
        (icons) => icons.id
      )
    ).toStrictEqual(["meru-sender-icons-:1a", "meru-sender-icons-:1b"]);
    expect(page.sheet("senderIcons")).toContain("border-radius: 50%");
    page.app.dispose();
  });

  it("adds a row's icons once however often the page changes, and takes them all away when turned off", async () => {
    const page = mountGmail({
      features: [senderIcons],
      html: inboxRows,
      settings: { switches: switchesWith("showSenderIcons") },
    });
    page.run();
    document.body.append(document.createElement("p"));
    await page.settle();

    expect(document.querySelectorAll(".meru-sender-icons")).toHaveLength(2);

    page.change({ switches: switchesWith() });

    expect(document.querySelectorAll(".meru-sender-icons")).toHaveLength(0);
    expect(page.sheet("senderIcons")).toBeUndefined();
    page.app.dispose();
  });

  it("reports thread rows whose senders no longer carry their address", async () => {
    let now = 0;
    const page = mountGmail({
      features: [senderIcons],
      grace: 1000,
      html: inboxRows,
      now: () => now,
      settings: { switches: switchesWith("showSenderIcons") },
    });
    for (const sender of document.querySelectorAll("[email]")) {
      sender.removeAttribute("email");
    }
    page.run();
    now = 5000;
    document.body.append(document.createElement("p"));
    await page.settle();

    expect(page.bridge.sentOn(gmail.selectorMiss)).toStrictEqual([
      { selector: "senderIcons" },
    ]);
    page.app.dispose();
  });
});
