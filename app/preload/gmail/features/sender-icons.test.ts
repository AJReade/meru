import { describe, expect, it } from "vitest";

import { gmail } from "../../../shared/channels/gmail.ts";
import { mountGmail, switchesWith } from "../testing.ts";
import inboxRows from "./fixtures/inbox-rows.html?raw";
import { senderIcons } from "./sender-icons.ts";

const favicon = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

// The capture's account mails itself, so every sender shares one domain until a test gives one another.
const SENDER_DOMAIN = "domain-1.example.com";

const rows = () => [...document.querySelectorAll("tr.zA")];

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
    const [first, second] = rows();
    second
      ?.querySelector('span[email*="@"]')
      ?.setAttribute("email", "grace@navy.example");
    page.run();

    expect(iconsOf(first?.id ?? "")).toStrictEqual([favicon(SENDER_DOMAIN)]);
    expect(iconsOf(second?.id ?? "")).toStrictEqual([
      favicon("navy.example"),
      favicon(SENDER_DOMAIN),
    ]);
    expect(
      [...document.querySelectorAll(".meru-sender-icons")].map(
        (icons) => icons.id
      )
    ).toStrictEqual(rows().map((row) => `meru-sender-icons-${row.id}`));
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

    expect(document.querySelectorAll(".meru-sender-icons")).toHaveLength(
      rows().length
    );

    page.change({ switches: switchesWith() });

    expect(document.querySelectorAll(".meru-sender-icons")).toHaveLength(0);
    expect(page.sheet("senderIcons")).toBeUndefined();
    page.app.dispose();
  });

  it("draws a row's icons again when Gmail redraws its senders in the same row, as new mail moving the list does", async () => {
    const page = mountGmail({
      features: [senderIcons],
      html: inboxRows,
      settings: { switches: switchesWith("showSenderIcons") },
    });
    page.run();
    const [first] = rows();
    const column = first?.querySelector('span[email*="@"]')?.closest("td");
    const senders = column?.innerHTML.replace(
      /<div class="meru-sender-icons".*<\/div>$/u,
      ""
    );
    if (column !== null && column !== undefined && senders !== undefined) {
      column.innerHTML = senders;
    }
    await page.settle();

    expect(iconsOf(first?.id ?? "")).toStrictEqual([favicon(SENDER_DOMAIN)]);
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
