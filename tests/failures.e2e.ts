import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { get } from "node:http";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";

import { z } from "zod";

import { expect, test } from "./app.ts";

const root = path.join(import.meta.dirname, "..");

const rssOf = (pid: number): number =>
  Math.round(
    Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString()) /
      1024
  );

const devToolsPort = async (userData: string): Promise<string> => {
  const text = await readFile(
    path.join(userData, "DevToolsActivePort"),
    "utf-8"
  ).catch(() => "");
  const [port = ""] = text.split("\n");
  return port;
};

const targetsSchema = z.array(
  z.object({ url: z.string(), webSocketDebuggerUrl: z.string() })
);

const chromeTarget = async (port: string) => {
  const request = get(`http://127.0.0.1:${port}/json`);
  const { promise, reject, resolve } = Promise.withResolvers<IncomingMessage>();
  request.once("response", resolve).once("error", reject);
  const answer = await promise;
  let text = "";
  for await (const chunk of answer) {
    text += String(chunk);
  }
  const parsed = targetsSchema.safeParse(JSON.parse(text));
  const targets = parsed.success ? parsed.data : [];
  return targets.find(({ url }) => url.includes("/chrome.html"));
};

/** Runs `expression` in the page through the DevTools protocol without enabling its Runtime domain, so no console message is sent on to the test as Playwright's own connection sends every one. */
const evaluateIn = async (socketUrl: string, expression: string) => {
  const socket = new WebSocket(socketUrl);
  await once(socket, "open");
  const answered = once(socket, "message");
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression },
    })
  );
  await answered;
  socket.close();
};

// Playwright's own connection enables every page's Runtime domain, which carries each console message to the test through main and costs main more than the app does, so this launches Electron without it. ps reads the memory, which Windows lacks.
test.skip(process.platform === "win32", "reads main's memory through ps");

test("a page that floods its console costs main no lasting memory", async ({
  userData,
}) => {
  test.setTimeout(60_000);
  const electron: unknown = createRequire(path.join(root, "app/package.json"))(
    "electron"
  );
  if (typeof electron !== "string") {
    throw new TypeError("The electron package names no binary");
  }
  const sandbox = process.platform === "linux" ? ["--no-sandbox"] : [];
  const child = spawn(
    electron,
    [
      path.join(root, "app"),
      `--user-data-dir=${userData}`,
      "--remote-debugging-port=0",
      ...sandbox,
    ],
    {
      env: {
        ...process.env,
        MERU_BACKGROUND: "1",
        MERU_E2E: "1",
        MERU_TEST_BACKGROUND: "1",
      },
      stdio: "ignore",
    }
  );
  try {
    const { pid } = child;
    if (pid === undefined) {
      throw new Error("Electron did not start");
    }
    await expect.poll(async () => await devToolsPort(userData)).not.toBe("");
    const port = await devToolsPort(userData);
    await expect.poll(async () => await chromeTarget(port)).not.toBeUndefined();
    const chrome = await chromeTarget(port);
    // What main holds once the window has painted and settled.
    await pause(10_000);
    const before = rssOf(pid);

    await evaluateIn(
      chrome?.webSocketDebuggerUrl ?? "",
      "for (let i = 0; i < 100000; i += 1) { console.error('flood ' + i); } 1"
    );
    // The allocator gives pages back over a few seconds, so the least of a few readings is what main keeps.
    await pause(3000);
    const first = rssOf(pid);
    await pause(1000);
    const second = rssOf(pid);
    await pause(1000);
    const third = rssOf(pid);
    // A bare Electron window keeps about 2 MB of such a flood and the app about 10 more, where hearing every message kept 180.
    expect(Math.min(first, second, third) - before).toBeLessThanOrEqual(15);
    await expect
      .poll(async () => {
        const log = await readFile(
          path.join(userData, "logs", "main.log"),
          "utf-8"
        ).catch(() => "");
        return log.split("\n").filter((line) => line.includes("flood ")).length;
      })
      .toBe(20);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});
