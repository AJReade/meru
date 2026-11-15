import { describe, expect, it } from "vitest";

import type { Entitlement } from "../../../core/records/entitlement.ts";
import { wireName } from "../../../shared/channels/define.ts";
import {
  gmail,
  gmailPushes,
  userStyles,
  userStylesPushes,
} from "../../../shared/channels/gmail.ts";
import {
  gmailSurface,
  settingsSurface,
} from "../../../shared/channels/surfaces.ts";
import { FakeLog } from "../../../test/fakes/log.ts";
import { FakeOnline } from "../../../test/fakes/online.ts";
import { FakePopOutWindow } from "../../../test/fakes/pop-out-window.ts";
import { FakePower } from "../../../test/fakes/power.ts";
import { FakeShell } from "../../../test/fakes/shell.ts";
import { unwrap } from "../../../test/result.ts";
import { PRO, testApp } from "../../testing.ts";
import {
  ACT_TIMEOUT,
  Gmail,
  NAVIGATE_TIMEOUT,
  NUDGE_MAX_WAIT,
  REFRESH_INTERVAL,
  SENT_UNDO_WINDOW,
  UNREAD_SETTLE,
  USER_STYLES_FILE,
  USER_STYLES_LIMIT,
  USER_STYLES_SETTLE,
  WAKE_TIMEOUT,
} from "./index.ts";

const FREE: Entitlement = { expiresAt: null, kind: "free", source: "stored" };
const MAILBOX = "https://mail.google.com/mail/u/0";
const PAGE = 41;

const setup = async (given: Entitlement = PRO) => {
  let entitlement = given;
  const app = await testApp({ entitlement: () => entitlement });
  const log = new FakeLog();
  const shell = new FakeShell();
  const woken: string[] = [];
  const opened: { profileId: string; hash: string }[] = [];
  const read: string[] = [];
  const online = new FakeOnline();
  const power = new FakePower();
  const feature = new Gmail({
    clock: app.clock,
    commands: app.commands,
    entitlement: () => entitlement,
    events: app.events,
    fs: app.fs,
    favicons: "https://www.google.com/s2/favicons",
    log: log.scoped("gmail"),
    mailbox: MAILBOX,
    online,
    power,
    readFeed: (profileId) => {
      read.push(profileId);
    },
    openMailbox: (profileId, hash) => {
      opened.push({ hash, profileId });
    },
    preload: "/dist/preload/gmail.cjs",
    profiles: app.profiles,
    registrar: app.registrar,
    settings: app.settings,
    shell,
    signIn: "https://accounts.google.com/",
    userStylesPath: `/user-data/${USER_STYLES_FILE}`,
    wake: (tabId) => {
      woken.push(tabId);
    },
  });
  await feature.start();
  const [tab] = app.profiles.snapshot().tabs;
  if (tab === undefined) {
    throw new Error("A first launch has a Gmail tab");
  }
  const detach = feature.page(tab).attach(PAGE);
  const request = (channel: Parameters<typeof wireName>[0], payload = {}) =>
    app.registrar.dispatch(PAGE, wireName(channel), payload);
  const pushed = (channel: Parameters<typeof wireName>[0]) =>
    app.transport.sent
      .filter((sent) => sent.channel === wireName(channel))
      .map((sent) => sent.payload);
  const entitle = (next: Entitlement) => {
    entitlement = next;
    app.events.emit("entitlement.changed", { entitlement: next });
  };
  return {
    app,
    detach,
    entitle,
    feature,
    log,
    online,
    opened,
    power,
    pushed,
    read,
    request,
    shell,
    tab,
    woken,
  };
};

describe(Gmail, () => {
  it("gives a Gmail page its preload on the Gmail surface", async () => {
    const { feature, tab } = await setup();
    expect(feature.page(tab)).toMatchObject({
      arguments: ["--meru-surface=gmail"],
      preload: "/dist/preload/gmail.cjs",
    });
  });

  it("answers the first read with the settings and pushes each change under a new version", async () => {
    const { app, pushed, request } = await setup();
    const first = unwrap(request(gmail.settings));
    expect(first).toMatchObject({
      mailbox: MAILBOX,
      styles: { hideGmailLogo: true, reverseConversation: false },
      version: 0,
    });
    unwrap(app.settings.set("gmail.reverseConversation", true));
    expect(pushed(gmailPushes.settingsChanged)).toMatchObject([
      { styles: { reverseConversation: true }, version: 1 },
    ]);
    unwrap(app.settings.set("stage.zoom", 1.1));
    expect(pushed(gmailPushes.settingsChanged)).toHaveLength(1);
  });

  it("carries the user's styles while Pro allows them, and follows the file", async () => {
    const { app, entitle, pushed, request } = await setup();
    app.fs.edit(USER_STYLES_FILE, "a { color: red }");
    app.clock.advance(USER_STYLES_SETTLE);
    await expect
      .poll(() => pushed(gmailPushes.settingsChanged).at(-1))
      .toMatchObject({ userStyles: "a { color: red }" });
    entitle(FREE);
    expect(pushed(gmailPushes.settingsChanged).at(-1)).toMatchObject({
      userStyles: "",
    });
    expect(unwrap(request(gmail.settings))).toMatchObject({ userStyles: "" });
  });

  it("reads the user styles once an editor's writes have settled, and pushes them only when their text changed", async () => {
    const { app, pushed } = await setup();
    app.fs.edit(USER_STYLES_FILE, "a {");
    app.clock.advance(50);
    app.fs.edit(USER_STYLES_FILE, "a { color: red }");
    app.clock.advance(USER_STYLES_SETTLE);
    await expect
      .poll(() => pushed(gmailPushes.settingsChanged))
      .toMatchObject([{ userStyles: "a { color: red }" }]);

    app.fs.edit(USER_STYLES_FILE, "a { color: red }");
    app.clock.advance(USER_STYLES_SETTLE);
    await Promise.resolve();
    await Promise.resolve();
    expect(pushed(gmailPushes.settingsChanged)).toHaveLength(1);
  });

  it("refuses user styles past the limit with one warning, and says so to the settings page", async () => {
    const { app, log, pushed } = await setup();
    const SETTINGS_PAGE = 77;
    app.registrar.assign(SETTINGS_PAGE, settingsSurface);
    const state = () =>
      unwrap(
        app.registrar.dispatch(SETTINGS_PAGE, wireName(userStyles.snapshot), {})
      );
    app.fs.edit(USER_STYLES_FILE, "a { color: red }");
    app.clock.advance(USER_STYLES_SETTLE);
    await expect
      .poll(() => pushed(gmailPushes.settingsChanged))
      .toHaveLength(1);

    const big = "x".repeat(USER_STYLES_LIMIT + 1);
    app.fs.edit(USER_STYLES_FILE, big);
    app.clock.advance(USER_STYLES_SETTLE);
    await expect
      .poll(() => pushed(userStylesPushes.changed))
      .toStrictEqual([
        {
          refusal: null,
          tooLarge: { bytes: big.length, limit: USER_STYLES_LIMIT },
        },
      ]);
    expect(pushed(gmailPushes.settingsChanged).at(-1)).toMatchObject({
      userStyles: "",
    });
    app.fs.edit(USER_STYLES_FILE, `${big}y`);
    app.clock.advance(USER_STYLES_SETTLE);
    await expect
      .poll(state)
      .toMatchObject({ tooLarge: { bytes: big.length + 1 } });
    expect(log.at("warn")).toStrictEqual([
      "The Gmail user styles are too large to apply",
    ]);
  });

  it("marks the sender's profile as needing to sign in, whatever profile the payload names", async () => {
    const { app, request, tab } = await setup();
    unwrap(request(gmail.needsSignIn, { profileId: "someone-else" }));
    expect(app.profiles.snapshot().profiles[0]).toMatchObject({
      id: tab.profileId,
      status: { kind: "needsSignIn" },
    });
  });

  it("writes an error for a failure the page's preload reports", async () => {
    const { log, request } = await setup();
    unwrap(
      request(gmail.failed, { message: "boom", what: "feature labelColors" })
    );
    expect(log.at("error")).toStrictEqual(["A Gmail page's preload failed"]);
  });

  it("writes a warning for each selector a page reports missing", async () => {
    const { log, request } = await setup();
    unwrap(request(gmail.selectorMiss, { selector: "conversation" }));
    expect(log.at("warn")).toStrictEqual(["A Gmail selector found nothing"]);
  });

  it("takes a tab's page to a mailbox address by its fragment once the page says it moved", async () => {
    const { feature, pushed, request, tab } = await setup();
    const moved = feature.navigate(tab.id, `${MAILBOX}/#inbox/FMfcg`);
    expect(pushed(gmailPushes.navigate)).toStrictEqual([
      { hash: "#inbox/FMfcg", id: 0 },
    ]);
    unwrap(request(gmail.navigated, { id: 0, navigated: true }));
    await expect(moved).resolves.toBeTruthy();
  });

  it("leaves the address to the caller when the page is off the mailbox, does not answer, or there is none", async () => {
    const { app, detach, feature, request, tab } = await setup();
    const offMailbox = feature.navigate(tab.id, `${MAILBOX}/#inbox/FMfcg`);
    unwrap(request(gmail.navigated, { id: 0, navigated: false }));
    await expect(offMailbox).resolves.toBeFalsy();

    const silent = feature.navigate(tab.id, `${MAILBOX}/#inbox/FMfcg`);
    app.clock.advance(NAVIGATE_TIMEOUT);
    await expect(silent).resolves.toBeFalsy();

    await expect(
      feature.navigate(tab.id, "https://example.com/#inbox")
    ).resolves.toBeFalsy();
    await expect(feature.navigate(tab.id, `${MAILBOX}/`)).resolves.toBeFalsy();
    detach();
    await expect(
      feature.navigate(tab.id, `${MAILBOX}/#inbox/FMfcg`)
    ).resolves.toBeFalsy();
  });

  it("hears a navigation's answer only from the page it was sent to", async () => {
    const { app, feature, tab } = await setup();
    const moved = feature.navigate(tab.id, `${MAILBOX}/#inbox/FMfcg`);
    const OTHER = 42;
    app.registrar.assign(OTHER, gmailSurface, tab.profileId);
    unwrap(
      app.registrar.dispatch(OTHER, wireName(gmail.navigated), {
        id: 0,
        navigated: true,
      })
    );
    app.clock.advance(NAVIGATE_TIMEOUT);
    await expect(moved).resolves.toBeFalsy();
  });

  it("asks the tab's page to act on a message and answers what Gmail did with it", async () => {
    const { feature, pushed, request, tab, woken } = await setup();
    const acted = feature.act(tab.id, "FMfcg", "archive");
    expect(pushed(gmailPushes.mailAction)).toStrictEqual([
      { action: "archive", id: 0, messageId: "FMfcg" },
    ]);
    expect(woken).toStrictEqual([]);
    unwrap(request(gmail.mailActed, { acted: true, id: 0 }));
    await expect(acted).resolves.toStrictEqual({ ok: true, value: undefined });

    const refused = feature.act(tab.id, "FMfcg", "markRead");
    unwrap(request(gmail.mailActed, { acted: false, id: 1 }));
    await expect(refused).resolves.toStrictEqual({
      error: "refused",
      ok: false,
    });
  });

  it("refreshes the profile's page after an action Gmail took, and not after one it refused", async () => {
    const { app, feature, pushed, request, tab } = await setup();
    const refused = feature.act(tab.id, "FMfcg", "archive");
    unwrap(request(gmail.mailActed, { acted: false, id: 0 }));
    await refused;
    expect(pushed(gmailPushes.refresh)).toStrictEqual([]);

    const acted = feature.act(tab.id, "FMfcg", "archive");
    unwrap(request(gmail.mailActed, { acted: true, id: 1 }));
    await acted;
    expect(pushed(gmailPushes.refresh)).toStrictEqual([{}]);

    // A second action in quick succession is covered by the first refresh.
    app.clock.advance(REFRESH_INTERVAL - 1);
    const again = feature.act(tab.id, "FMfcg", "markRead");
    unwrap(request(gmail.mailActed, { acted: true, id: 2 }));
    await again;
    expect(pushed(gmailPushes.refresh)).toHaveLength(1);
  });

  it("refreshes the profile's page when its feed has new mail, on resume and when the network returns, at most once an interval", async () => {
    const { app, online, power, pushed, tab } = await setup();
    app.events.emit("mail.arrived", { entries: [], profileId: "elsewhere" });
    expect(pushed(gmailPushes.refresh)).toStrictEqual([]);

    app.events.emit("mail.arrived", { entries: [], profileId: tab.profileId });
    power.resume();
    expect(pushed(gmailPushes.refresh)).toHaveLength(1);

    app.clock.advance(REFRESH_INTERVAL);
    power.resume();
    app.clock.advance(REFRESH_INTERVAL);
    online.set(false);
    expect(pushed(gmailPushes.refresh)).toHaveLength(2);
    online.set(true);
    expect(pushed(gmailPushes.refresh)).toHaveLength(3);
  });

  it("reads the profile's feed once the count its page shows stops changing", async () => {
    const { app, read, request, tab } = await setup();
    unwrap(request(gmail.unreadChanged));
    app.clock.advance(UNREAD_SETTLE - 1);
    unwrap(request(gmail.unreadChanged));
    app.clock.advance(UNREAD_SETTLE - 1);
    expect(read).toStrictEqual([]);
    app.clock.advance(1);
    expect(read).toStrictEqual([tab.profileId]);
  });

  it("reads the profile's feed once, no later than the longest wait, while the count its page shows keeps changing, and waits afresh after it", async () => {
    const { app, read, request, tab } = await setup();
    for (let elapsed = 0; elapsed < NUDGE_MAX_WAIT; elapsed += 500) {
      unwrap(request(gmail.unreadChanged));
      app.clock.advance(500);
    }
    const atLongest = [...read];
    unwrap(request(gmail.unreadChanged));
    app.clock.advance(UNREAD_SETTLE - 1);
    const settling = [...read];
    app.clock.advance(1);
    expect([atLongest, settling, read]).toStrictEqual([
      [tab.profileId],
      [tab.profileId],
      [tab.profileId, tab.profileId],
    ]);
  });

  it("refuses an action no page answers for, and one whose tab has no page even after it is woken", async () => {
    const { app, detach, feature, tab, woken } = await setup();
    const silent = feature.act(tab.id, "FMfcg", "archive");
    app.clock.advance(ACT_TIMEOUT);
    await expect(silent).resolves.toStrictEqual({ error: "silent", ok: false });

    detach();
    const pageless = feature.act(tab.id, "FMfcg", "archive");
    expect(woken).toStrictEqual([tab.id]);
    app.clock.advance(WAKE_TIMEOUT);
    await expect(pageless).resolves.toStrictEqual({
      error: "noPage",
      ok: false,
    });
  });

  it("acts once the woken tab has a page, and writes a warning for a refusal the page reports", async () => {
    const { app, detach, feature, log, pushed, tab } = await setup();
    const WOKEN = 44;
    detach();
    const acted = feature.act(tab.id, "FMfcg", "archive");
    feature.page(tab).attach(WOKEN);
    await expect
      .poll(() => pushed(gmailPushes.mailAction))
      .toStrictEqual([{ action: "archive", id: 0, messageId: "FMfcg" }]);
    unwrap(
      app.registrar.dispatch(WOKEN, wireName(gmail.mailActed), {
        acted: true,
        id: 0,
      })
    );
    await expect(acted).resolves.toMatchObject({ ok: true });

    unwrap(
      app.registrar.dispatch(WOKEN, wireName(gmail.mailActionFailed), {
        reason: "noToken",
      })
    );
    expect(log.at("warn")).toStrictEqual([
      "Gmail refused an action on a message",
    ]);
  });

  it("refuses a page's request once its view is gone", async () => {
    const { detach, request } = await setup();
    detach();
    expect(request(gmail.settings)).toMatchObject({
      error: { kind: "wrongSurface" },
    });
  });

  it("makes the user styles file before opening it, only while Pro allows it", async () => {
    const { app, entitle, shell } = await setup();
    unwrap(app.commands.run("gmail.editUserStyles", { windowId: 1 }));
    await expect
      .poll(() => shell.files)
      .toStrictEqual([`/user-data/${USER_STYLES_FILE}`]);
    expect(app.fs.files.get(USER_STYLES_FILE)).toBe("");
    unwrap(app.commands.run("gmail.revealUserStyles", { windowId: 1 }));
    await expect.poll(() => shell.revealed).toHaveLength(1);
    entitle(FREE);
    expect(app.commands.enabled("gmail.editUserStyles")).toBeFalsy();
  });

  it("asks the selected profile's Gmail to show its out-of-office settings", async () => {
    const { app, opened } = await setup();
    unwrap(app.commands.run("gmail.outOfOfficeSettings", { windowId: 1 }));
    expect(opened).toStrictEqual([
      { hash: "#settings/general", profileId: app.profiles.selected().id },
    ]);
  });

  it("marks the profile out of office as its tab's page says, and not as a pop-out's does", async () => {
    const { app, feature, request, tab } = await setup();
    const popOut = new FakePopOutWindow();
    feature.attachPopOut(popOut, tab.profileId);
    const shown = () =>
      app.profiles.snapshot().profiles.map((profile) => profile.outOfOffice);

    unwrap(request(gmail.outOfOffice, { on: true }));
    expect(shown()).toStrictEqual([true]);

    unwrap(
      app.registrar.dispatch(popOut.contentsId, wireName(gmail.outOfOffice), {
        on: false,
      })
    );
    expect(shown()).toStrictEqual([true]);

    unwrap(request(gmail.outOfOffice, { on: false }));
    expect(shown()).toStrictEqual([false]);
  });
});

const sent = async (closes = true) => {
  const context = await setup();
  const { app, feature, tab } = context;
  app.settings.set("gmail.closeComposeWindowAfterSend", closes);
  const popOut = new FakePopOutWindow();
  feature.attachPopOut(popOut, tab.profileId);
  unwrap(
    app.registrar.dispatch(popOut.contentsId, wireName(gmail.messageSent), {})
  );
  const sentTo = (channel: Parameters<typeof wireName>[0]) =>
    app.transport.sent
      .filter((one) => one.channel === wireName(channel))
      .map((one) => ({ contentsId: one.contentsId, payload: one.payload }));
  return { ...context, popOut, sentTo };
};

describe("a pop-out that sent a message", () => {
  it("hides, shows the toast in the profile's Gmail pane, and closes once the undo period is over", async () => {
    const { app, popOut, sentTo } = await sent();

    expect(popOut.visible).toBeFalsy();
    expect(sentTo(gmailPushes.showSentToast)).toStrictEqual([
      { contentsId: PAGE, payload: { id: 0 } },
    ]);

    app.clock.advance(SENT_UNDO_WINDOW);

    expect(popOut.closed).toBeTruthy();
    expect(sentTo(gmailPushes.dismissSentToast)).toStrictEqual([
      { contentsId: PAGE, payload: { id: 0 } },
    ]);
  });

  it("comes back with Gmail's Undo clicked when the toast's Undo is, and stays", async () => {
    const { app, popOut, request, sentTo } = await sent();

    unwrap(request(gmail.undoSend, { id: 0 }));
    app.clock.advance(SENT_UNDO_WINDOW);

    expect(popOut.visible).toBeTruthy();
    expect(popOut.closed).toBeFalsy();
    expect(sentTo(gmailPushes.undoSend)).toStrictEqual([
      { contentsId: popOut.contentsId, payload: {} },
    ]);
    expect(sentTo(gmailPushes.dismissSentToast)).toHaveLength(1);
  });

  it("stays as it was while the setting is off", async () => {
    const { popOut, sentTo } = await sent(false);
    expect(popOut.visible).toBeTruthy();
    expect(sentTo(gmailPushes.showSentToast)).toStrictEqual([]);
  });

  it("refuses its requests once closed", async () => {
    const { app, popOut } = await sent();
    popOut.close();
    expect(
      app.registrar.dispatch(popOut.contentsId, wireName(gmail.messageSent), {})
        .ok
    ).toBeFalsy();
  });
});
