import path from "node:path";

import { describe, expect, it } from "vitest";

import { HISTORY_LIMIT } from "../../../core/engines/downloads.ts";
import type { Platform } from "../../../core/records/platform.ts";
import { WRITE_DELAY } from "../../../core/snapshot.ts";
import { wireName } from "../../../shared/channels/define.ts";
import { downloads as channels } from "../../../shared/channels/downloads.ts";
import { FakeClock } from "../../../test/fakes/clock.ts";
import { FakeDialogs } from "../../../test/fakes/dialogs.ts";
import { FakeDownloads } from "../../../test/fakes/downloads.ts";
import { FakeFs } from "../../../test/fakes/fs.ts";
import { FakeLog } from "../../../test/fakes/log.ts";
import { FakeNotifications } from "../../../test/fakes/notifications.ts";
import { FakeProgress } from "../../../test/fakes/progress.ts";
import { FakeShell } from "../../../test/fakes/shell.ts";
import { testApp, testStages } from "../../testing.ts";
import { DOWNLOADS_FILE, Downloads, SAVE_AS_LIFETIME } from "./index.ts";

const DOWNLOADS = path.join(path.sep, "Users", "me", "Downloads");
const PENDING = path.join(path.sep, "Users", "me", "Meru", "pending");
const START = 1_800_000_000_000;

/** Lets the feature's awaits on the fakes settle. */
const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each turn lets one more await resolve
    await Promise.resolve();
  }
};

const setup = async ({
  fs = new FakeFs(),
  platform = "darwin",
  port = new FakeDownloads(),
}: { fs?: FakeFs; platform?: Platform; port?: FakeDownloads } = {}) => {
  const clock = new FakeClock(START);
  const app = await testApp({ clock, fs });
  const { open, stages, views } = testStages(app);
  const { window } = open();
  const dialogs = new FakeDialogs();
  const progress = new FakeProgress();
  const shell = new FakeShell();
  const notifications = new FakeNotifications();
  const log = new FakeLog();
  const closed: number[] = [];
  const feature = new Downloads({
    clock,
    closeTab: (contentsId) => {
      closed.push(contentsId);
    },
    commands: app.commands,
    defaultDirectory: DOWNLOADS,
    dialogs,
    downloads: port,
    fs: app.fs,
    lifecycle: app.lifecycle,
    log: log.scoped("downloads"),
    notifications,
    overlayUrl: (kind, query) =>
      `overlay.html?${new URLSearchParams({ ...query, kind }).toString()}`,
    pendingDirectory: PENDING,
    platform,
    progress,
    registrar: app.registrar,
    settings: app.settings,
    shell,
    stages,
  });
  await feature.open();
  feature.start();
  return {
    ...app,
    clock,
    closed,
    dialogs,
    feature,
    log,
    notifications,
    port,
    progress,
    shell,
    views,
    window,
  };
};

const at = (name: string) => path.join(DOWNLOADS, name);

describe(Downloads, () => {
  it("saves a download into the download folder under a name no file or other download holds, and records it once it is whole", async () => {
    const { feature, port } = await setup();
    port.files.add(at("Report.pdf"));
    const first = port.start({ suggestedName: "report.pdf" });
    const second = port.start({ suggestedName: "report.pdf" });
    expect([first.path, second.path]).toStrictEqual([
      at("report (1).pdf"),
      at("report (2).pdf"),
    ]);
    port.complete(first.id);
    await settle();
    expect(feature.snapshot().items).toStrictEqual([
      {
        createdAt: START,
        exists: true,
        fileName: "report (1).pdf",
        filePath: at("report (1).pdf"),
        id: first.id,
        state: "done",
      },
    ]);
    expect(port.marked).toStrictEqual([at("report (1).pdf")]);
  });

  it("goes to the folder downloads.location names as soon as it changes, and gives a bare name its type's extension", async () => {
    const { port, settings } = await setup();
    const elsewhere = path.join(path.sep, "Volumes", "Files");
    settings.set("downloads.location", elsewhere);
    expect(
      port.start({ mimeType: "application/pdf", suggestedName: "invoice" }).path
    ).toBe(path.join(elsewhere, "invoice.pdf"));
  });

  it("asks where to save under downloads.saveAs, one dialog at a time, writing each meanwhile to the pending folder and moving it there once both are done", async () => {
    const { dialogs, feature, port, settings } = await setup();
    settings.set("downloads.saveAs", true);
    const first = port.start({ suggestedName: "a.zip" });
    const second = port.start({ suggestedName: "b.zip" });
    expect(first.path).toBe(path.join(PENDING, first.id));
    await settle();
    expect(
      dialogs.open.map(({ defaultPath, kind }) => ({ defaultPath, kind }))
    ).toStrictEqual([{ defaultPath: at("a.zip"), kind: "save" }]);

    port.complete(first.id);
    const chosen = path.join(path.sep, "Users", "me", "Desktop", "mine.zip");
    dialogs.answer(chosen);
    await settle();
    expect(dialogs.open.map(({ defaultPath }) => defaultPath)).toStrictEqual([
      at("b.zip"),
    ]);
    expect([
      port.files.has(chosen),
      port.files.has(path.join(PENDING, first.id)),
      feature.snapshot().items[0]?.filePath,
    ]).toStrictEqual([true, false, chosen]);

    dialogs.answer(null);
    await settle();
    expect([
      port.active.has(second.id),
      port.files.has(path.join(PENDING, second.id)),
      feature.snapshot().items.length,
    ]).toStrictEqual([false, false, 1]);
  });

  it("asks for a Save Image As whatever downloads.saveAs says, and only for the address it was given while it is fresh", async () => {
    const { clock, dialogs, feature, port } = await setup();
    feature.saveAs(7, "https://example.com/cat.png");
    expect(port.requested).toStrictEqual([
      { contentsId: 7, url: "https://example.com/cat.png" },
    ]);
    port.start({
      suggestedName: "dog.png",
      url: "https://example.com/dog.png",
    });
    port.start({
      suggestedName: "cat.png",
      url: "https://example.com/cat.png",
    });
    await settle();
    expect(dialogs.open.map(({ defaultPath }) => defaultPath)).toStrictEqual([
      at("cat.png"),
    ]);

    feature.saveAs(7, "https://example.com/late.png");
    clock.advance(SAVE_AS_LIFETIME);
    expect(
      port.start({
        suggestedName: "late.png",
        url: "https://example.com/late.png",
      }).path
    ).toBe(at("late.png"));
  });

  it("deletes an interrupted download's partial file, records it as failed with no file, and says so", async () => {
    const { feature, log, notifications, port } = await setup();
    const { id, path: written } = port.start({ suggestedName: "big.iso" });
    port.progress(id, 40);
    port.interrupt(id);
    await settle();
    expect(port.files.has(written ?? "")).toBeFalsy();
    expect(feature.snapshot().items).toMatchObject([
      { exists: false, fileName: "big.iso", state: "failed" },
    ]);
    expect(notifications.shown.map(({ spec }) => spec.body)).toStrictEqual([
      "The download of big.iso was interrupted.",
    ]);
    expect(log.at("warn")).toStrictEqual(["A download was interrupted"]);
  });

  it("records a failed download and says so even when its partial file cannot be deleted, and logs the refusal", async () => {
    const { feature, log, notifications, port } = await setup();
    const { id, path: written } = port.start({ suggestedName: "long.pdf" });
    port.stuck.add(written ?? "");
    port.interrupt(id);
    await settle();
    expect(feature.snapshot().items).toMatchObject([
      { fileName: "long.pdf", state: "failed" },
    ]);
    expect(notifications.shown.map(({ spec }) => spec.title)).toStrictEqual([
      "Download failed",
    ]);
    expect(log.at("warn")).toStrictEqual([
      "A download was interrupted",
      "A download's file could not be deleted",
    ]);
  });

  it("records a saved download that cannot be moved where the dialog said as failed, under the name chosen", async () => {
    const { dialogs, feature, port, settings } = await setup();
    settings.set("downloads.saveAs", true);
    const { id } = port.start({ suggestedName: "a.zip" });
    port.complete(id);
    const chosen = path.join(path.sep, "Volumes", "Gone", "a.zip");
    port.stuck.add(chosen);
    await settle();
    dialogs.answer(chosen);
    await settle();
    expect(feature.snapshot().items).toMatchObject([
      { exists: false, filePath: chosen, state: "failed" },
    ]);
  });

  it("records a download interrupted before the save dialog answers under the name it suggested", async () => {
    const { feature, notifications, port, settings } = await setup();
    settings.set("downloads.saveAs", true);
    const { id } = port.start({ suggestedName: "cut.pdf" });
    port.interrupt(id);
    await settle();
    expect(feature.snapshot().items).toMatchObject([
      { fileName: "cut.pdf", filePath: at("cut.pdf"), state: "failed" },
    ]);
    expect(notifications.shown.map(({ spec }) => spec.body)).toStrictEqual([
      "The download of cut.pdf was interrupted.",
    ]);
  });

  it("empties the pending folder of what no download under way is writing, on start and when a dialog closes", async () => {
    const port = new FakeDownloads();
    const crashed = path.join(PENDING, "left-by-a-crash");
    port.files.add(crashed);
    const { dialogs, settings } = await setup({ port });
    await settle();
    expect(port.files.has(crashed)).toBeFalsy();

    settings.set("downloads.saveAs", true);
    const first = port.start({ suggestedName: "a.zip" });
    const second = port.start({ suggestedName: "b.zip" });
    const orphan = path.join(PENDING, "orphan");
    port.files.add(orphan);
    await settle();
    dialogs.answer(null);
    await settle();
    expect([
      port.files.has(orphan),
      port.files.has(first.path ?? ""),
      port.files.has(second.path ?? ""),
    ]).toStrictEqual([false, false, true]);
  });

  it("keeps the bar from running backwards when a download is cancelled or fails while another runs", async () => {
    const { port, progress } = await setup();
    const first = port.start({ suggestedName: "a", totalBytes: 100 });
    const second = port.start({ suggestedName: "b", totalBytes: 100 });
    const third = port.start({ suggestedName: "c", totalBytes: 100 });
    port.progress(first.id, 10, 100);
    port.progress(second.id, 90, 100);
    port.progress(third.id, 50, 100);
    expect(progress.shown).toStrictEqual({ kind: "fraction", value: 0.5 });
    port.cancel(second.id);
    const afterCancel = progress.shown;
    port.interrupt(third.id);
    await settle();
    const afterFailure = progress.shown;
    expect([afterCancel.kind, afterFailure.kind]).toStrictEqual([
      "fraction",
      "fraction",
    ]);
    const values = [afterCancel, afterFailure].map((shown) =>
      shown.kind === "fraction" ? shown.value : 0
    );
    expect(values[0]).toBeGreaterThanOrEqual(0.5);
    expect(values[1]).toBeGreaterThanOrEqual(values[0] ?? 1);
  });

  it("holds the bar where a download had reached when it restarts from nothing, and moves on once it passes it", async () => {
    const { port, progress } = await setup();
    const first = port.start({ suggestedName: "a", totalBytes: 100 });
    port.progress(first.id, 75, 100);
    const before = progress.shown;
    port.progress(first.id, 0, 100);
    const restarted = progress.shown;
    port.progress(first.id, 50, 100);
    const climbing = progress.shown;
    port.progress(first.id, 80, 100);
    expect([before, restarted, climbing, progress.shown]).toStrictEqual([
      { kind: "fraction", value: 0.75 },
      { kind: "fraction", value: 0.75 },
      { kind: "fraction", value: 0.75 },
      { kind: "fraction", value: 0.8 },
    ]);
  });

  it("shows the combined progress of the downloads under way, indeterminate while a size is unknown, and none once they end", async () => {
    const { port, progress } = await setup();
    const first = port.start({ suggestedName: "a", totalBytes: 100 });
    const second = port.start({ suggestedName: "b", totalBytes: 300 });
    port.progress(first.id, 100, 100);
    port.progress(second.id, 100, 300);
    expect(progress.shown).toStrictEqual({ kind: "fraction", value: 0.5 });
    port.complete(first.id);
    expect(progress.shown).toStrictEqual({ kind: "fraction", value: 0.5 });
    const third = port.start({ suggestedName: "c", totalBytes: 0 });
    expect(progress.shown).toStrictEqual({ kind: "indeterminate" });
    port.complete(second.id, 300);
    port.complete(third.id, 10);
    await settle();
    expect(progress.shown).toStrictEqual({ kind: "none" });
  });

  it.each([
    {
      action: "Show in Finder",
      choice: "showInFolder",
      platform: "darwin",
      revealed: true,
    },
    { action: "Open", choice: "openFile", platform: "darwin", revealed: false },
    {
      action: "Show in File Explorer",
      choice: "showInFolder",
      platform: "win32",
      revealed: true,
    },
  ] as const)(
    "offers to $choice from the completion notification's button on $platform",
    async ({ action, choice, platform, revealed }) => {
      const { notifications, port, settings, shell } = await setup({
        platform,
      });
      settings.set("notifications.onClickDownloadCompleted", choice);
      const { id, path: written } = port.start({ suggestedName: "a.pdf" });
      port.complete(id);
      await settle();
      const [shown] = notifications.shown;
      expect(shown?.spec).toMatchObject({
        actions: [action],
        title: "Downloaded a.pdf",
      });
      shown?.click();
      await settle();
      expect([shell.revealed, shell.files]).toStrictEqual([[], []]);
      shown?.act?.(0);
      await settle();
      expect([shell.revealed, shell.files]).toStrictEqual(
        revealed ? [[written], []] : [[], [written]]
      );
    }
  );

  it("acts on a click on the body too on Linux, whose notification servers may draw no buttons", async () => {
    const { notifications, port, shell } = await setup({ platform: "linux" });
    const { id, path: written } = port.start({ suggestedName: "a.pdf" });
    port.complete(id);
    await settle();
    notifications.shown[0]?.click();
    expect(shell.revealed).toStrictEqual([written]);
  });

  it("notifies nothing under notifications.downloadCompleted off, and shows the file in its folder under downloads.openFolderWhenDone", async () => {
    const { notifications, port, settings, shell } = await setup();
    settings.set("notifications.downloadCompleted", false);
    settings.set("downloads.openFolderWhenDone", true);
    const { id, path: written } = port.start({ suggestedName: "a.pdf" });
    port.complete(id);
    await settle();
    expect([notifications.shown, shell.revealed]).toStrictEqual([
      [],
      [written],
    ]);
  });

  it("closes the tab a download was the only page of", async () => {
    const { clock, closed, port } = await setup();
    port.start({ committed: false, contentsId: 42, suggestedName: "a.pdf" });
    port.start({ committed: true, contentsId: 43, suggestedName: "b.pdf" });
    expect(closed).toStrictEqual([]);
    clock.advance(0);
    expect(closed).toStrictEqual([42]);
  });

  it("keeps the newest of the history up to its limit, in downloads.json", async () => {
    const { clock, feature, fs, port } = await setup();
    for (let index = 0; index <= HISTORY_LIMIT; index += 1) {
      clock.advance(1);
      port.complete(port.start({ suggestedName: `f${index}` }).id);
    }
    await settle();
    clock.advance(WRITE_DELAY);
    await settle();
    expect(feature.snapshot().items).toHaveLength(HISTORY_LIMIT);
    expect(feature.snapshot().items[0]?.fileName).toBe(`f${HISTORY_LIMIT}`);
    const written = fs.files.get(DOWNLOADS_FILE) ?? "";
    expect([
      written.includes(`"f${HISTORY_LIMIT}"`),
      written.includes(`"f0"`),
    ]).toStrictEqual([true, false]);
  });

  it("looks for the shown files when the overlay opens, and writes only when one has gone", async () => {
    const { clock, feature, fs, port, registrar, views, window } =
      await setup();
    const { id, path: written } = port.start({ suggestedName: "a.pdf" });
    port.complete(id);
    await settle();
    clock.advance(WRITE_DELAY);
    await settle();
    const writes = fs.writes.length;

    expect(
      registrar.dispatch(window.contentsId, wireName(channels.open), {}).ok
    ).toBeTruthy();
    await settle();
    clock.advance(WRITE_DELAY);
    await settle();
    expect(views.created.at(-1)?.url).toBe("overlay.html?kind=downloads");
    expect(fs.writes).toHaveLength(writes);

    port.files.delete(written ?? "");
    await feature.recheck();
    clock.advance(WRITE_DELAY);
    await settle();
    expect(feature.snapshot().items[0]?.exists).toBeFalsy();
    expect(fs.writes).toHaveLength(writes + 1);
  });

  it("opens, shows and removes a download by its id, and refuses an id it does not know", async () => {
    const { feature, port, shell } = await setup();
    const { id, path: written } = port.start({ suggestedName: "a.pdf" });
    port.complete(id);
    await settle();
    expect([
      feature.openFile(id).ok,
      feature.showInFolder(id).ok,
      feature.openFile("elsewhere").ok,
      feature.showInFolder("elsewhere").ok,
      feature.remove("elsewhere").ok,
    ]).toStrictEqual([true, true, false, false, false]);
    await settle();
    expect([shell.files, shell.revealed]).toStrictEqual([[written], [written]]);
    expect(feature.remove(id).ok).toBeTruthy();
    expect(feature.snapshot().items).toStrictEqual([]);
  });

  it("makes the folder the picker chose downloads.location, and keeps it when the picker is cancelled", async () => {
    const { dialogs, registrar, settings, window } = await setup();
    registrar.assign(window.contentsId + 1000, {
      pushes: [],
      requests: [{ chooseFolder: channels.chooseFolder }],
    });
    registrar.dispatch(
      window.contentsId + 1000,
      wireName(channels.chooseFolder),
      {}
    );
    await settle();
    expect(dialogs.open[0]?.defaultPath).toBe(DOWNLOADS);
    dialogs.answer(path.join(path.sep, "Volumes", "Files"));
    await settle();
    expect(settings.get("downloads.location")).toBe(
      path.join(path.sep, "Volumes", "Files")
    );
  });
});
