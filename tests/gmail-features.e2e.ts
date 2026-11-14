import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ElectronApplication, Page } from "@playwright/test";
import { z } from "zod";

import { settings } from "../app/shared/channels/settings.ts";
import type { SettingKey } from "../app/shared/settings/registry.ts";
import { settingSet } from "../app/shared/settings/schema.ts";
import { invokeIn } from "../scripts/lib/app.ts";
import {
  entitlementKindOf,
  expect,
  inspect,
  must,
  panesOf,
  profilesOf,
  test,
} from "./app.ts";
import { startGmailStub } from "./gmail-stub.ts";

// The markers each feature anchors on, as the hand-made fixtures under app/preload/gmail/features/fixtures hold them; Compose opens its pop-out only on a Shift-click, as Gmail does.
const MAILBOX = `<!doctype html><title>Gmail</title>
<div id=":7"><div id=":k" role="alert">Your vacation responder is on. <a href="#settings/general">Vacation Settings</a></div></div>
<div role="navigation"><div class="T-I T-I-KE L3" gh="cm" role="button" tabindex="0">Compose</div></div>
<div role="main">
  <table role="grid"><tbody>
    <tr class="zA" id=":1a"><td><span email="ada@example.com">Ada</span>, <span email="grace@navy.example">Grace</span></td><td>Engines</td></tr>
  </tbody></table>
  <div class="gs"><div class="ii gt"><div class="a3s"><div class="clipped"><p>The start of a long message.</p><div class="iX"><a href="?ui=2&amp;view=lg&amp;permmsgid=msg-f:1">View entire message</a></div></div></div></div><div class="hq gt"><span download_url="application/pdf:report.pdf:about:blank">report.pdf</span></div></div>
</div>
<script>
  document.querySelector('[gh="cm"]').addEventListener("click", (event) => {
    if (event.shiftKey) {
      window.open(location.origin + location.pathname + "?view=cm", "_blank");
    }
  });
</script>`;

const PRINT_VIEW = `<!doctype html><table class="message"><tr><td><font size="-1">The whole of a long message.</font></td></tr></table>`;

// Gmail shows "Message sent" with Undo and View message once a pop-out sends; the stand-in shows it at once.
const SENT = `<!doctype html><title>Compose</title>
<div class="vh"><span>Message sent</span><span id="link_undo" role="link">Undo</span><span id="link_vsm" role="link">View message</span></div>
<script>
  document.getElementById("link_undo").addEventListener("click", () => {
    document.title = "Undone";
  });
</script>`;

const run = async (
  app: ElectronApplication,
  contentsId: number,
  code: string
): Promise<unknown> =>
  await app.evaluate(
    async ({ webContents }, [id, script]) => {
      const answer: unknown = await webContents
        .fromId(id)
        ?.executeJavaScript(script, true);
      return answer;
    },
    [contentsId, code] as const
  );

const inPane = async (app: ElectronApplication, code: string) => {
  const [pane] = await panesOf(app);
  if (pane === undefined) {
    throw new Error("The window shows no pane");
  }
  return await run(app, pane.contentsId, code);
};

const popOutsOf = async (app: ElectronApplication) =>
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((window) => window.webContents.getURL().includes("view=cm"))
      .map((window) => ({
        contentsId: window.webContents.id,
        size: window.getSize(),
        visible: window.isVisible(),
      }))
  );

const turnOn = async (chrome: Page, keys: readonly SettingKey[]) => {
  await Promise.all(
    keys.map(async (key) => {
      await invokeIn(
        chrome,
        settings.set,
        must(settingSet(key, true), `${key} as a switch`)
      );
    })
  );
};

test("draws sender icons, moves attachments up, loads a clipped message and marks the profile out of office", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(MAILBOX, { printView: PRINT_VIEW });
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");
    await turnOn(chrome, [
      "gmail.moveAttachmentsToTop",
      "gmail.loadClippedMessages",
      "gmail.hideOutOfOfficeBanner",
    ]);

    await expect
      .poll(
        async () =>
          await inPane(
            app,
            `[document.querySelectorAll(".meru-sender-icons img").length, document.querySelector(".gs").firstElementChild.className, document.querySelector(".clipped").textContent.trim(), getComputedStyle(document.getElementById(":7")).display]`
          )
      )
      .toStrictEqual([2, "hq gt", "The whole of a long message.", "none"]);
    expect(gmail.favicons).toStrictEqual(["example.com", "navy.example"]);
    await expect
      .poll(async () => {
        const { profiles } = await profilesOf(chrome);
        return profiles[0]?.outOfOffice;
      })
      .toBe(true);
    await expect(chrome.locator("button[data-out-of-office]")).toBeVisible();
  } finally {
    await gmail.stop();
  }
});

test("opens Compose in an 800 by 600 pop-out, hides it once sent with an Undo toast in the pane, and brings it back on Undo", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(MAILBOX, { popOut: SENT });
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");
    await turnOn(chrome, [
      "gmail.openComposeInNewWindow",
      "gmail.closeComposeWindowAfterSend",
    ]);
    await expect
      .poll(
        async () =>
          await inPane(
            app,
            `document.querySelector("[data-meru-shift-click]") !== null`
          )
      )
      .toBe(true);

    await inPane(app, `document.querySelector('[gh="cm"]').click()`);

    await expect
      .poll(async () => await popOutsOf(app))
      .toStrictEqual([
        { contentsId: expect.any(Number), size: [800, 600], visible: false },
      ]);
    const toast = `document.getElementById("meru-toaster")?.shadowRoot?.querySelector(".toast-action")`;
    await expect
      .poll(async () => await inPane(app, `${toast}?.textContent ?? null`))
      .toBe("Undo");

    await inPane(app, `${toast}.click()`);

    const [popOut] = await popOutsOf(app);
    await expect
      .poll(async () => {
        const [shown] = await popOutsOf(app);
        return shown?.visible;
      })
      .toBe(true);
    await expect
      .poll(async () =>
        popOut === undefined
          ? null
          : await run(app, popOut.contentsId, "document.title")
      )
      .toBe("Undone");
  } finally {
    await gmail.stop();
  }
});

// A pop-out's page tries every way off Gmail: a window onto another origin, a link that opens one, and navigating itself away.
const ESCAPING = `<!doctype html><title>Compose</title>
<a id="out" target="_blank">out</a>
<script>
  const elsewhere = location.origin.replace("127.0.0.1", "localhost") + "/elsewhere";
  document.getElementById("out").href = elsewhere + "?from=link";
  window.escape = () => {
    window.open(elsewhere + "?from=open", "_blank");
    document.getElementById("out").click();
    location.href = elsewhere + "?from=nav";
  };
</script>`;

test("runs the Gmail preload in a pop-out and keeps it on Gmail, sending the windows and navigations off it to the browser", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(MAILBOX, { popOut: ESCAPING });
  try {
    const { app } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");
    await inPane(
      app,
      `window.open(location.origin + location.pathname + "?view=cm", "_blank"), null`
    );
    await expect
      .poll(async () => {
        const opened = await popOutsOf(app);
        return opened.length;
      })
      .toBe(1);
    const [popOut] = await popOutsOf(app);
    const { contentsId } = must(popOut, "the pop-out");
    await expect
      .poll(async () => await run(app, contentsId, `typeof window.escape`))
      .toBe("function");
    // The window Chromium made carries no preload of its own, so the Gmail preload's style sheets in it say the window was given the opener's again.
    await expect
      .poll(
        async () =>
          await run(
            app,
            contentsId,
            `document.querySelector('style[data-meru-style="hideGmailLogo"]') !== null`
          )
      )
      .toBe(true);

    await run(app, contentsId, `window.escape(), null`);

    const elsewhere = `${gmail.url.replace("127.0.0.1", "localhost").replace("/mail/u/0", "")}/elsewhere`;
    await expect
      .poll(async () => {
        const { external } = await inspect(app);
        return external.toSorted();
      })
      .toStrictEqual([
        `${elsewhere}?from=link`,
        `${elsewhere}?from=nav`,
        `${elsewhere}?from=open`,
      ]);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) =>
          window.webContents.getURL().replace(/^file:.*$/u, "chrome")
        )
      )
    ).toStrictEqual(
      expect.arrayContaining(["chrome", `${gmail.url}/?view=cm`])
    );
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
      )
    ).toBe(2);
  } finally {
    await gmail.stop();
  }
});
/** The windows that show, by address, the chrome page's as `chrome`. */
const shownOf = async (app: ElectronApplication) =>
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((window) => window.isVisible())
      .map((window) =>
        window.webContents.getURL().replace(/^file:.*$/u, "chrome")
      )
      .toSorted()
  );

// Two steps off Gmail that review 22 found: a window the blank popup opens, which had no window-open handler of its own, and a redirect, which will-navigate never hears.
const STEPPING = `<!doctype html><title>Compose</title>
<script>
  const elsewhere = location.origin.replace("127.0.0.1", "localhost") + "/elsewhere";
  window.throughBlank = () => {
    window.open("").open(elsewhere + "?from=popOutBlank", "_blank");
  };
  window.redirect = (view) => {
    location.href = location.pathname + "?view=" + view;
  };
</script>`;

test("sends a blank popup's own windows and a redirect off Gmail to the browser, from a pop-out and from a pane, the pop-out staying where it was", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(MAILBOX, {
    popOut: STEPPING,
    redirects: {
      chain: { path: "/mail/u/0/?view=redirect" },
      redirect: { foreign: true, path: "/elsewhere?from=redirect" },
    },
  });
  try {
    const { app } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");
    await inPane(
      app,
      `window.open(location.origin + location.pathname + "?view=cm", "_blank"), null`
    );
    await expect.poll(async () => await popOutsOf(app)).toHaveLength(1);
    const [popOut] = await popOutsOf(app);
    const { contentsId } = must(popOut, "the pop-out");
    await expect
      .poll(async () => await run(app, contentsId, `typeof window.redirect`))
      .toBe("function");
    const elsewhere = `${gmail.url.replace("127.0.0.1", "localhost").replace("/mail/u/0", "")}/elsewhere`;
    const sent = async () => {
      const { external } = await inspect(app);
      return external.toSorted();
    };

    await run(app, contentsId, `window.throughBlank(), null`);
    await inPane(
      app,
      `window.open("").open(${JSON.stringify(`${elsewhere}?from=paneBlank`)}, "_blank"), null`
    );
    await expect
      .poll(sent)
      .toStrictEqual([
        `${elsewhere}?from=paneBlank`,
        `${elsewhere}?from=popOutBlank`,
      ]);

    await run(app, contentsId, `window.redirect("redirect"), null`);
    await expect.poll(sent).toContain(`${elsewhere}?from=redirect`);
    await run(app, contentsId, `window.redirect("chain"), null`);
    await expect
      .poll(sent)
      .toStrictEqual([
        `${elsewhere}?from=paneBlank`,
        `${elsewhere}?from=popOutBlank`,
        `${elsewhere}?from=redirect`,
        `${elsewhere}?from=redirect`,
      ]);
    expect(await shownOf(app)).toStrictEqual([
      "chrome",
      `${gmail.url}/?view=cm`,
    ]);
    expect(await run(app, contentsId, "typeof window.redirect")).toBe(
      "function"
    );
  } finally {
    await gmail.stop();
  }
});

// What review 21 sent through the print view, each of which restyled Gmail, ran script or left the page past the old denylist.
const HOSTILE_PRINT_VIEW = `<!doctype html><table class="message"><tr><td><font size="-1">
<p>whole</p>
<script>document.title = "script ran"</script>
<a id="js" href="javascript:document.title='js link ran'">js</a>
<style>[gh="cm"] { color: rgb(1, 2, 3) !important; }</style>
<svg><a id="svga"><animate attributeName="href" values="javascript:document.title='svg ran'" begin="0s" dur="1s" fill="freeze"/><text y="20">click</text></a></svg>
</font></td></tr></table>`;

test("loads a hostile print view without its style sheet, script or SVG animation", async ({
  launch,
  stub,
}) => {
  const gmail = await startGmailStub(MAILBOX, {
    printView: HOSTILE_PRINT_VIEW,
  });
  try {
    const { app, chrome } = await launch({
      env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
    });
    await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");
    await turnOn(chrome, ["gmail.loadClippedMessages"]);

    await expect
      .poll(
        async () =>
          await inPane(app, `document.querySelector(".clipped").textContent`)
      )
      .toContain("whole");
    expect(
      await inPane(
        app,
        `[document.title, getComputedStyle(document.querySelector('[gh="cm"]')).color, document.querySelectorAll(".clipped style, .clipped svg, .clipped animate, .clipped script").length, document.querySelector(".clipped a")?.getAttribute("href") ?? null]`
      )
    ).toStrictEqual(["Gmail", "rgb(0, 0, 0)", 0, null]);
  } finally {
    await gmail.stop();
  }
});

const logLineSchema = z.object({
  fields: z.object({ reason: z.unknown(), status: z.unknown() }),
});

const warningsOf = async (userData: string, message: string) => {
  const log = await readFile(
    path.join(userData, "logs", "main.log"),
    "utf-8"
  ).catch(() => "");
  return log
    .split("\n")
    .filter((line) => line.includes(message))
    .map((line) => logLineSchema.parse(JSON.parse(line)).fields);
};

for (const { printView, warning } of [
  { printView: { status: 401 }, warning: { reason: "status", status: 401 } },
  {
    printView: { status: 302, toSignIn: true },
    warning: { reason: "signIn", status: null },
  },
] as const) {
  test(`warns once that a clipped message did not load when its print view answers ${printView.status}`, async ({
    launch,
    stub,
    userData,
  }) => {
    const gmail = await startGmailStub(MAILBOX, { printView });
    try {
      const { app, chrome } = await launch({
        env: { MERU_ENTITLEMENT_URL: stub.url, MERU_GMAIL_URL: gmail.url },
      });
      await expect.poll(async () => await entitlementKindOf(app)).toBe("trial");
      await turnOn(chrome, ["gmail.loadClippedMessages"]);

      await expect
        .poll(
          async () =>
            await warningsOf(userData, "A clipped message did not load")
        )
        .toStrictEqual([warning]);
      expect(
        await warningsOf(userData, "A Gmail selector found nothing")
      ).toStrictEqual([]);
    } finally {
      await gmail.stop();
    }
  });
}
