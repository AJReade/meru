import { describe, expect, it, vi } from "vitest";

import { gmail } from "../../../shared/channels/gmail.ts";
import { MAILBOX, mountGmail, switchesWith } from "../testing.ts";
import type { MountedGmail } from "../testing.ts";
import {
  bodyOf,
  clippedMessages,
  PRINT_VIEW_LIMIT,
} from "./clipped-messages.ts";
import clipped from "./fixtures/clipped.html?raw";

const PRINT_VIEW = `<html><body>
<table class="message"><tr><td><font size="-1">An earlier message</font></td></tr></table>
<table class="message"><tr><td>
  <font size="-1">Header</font>
  <font size="-1"><p onclick="steal()">The whole message.</p><script>steal()</script><a href="javascript:steal()">bad</a><a href="https://example.com/">good</a><img src="cid:logo@example.com"><img src="data:image/png;base64,AA=="></font>
</td></tr></table>
</body></html>`;

// The link as the scrub leaves it: the view and the message, numbered.
const PRINT_ADDRESS = `${MAILBOX}/?view=lg&permmsgid=message-17`;

const mount = (on = true): MountedGmail =>
  mountGmail({
    features: [clippedMessages],
    html: clipped,
    settings: on
      ? { switches: switchesWith("loadClippedMessages") }
      : undefined,
  });

const printed = (page: MountedGmail) => {
  page.http.answer(`${MAILBOX}/?`, { status: 200, text: PRINT_VIEW });
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
    const body = document.querySelector("[data-meru-clipped]");
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
    expect(
      [...(body?.querySelectorAll("img") ?? [])].map((image) =>
        image.getAttribute("src")
      )
    ).toStrictEqual(["cid:logo@example.com", null]);
    page.app.dispose();
  });

  it.each([
    {
      answer: {
        status: 200,
        text: PRINT_VIEW,
        redirected: true,
      },
      failure: { reason: "signIn", status: null },
      what: "redirects to the sign-in page",
    },
    {
      answer: { status: 401, text: "Unauthorized" },
      failure: { reason: "status", status: 401 },
      what: "is refused",
    },
    {
      answer: { status: 200, text: "x".repeat(PRINT_VIEW_LIMIT + 1) },
      failure: { reason: "tooLarge", status: null },
      what: "runs past the limit",
    },
    {
      answer: { status: 200, text: "<p>Nothing</p>" },
      failure: { reason: "noBody", status: null },
      what: "holds no message body",
    },
  ] as const)(
    "reports a print view that $what once, as its own failure, and leaves the link",
    async ({ answer, failure }) => {
      const page = mount();
      page.http.answer(`${MAILBOX}/?`, answer);
      page.run();

      await vi.waitFor(() => {
        expect(page.bridge.sentOn(gmail.clippedFailed)).toStrictEqual([
          failure,
        ]);
      });
      expect([
        document.querySelector(".iX") !== null,
        page.bridge.sentOn(gmail.selectorMiss),
      ]).toStrictEqual([true, []]);
      page.app.dispose();
    }
  );

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
      "The print view did not load: noBody"
    );
  });
});
