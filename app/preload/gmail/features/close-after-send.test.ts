import { describe, expect, it } from "vitest";

import { gmail, gmailPushes } from "../../../shared/channels/gmail.ts";
import { mountGmail, switchesWith } from "../testing.ts";
import { closeAfterSend } from "./close-after-send.ts";
import messageSent from "./fixtures/message-sent.html?raw";

describe(closeAfterSend.id, () => {
  it("tells main once that Gmail sent the message, and clicks Gmail's Undo when main asks", () => {
    const page = mountGmail({
      features: [closeAfterSend],
      html: messageSent,
      settings: { switches: switchesWith("closeComposeWindowAfterSend") },
    });
    page.run();
    page.run();
    let undone = 0;
    document.querySelector("#link_undo")?.addEventListener("click", () => {
      undone += 1;
    });

    page.bridge.push(gmailPushes.undoSend, {});

    expect(page.bridge.sentOn(gmail.messageSent)).toStrictEqual([{}]);
    expect(undone).toBe(1);
    page.app.dispose();
  });

  it("says nothing of an Undo that follows anything but a send, or while it is off", () => {
    const page = mountGmail({
      features: [closeAfterSend],
      html: messageSent.replace('id="link_vsm"', ""),
      settings: { switches: switchesWith("closeComposeWindowAfterSend") },
    });
    page.run();
    expect(page.bridge.sentOn(gmail.messageSent)).toStrictEqual([]);
    page.app.dispose();

    const off = mountGmail({ features: [closeAfterSend], html: messageSent });
    off.run();
    expect(off.bridge.sentOn(gmail.messageSent)).toStrictEqual([]);
    off.app.dispose();
  });
});
