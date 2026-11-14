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

/** Serves attachments on loopback, as Gmail serves a file to download: `/attachment` whole, and `/cut` stopping a tenth of the way in, as a dropped connection does. */
const startAttachments = async () => {
  const server = createServer((request, response) => {
    const cut = request.url === "/cut";
    response.writeHead(200, {
      "Content-Disposition": `attachment; filename="${cut ? "cut" : "report"}.pdf"`,
      "Content-Length": cut ? 1000 : Buffer.byteLength(CONTENT),
      "Content-Type": "application/pdf",
    });
    if (cut) {
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
    url: (route: "attachment" | "cut") => `http://127.0.0.1:${port}/${route}`,
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
