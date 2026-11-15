import { describe, expect, it } from "vitest";

import { mountGmail, switchesWith } from "../testing.ts";
import { attachmentsToTop } from "./attachments-to-top.ts";
import attachments from "./fixtures/attachments.html?raw";

// Gmail's message holds more than its body and its attachments, so only the order of those two is read.
const order = () =>
  [...(document.querySelector(".ii.gt")?.parentElement?.children ?? [])]
    .map((child) => child.className)
    .filter((name) => name === "ii gt" || name === "hq gt");

describe(attachmentsToTop.id, () => {
  it("moves a message's attachments above its body once, under one rule, however often the page changes", async () => {
    const page = mountGmail({
      features: [attachmentsToTop],
      html: attachments,
      settings: { switches: switchesWith("moveAttachmentsToTop") },
    });
    page.run();
    document.body.append(document.createElement("p"));
    await page.settle();

    expect(order()).toStrictEqual(["hq gt", "ii gt"]);
    expect(document.querySelectorAll(".meru-attachments-rule")).toHaveLength(1);
    page.app.dispose();
  });

  it("puts the attachments back and takes its rule away when turned off", () => {
    const page = mountGmail({
      features: [attachmentsToTop],
      html: attachments,
      settings: { switches: switchesWith("moveAttachmentsToTop") },
    });
    page.run();

    page.change({ switches: switchesWith() });

    expect(order()).toStrictEqual(["ii gt", "hq gt"]);
    expect(document.querySelectorAll(".meru-attachments-rule")).toHaveLength(0);
    page.app.dispose();
  });

  it("leaves a message alone while it is off", () => {
    const page = mountGmail({
      features: [attachmentsToTop],
      html: attachments,
    });
    page.run();

    expect(order()).toStrictEqual(["ii gt", "hq gt"]);
    page.app.dispose();
  });
});
