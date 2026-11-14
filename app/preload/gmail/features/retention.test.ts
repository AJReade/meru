import { setTimeout as pause } from "node:timers/promises";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { mountGmail, switchesWith } from "../testing.ts";
import { attachmentsToTop } from "./attachments-to-top.ts";
import { popOuts } from "./pop-outs.ts";

// Node gives a test no collector to call unless one is exposed, which a fresh context can take after the flag is set.
setFlagsFromString("--expose-gc");
const collector: unknown = runInNewContext("gc");
const isCollector = (value: unknown): value is () => void =>
  typeof value === "function";

const MESSAGE = `<div class="a3s">${"y".repeat(10_000)}</div><div class="hq gt"><span download_url="application/pdf:a.pdf:about:blank">a.pdf</span></div><div class="amn"><span class="ams" role="link">Reply</span><span class="ams" role="link">Forward</span></div>`;

const CHURNS = 150;

describe("the Gmail features' undo", () => {
  it(`holds none of ${CHURNS} messages Gmail took away, and still undoes one that stays`, async () => {
    if (!isCollector(collector)) {
      throw new TypeError("Node exposed no collector");
    }
    const page = mountGmail({
      features: [attachmentsToTop, popOuts],
      html: '<div role="main" id="main"></div>',
      settings: {
        switches: switchesWith("moveAttachmentsToTop", "replyForwardInPopOut"),
      },
    });
    page.run();
    const main = document.querySelector("#main");
    const gone: WeakRef<Element>[] = [];
    for (let churn = 0; churn < CHURNS; churn += 1) {
      const message = document.createElement("div");
      message.className = "gs";
      message.innerHTML = MESSAGE;
      main?.append(message);
      // oxlint-disable-next-line no-await-in-loop -- each message is handled before Gmail takes it away
      await page.settle();
      expect(message.firstElementChild?.className).toBe("hq gt");
      message.remove();
      gone.push(new WeakRef(message));
    }
    const kept = document.createElement("div");
    kept.className = "gs";
    kept.innerHTML = MESSAGE;
    main?.append(kept);
    await page.settle();

    for (let round = 0; round < 3; round += 1) {
      collector();
      // oxlint-disable-next-line no-await-in-loop -- a weak reference clears only after the task that collected
      await pause(0);
    }

    // happy-dom keeps the message taken away last for as long as its last mutation record stands, whatever the features hold.
    expect(
      gone.flatMap((message, index) =>
        message.deref() === undefined || index === CHURNS - 1 ? [] : [index]
      )
    ).toStrictEqual([]);
    page.change({ switches: switchesWith() });
    expect([
      kept.firstElementChild?.className,
      kept.querySelectorAll("[data-meru-shift-click], .meru-attachments-rule")
        .length,
    ]).toStrictEqual(["a3s", 0]);
    page.app.dispose();
  });
});
