import { describe, expect, it, vi } from "vitest";

import { gmail } from "../../../shared/channels/gmail.ts";
import { MAILBOX, mountGmail, switchesWith } from "../testing.ts";
import type { MountedGmail } from "../testing.ts";
import { bodyOf, clippedMessages } from "./clipped-messages.ts";
import clipped from "./fixtures/clipped.html?raw";

const PRINT_VIEW = `<html><body>
<table class="message"><tr><td><font size="-1">An earlier message</font></td></tr></table>
<table class="message"><tr><td>
  <font size="-1">Header</font>
  <font size="-1"><p onclick="steal()">The whole message.</p><script>steal()</script><a href="javascript:steal()">bad</a><a href="https://example.com/">good</a><img src="data:image/png;base64,AA=="></font>
</td></tr></table>
</body></html>`;

const PRINT_ADDRESS = `${MAILBOX}/?ui=2&ik=abc&view=lg&permmsgid=msg-f:123`;

const mount = (on = true): MountedGmail =>
  mountGmail({
    features: [clippedMessages],
    html: clipped,
    settings: on
      ? { switches: switchesWith("loadClippedMessages") }
      : undefined,
  });

const printed = (page: MountedGmail, url?: string) => {
  page.http.answer(`${MAILBOX}/?`, { status: 200, text: PRINT_VIEW, url });
};

describe(clippedMessages.id, () => {
  it("replaces the clipped body with the whole message from the print view, sanitised", async () => {
    const page = mount();
    printed(page);
    page.run();

    await vi.waitFor(() => {
      expect(document.querySelector(".iX")).toBeNull();
    });
    expect(page.http.asked).toStrictEqual([PRINT_ADDRESS]);
    const body = document.querySelector(".clipped-body");
    expect([
      body?.textContent?.includes("The whole message."),
      body?.querySelector("script, [onclick]"),
    ]).toStrictEqual([true, null]);
    expect(
      [...(body?.querySelectorAll("a") ?? [])].map((link) => [
        link.getAttribute("href"),
        link.getAttribute("target"),
      ])
    ).toStrictEqual([
      [null, null],
      ["https://example.com/", "_blank"],
    ]);
    expect(body?.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AA=="
    );
    page.app.dispose();
  });

  it("reports a print view that lands on the sign-in page once, as a selector miss, and leaves the link", async () => {
    const page = mount();
    printed(page, "https://accounts.google.com/ServiceLogin");
    page.run();

    await vi.waitFor(() => {
      expect(page.bridge.sentOn(gmail.selectorMiss)).toStrictEqual([
        { selector: "clippedMessages" },
      ]);
    });
    expect(document.querySelector(".iX")).not.toBeNull();
    page.app.dispose();
  });

  it("fetches nothing while it is off, or for a link that leaves Gmail", () => {
    const off = mount(false);
    off.run();
    expect(off.http.asked).toStrictEqual([]);
    off.app.dispose();

    const elsewhere = mount();
    document
      .querySelector(".iX a")
      ?.setAttribute("href", "https://evil.example/?view=lg&permmsgid=1");
    elsewhere.run();
    expect(elsewhere.http.asked).toStrictEqual([]);
    elsewhere.app.dispose();
  });

  it("refuses a print view with no message body", () => {
    expect(() => bodyOf("<p>Sign in</p>", MAILBOX)).toThrow(
      "The print view holds no message body"
    );
  });
});
