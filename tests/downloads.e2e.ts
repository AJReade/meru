import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { pageOf } from "../scripts/lib/app.ts";
import { expect, inspect, must, panesOf, test } from "./app.ts";

const CONTENT = "%PDF-1.4 a report";

/** Serves one attachment on loopback, as Gmail serves a file to download. */
const startAttachment = async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Disposition": 'attachment; filename="report.pdf"',
      "Content-Length": Buffer.byteLength(CONTENT),
      "Content-Type": "application/pdf",
    });
    response.end(CONTENT);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return {
    stop: async () => {
      server.close();
      await once(server, "close");
    },
    url: `http://127.0.0.1:${port}/attachment`,
  };
};

test("saves a download into the Downloads folder, lists it in the overlay, and opens it from there", async ({
  launch,
  userData,
}) => {
  const attachment = await startAttachment();
  try {
    const { app, chrome } = await launch();
    const [pane] = await panesOf(app);
    await app.evaluate(
      ({ webContents }, [contentsId, url]) => {
        webContents.fromId(contentsId)?.downloadURL(url);
      },
      [must(pane, "The pane").contentsId, attachment.url] as const
    );
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
    await attachment.stop();
  }
});
