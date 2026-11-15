import { E2E_CLICK_CONTEXT_MENU } from "../app/main/shell/e2e.ts";
import { pageOf } from "../scripts/lib/app.ts";
import { callExposed, expect, inspect, test } from "./app.ts";
import { startGmailStub } from "./gmail-stub.ts";

const AWAY = "https://example.com/away";

const MAILBOX = `<!doctype html><title>Gmail</title>
<div role="main"><a id="away" href="${AWAY}">Away</a></div>`;

test("builds the menu a right-click on a link in the Gmail pane opens, sends the link to the browser from it and copies it", async ({
  launch,
}) => {
  const stub = await startGmailStub(MAILBOX);
  try {
    const { app } = await launch({ env: { MERU_GMAIL_URL: stub.url } });
    const pane = await pageOf(app, new URL(stub.url).host);
    await pane.locator("#away").click({ button: "right" });
    // macOS selects the word under a right-click, which puts the selection's items ahead of the link's.
    await expect
      .poll(async () => {
        const { contextMenu } = await inspect(app);
        return contextMenu.slice(-4);
      })
      .toStrictEqual([
        {
          enabled: true,
          id: "copyLink",
          kind: "item",
          label: "Copy link addr&ess",
        },
        {
          enabled: true,
          id: "openInDefaultBrowser",
          kind: "item",
          label: "Open in default browser",
        },
        { kind: "separator" },
        {
          enabled: true,
          id: "inspectElement",
          kind: "item",
          label: "Inspect element",
        },
      ]);

    const { contextMenu } = await inspect(app);
    const indexOf = (id: string) =>
      contextMenu.findIndex((item) => item.kind === "item" && item.id === id);
    await callExposed(app, E2E_CLICK_CONTEXT_MENU, [
      indexOf("openInDefaultBrowser"),
    ]);
    await callExposed(app, E2E_CLICK_CONTEXT_MENU, [indexOf("copyLink")]);
    await expect
      .poll(async () => {
        const { clipboard, external } = await inspect(app);
        return { clipboard, external };
      })
      .toStrictEqual({
        clipboard: [{ kind: "bookmark", title: "Away", url: AWAY }],
        external: [AWAY],
      });
  } finally {
    await stub.stop();
  }
});
