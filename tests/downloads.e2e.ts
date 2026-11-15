import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import type { ElectronApplication } from "@playwright/test";

import { downloads } from "../app/shared/channels/downloads.ts";
import { invokeIn, pageOf, sendIn } from "../scripts/lib/app.ts";
import { expect, inspect, must, panesOf, test } from "./app.ts";

const CONTENT = "%PDF-1.4 a report";

/** Serves attachments on loopback, as Gmail serves a file to download: `/attachment` whole, `/cut` stopping a tenth of the way in, as a dropped connection does, and `/slow` sending a tenth and then nothing, so the download stays under way until it is called off. */
const startAttachments = async () => {
  const server = createServer((request, response) => {
    const slow = request.url === "/slow";
    const cut = request.url === "/cut";
    const name = (slow && "slow") || (cut && "cut") || "report";
    response.writeHead(200, {
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Content-Length": cut || slow ? 1000 : Buffer.byteLength(CONTENT),
      "Content-Type": "application/pdf",
    });
    if (slow) {
      response.write(Buffer.alloc(100));
    } else if (cut) {
      response.write(Buffer.alloc(100));
      setTimeout(() => {
        response.socket?.destroy();
      }, 300);
    } else {
      response.end(CONTENT);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return {
    stop: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
    url: (route: "attachment" | "cut" | "slow") =>
      `http://127.0.0.1:${port}/${route}`,
  };
};

const download = async (app: ElectronApplication, url: string) => {
  const [pane] = await panesOf(app);
  await app.evaluate(
    ({ webContents }, [contentsId, address]) => {
      webContents.fromId(contentsId)?.downloadURL(address);
    },
    [must(pane, "The pane").contentsId, url] as const
  );
};

test("saves a download into the Downloads folder, lists it in the overlay, and opens it from there", async ({
  launch,
  userData,
}) => {
  const attachments = await startAttachments();
  try {
    const { app, chrome } = await launch();
    await download(app, attachments.url("attachment"));
    const saved = path.join(userData, "Downloads", "report.pdf");
    await expect
      .poll(async () => await readFile(saved, "utf-8").catch(() => ""))
      .toBe(CONTENT);
    await expect
      .poll(async () => {
        const { progress } = await inspect(app);
        return progress;
      })
      .toStrictEqual({ kind: "none" });

    await chrome.locator("[data-downloads-button]").click();
    const overlay = await pageOf(app, "kind=downloads");
    const row = overlay.locator("[data-download-id] button").first();
    await expect(row).toContainText("report.pdf");
    await row.click();
    await expect
      .poll(async () => {
        const { files } = await inspect(app);
        return files;
      })
      .toStrictEqual([saved]);
  } finally {
    await attachments.stop();
  }
});

test("lists a download under way with its progress and calls it off from the overlay", async ({
  launch,
  userData,
}) => {
  const attachments = await startAttachments();
  try {
    const { app, chrome } = await launch();
    await download(app, attachments.url("slow"));
    await sendIn(chrome, downloads.open, {});
    const overlay = await pageOf(app, "kind=downloads");
    const row = overlay.locator("[data-active-id]");
    await expect(row).toContainText("slow.pdf");
    await expect(row.locator("progress")).toHaveCount(1);
    await row.getByRole("button", { name: "Cancel download" }).click();
    await expect
      .poll(async () => {
        const answer = await invokeIn(overlay, downloads.snapshot, {});
        return answer.ok ? answer.value : answer;
      })
      .toMatchObject({
        active: [],
        items: [{ exists: false, fileName: "slow.pdf", state: "cancelled" }],
      });
    await expect
      .poll(async () => await readdir(path.join(userData, "Downloads")))
      .toStrictEqual([]);
  } finally {
    await attachments.stop();
  }
});

// Chromium quarantines a download in-process only on Windows and leaves it to the embedder elsewhere, which Electron does not do.
test("quarantines a finished download for Gatekeeper on macOS", async ({
  launch,
  userData,
}) => {
  test.skip(process.platform !== "darwin", "quarantine is macOS's");
  const attachments = await startAttachments();
  try {
    const { app } = await launch();
    await download(app, attachments.url("attachment"));
    const saved = path.join(userData, "Downloads", "report.pdf");
    const quarantine = () => {
      try {
        return execFileSync(
          "/usr/bin/xattr",
          ["-p", "com.apple.quarantine", saved],
          { stdio: ["ignore", "pipe", "ignore"] }
        ).toString();
      } catch {
        return "";
      }
    };
    await expect.poll(quarantine).toMatch(/^0081;[0-9a-f]+;Meru;/u);
  } finally {
    await attachments.stop();
  }
});

test("records a download the network cuts as failed and deletes what it wrote, whatever the stack it was cancelled from", async ({
  launch,
  userData,
}) => {
  const attachments = await startAttachments();
  try {
    const { app, chrome } = await launch();
    await download(app, attachments.url("cut"));
    await expect
      .poll(async () => {
        const { notifications } = await inspect(app);
        return notifications.map(({ title }) => title);
      })
      .toStrictEqual(["Download failed"]);
    await sendIn(chrome, downloads.open, {});
    const overlay = await pageOf(app, "kind=downloads");
    const answer = await invokeIn(overlay, downloads.snapshot, {});
    expect(answer.ok ? answer.value.items : answer).toMatchObject([
      { exists: false, fileName: "cut.pdf", state: "failed" },
    ]);
    await expect
      .poll(async () => await readdir(path.join(userData, "Downloads")))
      .toStrictEqual([]);
  } finally {
    await attachments.stop();
  }
});

test("keeps a Save As download the disk will not move where it was saved in the Downloads folder, where clearing the list and a relaunch leave it", async ({
  launch,
  userData,
}) => {
  const attachments = await startAttachments();
  // A folder where the file should go, which a rename refuses to replace.
  const chosen = path.join(userData, "Chosen", "report.pdf");
  await mkdir(chosen, { recursive: true });
  const kept = path.join(userData, "Downloads", "report.pdf");
  try {
    const first = await launch({
      settings: { global: { "downloads.saveAs": true }, profiles: {} },
    });
    await first.app.evaluate(({ dialog }, target) => {
      Object.defineProperty(dialog, "showSaveDialog", {
        configurable: true,
        value: async () => {
          await Promise.resolve();
          return { canceled: false, filePath: target };
        },
      });
    }, chosen);
    await download(first.app, attachments.url("attachment"));
    await expect
      .poll(async () => {
        const { notifications } = await inspect(first.app);
        return notifications.map(({ title }) => title);
      })
      .toStrictEqual(["Download not moved"]);
    await sendIn(first.chrome, downloads.open, {});
    const overlay = await pageOf(first.app, "kind=downloads");
    const answer = await invokeIn(overlay, downloads.snapshot, {});
    expect(answer.ok ? answer.value.items : answer).toMatchObject([
      { exists: true, fileName: "report.pdf", filePath: kept, state: "done" },
    ]);
    await invokeIn(overlay, downloads.clear, {});
    await first.close();

    await launch();
    const pending = path.join(userData, "Downloads in progress");
    await expect.poll(async () => await readdir(pending)).toStrictEqual([]);
    expect(await readFile(kept, "utf-8")).toBe(CONTENT);
  } finally {
    await attachments.stop();
  }
});

test("empties the pending folder of what an earlier run left in it", async ({
  launch,
  userData,
}) => {
  const pending = path.join(userData, "Downloads in progress");
  await mkdir(pending, { recursive: true });
  await writeFile(path.join(pending, "left-by-a-crash"), "partial");
  await launch();
  await expect.poll(async () => await readdir(pending)).toStrictEqual([]);
});
