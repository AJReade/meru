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
import { FakeShell } from "../../../test/fakes/shell.ts";
import { unwrap } from "../../../test/result.ts";
import { PRO, testApp } from "../../testing.ts";
import {
  Gmail,
  NAVIGATE_TIMEOUT,
  USER_STYLES_FILE,
  USER_STYLES_LIMIT,
  USER_STYLES_SETTLE,
} from "./index.ts";

const FREE: Entitlement = { expiresAt: null, kind: "free", source: "stored" };
const MAILBOX = "https://mail.google.com/mail/u/0";
const PAGE = 41;

const setup = async (given: Entitlement = PRO) => {
  let entitlement = given;
  const app = await testApp({ entitlement: () => entitlement });
  const log = new FakeLog();
  const shell = new FakeShell();
  const feature = new Gmail({
    clock: app.clock,
    commands: app.commands,
    entitlement: () => entitlement,
    events: app.events,
    fs: app.fs,
    log: log.scoped("gmail"),
    mailbox: MAILBOX,
    preload: "/dist/preload/gmail.cjs",
    profiles: app.profiles,
    registrar: app.registrar,
    settings: app.settings,
    shell,
    signIn: "https://accounts.google.com/",
    userStylesPath: `/user-data/${USER_STYLES_FILE}`,
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
  return { app, detach, entitle, feature, log, pushed, request, shell, tab };
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
});
