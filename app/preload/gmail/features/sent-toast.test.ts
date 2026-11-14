import { describe, expect, it, vi } from "vitest";

import { gmail, gmailPushes } from "../../../shared/channels/gmail.ts";
import { mountGmail } from "../testing.ts";
import { sentToast } from "./sent-toast.ts";

const toaster = () => document.querySelector("#meru-toaster")?.shadowRoot;

describe(sentToast.id, () => {
  it("shows the toast main asks for in a shadow root, as a status, whose Undo answers with its id and takes it down", async () => {
    const page = mountGmail({ features: [sentToast] });

    expect(toaster()).toBeUndefined();

    page.bridge.push(gmailPushes.showSentToast, { id: 7 });

    const column = toaster()?.querySelector(".toaster");
    expect(column?.getAttribute("role")).toBe("status");
    expect(column?.querySelector(".toast-title")?.textContent).toBe(
      "Message sent."
    );
    const undo = column?.querySelector(".toast-action");
    expect(undo?.textContent).toBe("Undo");
    undo?.dispatchEvent(new MouseEvent("click"));

    expect(page.bridge.sentOn(gmail.undoSend)).toStrictEqual([{ id: 7 }]);
    await vi.waitFor(() => {
      expect(column?.querySelector(".toast")).toBeNull();
    });
    page.app.dispose();
  });

  it("takes the toast down when main says so, and keeps one of each id", async () => {
    const page = mountGmail({ features: [sentToast] });
    for (const id of [1, 1]) {
      page.bridge.push(gmailPushes.showSentToast, { id });
    }

    expect(toaster()?.querySelectorAll(".toast")).toHaveLength(1);

    page.bridge.push(gmailPushes.dismissSentToast, { id: 1 });

    await vi.waitFor(() => {
      expect(toaster()?.querySelectorAll(".toast")).toHaveLength(0);
    });
    expect(page.bridge.sentOn(gmail.undoSend)).toStrictEqual([]);
    page.app.dispose();
  });
});
