import { describe, expect, it } from "vitest";

import { mountGmail, switchesWith } from "../testing.ts";
import { attachmentsToTop } from "./attachments-to-top.ts";
import attachments from "./fixtures/attachments.html?raw";

const order = () =>
  [...(document.querySelector(".gs")?.children ?? [])].map(
    (child) => child.className
  );

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

    expect(order()).toStrictEqual(["hq gt", "ii gt", "gA"]);
    expect(document.querySelectorAll(".hp")).toHaveLength(1);
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

    expect(order()).toStrictEqual(["ii gt", "hq gt", "gA"]);
    expect(document.querySelectorAll(".hp")).toHaveLength(0);
    page.app.dispose();
  });

  it("leaves a message alone while it is off", () => {
    const page = mountGmail({
      features: [attachmentsToTop],
      html: attachments,
    });
    page.run();

    expect(order()).toStrictEqual(["ii gt", "hq gt", "gA"]);
    page.app.dispose();
  });
});
