// Writes the Gmail fixtures the preload's tests read, from a signed-in profile, each document scrubbed of everything personal:
// MERU_TEST_PROFILE_DIR=<a user data directory signed in to Gmail> node scripts/gmail/capture.ts [--in-place] [--corpus | --out-of-office], after pnpm build and once the account has sent itself the two messages named below, then vp fmt; --in-place runs on the directory itself, for one that is a copy already.
// --corpus writes the message bodies the dark theme's tests read instead, the mails subjected "Corpus <kind>" first and then All Mail's, a few of each shape.
// --out-of-office writes only out-of-office.html, from the inbox once Gmail shows the out-of-office banner, so the account's reply is turned on in Gmail's settings first and off again after.
// The scrub keeps what the features anchor on and nothing a person wrote: roles, ARIA states and the ids they point at, Gmail's generated classes and ids, `gh`, `act`, `role`, field names, icon path data, Gmail's control words in `aria-label` and `data-tooltip`, thread and message ids as counters, an address's shape (`email`, and `href` down to the view and the print view's `view` and `permmsgid`), and that a chip has a `download_url`.
import { existsSync } from "node:fs";
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";

import { expect } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { z } from "zod";

import { scrubHtml, scrubMail } from "../../app/core/engines/scrub.ts";
import { launch } from "../lib/app.ts";
import { corpusFileName } from "./corpus-name.ts";

const root = path.join(import.meta.dirname, "..", "..");
const FIXTURES = path.join(root, "app/preload/gmail/features/fixtures");
const CORPUS = path.join(FIXTURES, "corpus");
const CORPUS_SIZE = 32;
// Mails sent to the account to fill a kind its inbox lacked are subjected "Corpus <kind>"; any other is named by its shape, a few of each, since the account's own mail repeats a handful of templates.
const PER_SHAPE = 3;

// 3.x's end-to-end suite holds this lock in a signed-in profile from copying it until it writes the session back, since two copies of one Google session running at once sign each other out; a capture takes it for its copy too.
const PROFILE_LOCK = ".e2e-run.lock";
const LOCK_WAIT = 90_000;

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM is a process that runs under another user.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/** Takes 3.x's lock in the profile, waiting for a run that holds it and breaking one whose process has gone, and answers its release. */
const lockProfile = async (profile: string): Promise<() => Promise<void>> => {
  const lock = path.join(profile, PROFILE_LOCK);
  const holder = String(process.pid);
  const giveUpAt = Date.now() + LOCK_WAIT;
  for (;;) {
    const temporary = `${lock}.${process.pid}.${Date.now()}.tmp`;
    // oxlint-disable-next-line no-await-in-loop -- one attempt at a time
    await writeFile(temporary, holder, { mode: 0o600 });
    try {
      // A hard link fails when the lock exists, so the holder is in place before the lock appears, as 3.x takes it.
      // oxlint-disable-next-line no-await-in-loop -- one attempt at a time
      await link(temporary, lock);
      return async () => {
        if ((await readFile(lock, "utf-8").catch(() => "")) === holder) {
          await rm(lock, { force: true });
        }
      };
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
    } finally {
      // oxlint-disable-next-line no-await-in-loop -- one attempt at a time
      await rm(temporary, { force: true });
    }
    // oxlint-disable-next-line no-await-in-loop -- one attempt at a time
    const held = await readFile(lock, "utf-8").catch(() => "");
    const pid = Number(held.split(" ")[0]);
    if (!Number.isInteger(pid) || pid <= 0 || !isRunning(pid)) {
      // oxlint-disable-next-line no-await-in-loop -- one attempt at a time
      await rm(lock, { force: true });
      continue;
    }
    if (Date.now() > giveUpAt) {
      throw new Error(
        `Process ${pid} has held ${lock} for over ${LOCK_WAIT}ms; a capture waits for it rather than run beside it`
      );
    }
    // oxlint-disable-next-line no-await-in-loop -- one attempt at a time
    await pause(500);
  }
};

// Each hand-made fixture a capture replaces in place, by the document it is taken from. labels.html stays hand-made: the scrub takes out every label's name, which is what its test colours by; so does mailbox-key.html, since the scrub takes out the script the marker is written in; so does message-sent.html, whose state a page at rest does not hold.
// promo-banner.html and upgrade-button.html stay hand-made: the scrub takes out the `data-pep-id` and `data-action-behavior` values their rules read, and the account is offered neither.
const FROM_INBOX = ["inbox-rows.html"];
// Taken from the conversation the account sent itself with an attachment, with Compose open over it. conversation.html, links.html and trimmed-content.html stay hand-made until the account holds a conversation of several messages, an outside link and a folded quote.
const FROM_THREAD = ["attachments.html"];
// Taken from the message the account sent itself past Gmail's clipping size.
const FROM_CLIPPED = ["clipped.html"];
// Taken from the inbox while the account's out-of-office reply is on, under --out-of-office.
const FROM_OUT_OF_OFFICE = ["out-of-office.html"];
// The bar above Google's header, which Gmail leaves empty while no notice shows; looser than the feature's anchor, which the fixture is there to test.
const NOTICE_BAR = 'div:has(+ h1 > header[role="banner"]):not(:empty)';

/** The subjects of the two messages the account is sent before a capture, which the capture opens by searching for them. */
const ATTACHMENT_SUBJECT = "Meru capture attachment";
const CLIPPED_SUBJECT = "Meru capture clipped";

/** How long a document of the real Gmail is given to render. */
const READY = 120_000;

/** Runs `code` in the pane's page, which answers a string, and gives back what it answered. */
const readPane = async (
  app: ElectronApplication,
  contentsId: number,
  code: string
): Promise<string> =>
  await app.evaluate(
    async ({ webContents }, request) => {
      const contents = webContents.fromId(request.contentsId);
      if (contents === undefined) {
        throw new Error(`No web contents ${request.contentsId}`);
      }
      // executeJavaScript answers whatever the page's last expression gave, so every script here ends in a string.
      const answer: unknown = await contents.executeJavaScript(
        request.code,
        true
      );
      return typeof answer === "string" ? answer : "";
    },
    { code, contentsId }
  );

const quote = (text: string) => JSON.stringify(text);

const found = (selector: string) =>
  `document.querySelector(${quote(selector)}) === null ? "" : "ready"`;

const waitFor = async (
  app: ElectronApplication,
  contentsId: number,
  selector: string,
  what: string
) => {
  await expect
    .poll(async () => await readPane(app, contentsId, found(selector)), {
      message: `${what} never rendered`,
      timeout: READY,
    })
    .toBe("ready");
};

const goTo = async (
  app: ElectronApplication,
  contentsId: number,
  hash: string
) => {
  await readPane(
    app,
    contentsId,
    `(() => { location.hash = ${quote(hash)}; return "went"; })()`
  );
};

/** The web contents of the first pane, which shows the profile's Gmail tab, once it has one. */
const gmailPane = async (app: ElectronApplication): Promise<number> => {
  const idOf = async () =>
    await app.evaluate(
      ({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().includes("mail.google.com"))
          ?.id ?? 0
    );
  await expect
    .poll(idOf, { message: "No pane showed Gmail", timeout: READY })
    .toBeGreaterThan(0);
  return await idOf();
};

const write = async (name: string, html: string) => {
  const day = new Date().toISOString().slice(0, 10);
  const header = `<!-- Captured by scripts/gmail/capture.ts and scrubbed by app/core/engines/scrub.ts on ${day}. -->\n`;
  const file = path.join(FIXTURES, name);
  await writeFile(file, `${header}${scrubHtml(html)}\n`);
  return path.relative(root, file);
};

const documentOf = async (app: ElectronApplication, contentsId: number) =>
  await readPane(app, contentsId, "document.documentElement.outerHTML");

/** Opens the newest conversation of this subject, which the account must have been sent first, by a click on its row: Gmail takes a search's result to its conversation only from the list, not from an address naming the thread. */
const openBySubject = async (
  app: ElectronApplication,
  contentsId: number,
  subject: string,
  ready: string
) => {
  await goTo(
    app,
    contentsId,
    `search/${encodeURIComponent(`subject:"${subject}"`)}`
  );
  // The list the search replaces stays drawn for a moment, so the row is the one showing the subject.
  const clickRow = `(() => { const row = [...document.querySelectorAll('[role="main"] tr')].find((found) => found.offsetParent !== null && found.textContent.includes(${quote(subject)})); if (row === undefined) { return ""; } for (const type of ["mousedown", "mouseup", "click"]) { row.dispatchEvent(new MouseEvent(type, { bubbles: true })); } return "ready"; })()`;
  await expect
    .poll(async () => await readPane(app, contentsId, clickRow), {
      message: `No conversation titled ${subject} was listed`,
      timeout: READY,
    })
    .toBe("ready");
  await waitFor(app, contentsId, "h2[data-legacy-thread-id]", subject);
  // Gmail draws a message's attachments and its clipping note after the conversation itself.
  await waitFor(app, contentsId, ready, `What ${subject} holds`);
};

const writeAll = async (names: readonly string[], html: string) =>
  await Promise.all(names.map(async (name) => await write(name, html)));

const captureOutOfOffice = async (app: ElectronApplication) => {
  const pane = await gmailPane(app);
  await waitFor(app, pane, '[role="main"]', "Gmail's inbox");
  await waitFor(app, pane, NOTICE_BAR, "The out-of-office banner");
  return await writeAll(FROM_OUT_OF_OFFICE, await documentOf(app, pane));
};

const capture = async (app: ElectronApplication) => {
  const pane = await gmailPane(app);
  await waitFor(app, pane, '[role="main"]', "Gmail's inbox");
  const inbox = await writeAll(FROM_INBOX, await documentOf(app, pane));

  await openBySubject(app, pane, ATTACHMENT_SUBJECT, "span[download_url]");
  await readPane(
    app,
    pane,
    `(() => { const compose = document.querySelector('[gh="cm"]'); for (const type of ["mousedown", "mouseup", "click"]) { compose?.dispatchEvent(new MouseEvent(type, { bubbles: true })); } return "opened"; })()`
  );
  await waitFor(app, pane, 'input[name="subjectbox"]', "Compose");
  const thread = await writeAll(FROM_THREAD, await documentOf(app, pane));

  await openBySubject(app, pane, CLIPPED_SUBJECT, '.iX > a[href*="view=lg"]');
  const clipped = await writeAll(FROM_CLIPPED, await documentOf(app, pane));
  return [...inbox, ...thread, ...clipped];
};

// Evaluated in the thread's page: the last message's body, each image's box stamped on it as its width and height so its placeholder keeps the size, the kind the subject or the body's shape names, and whether a session sent it to probe a feature.
const BODY = `(async () => {
  const bodies = [...document.querySelectorAll(".a3s")].filter((body) => body.offsetParent !== null);
  const body = bodies[bodies.length - 1];
  if (body === undefined) return "";
  const images = [...body.querySelectorAll("img")];
  const until = Date.now() + 5000;
  while (images.some((image) => !image.complete) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  for (const image of images) {
    image.setAttribute("width", String(image.width || image.naturalWidth));
    image.setAttribute("height", String(image.height || image.naturalHeight));
  }
  const subject = document.querySelector("h2[data-legacy-thread-id]")?.textContent ?? "";
  const named = /^Corpus ([a-z-]+)$/.exec(subject.trim())?.[1];
  const shape = body.querySelector("table") !== null ? "table-layout" : body.querySelector("img") !== null ? "images" : body.querySelector("[style*=color]") !== null ? "styled" : "plain-text";
  return JSON.stringify({ kind: named ?? shape, named: named !== undefined, probe: /^Meru /.test(subject.trim()), clipped: body.querySelector(".iX") !== null, empty: body.textContent.trim() === "", html: body.outerHTML });
})()`;

/** How long a thread of the corpus is given to show its body; a thread holding only a draft never does. */
const THREAD_READY = 15_000;

const shows = async (
  app: ElectronApplication,
  contentsId: number,
  selector: string
): Promise<boolean> => {
  const until = Date.now() + THREAD_READY;
  while (Date.now() < until) {
    // oxlint-disable-next-line no-await-in-loop -- polled until it shows
    if ((await readPane(app, contentsId, found(selector))) === "ready") {
      return true;
    }
    // oxlint-disable-next-line no-await-in-loop -- polled until it shows
    await pause(250);
  }
  return false;
};

const corpusEntry = z.object({
  clipped: z.boolean(),
  empty: z.boolean(),
  html: z.string(),
  kind: z.string().regex(/^[a-z-]+$/u),
  named: z.boolean(),
  probe: z.boolean(),
});

// The thread of each row of the list showing, in order; Gmail keeps the list it replaces in the document, hidden.
const ROWS = `JSON.stringify([...document.querySelectorAll('[role="main"] tr.zA')].filter((row) => row.offsetParent !== null).map((row) => row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ?? ""))`;

const rowsOf = async (
  app: ElectronApplication,
  contentsId: number,
  hash: string
): Promise<readonly string[]> => {
  await goTo(app, contentsId, hash);
  // The list the hash replaces stays drawn for a moment.
  await pause(1500);
  const until = Date.now() + THREAD_READY;
  while (Date.now() < until) {
    const rows = z
      .array(z.string())
      // oxlint-disable-next-line no-await-in-loop -- polled until the list shows
      .parse(JSON.parse(await readPane(app, contentsId, ROWS)));
    if (rows.length > 0) {
      return rows;
    }
    // oxlint-disable-next-line no-await-in-loop -- polled until the list shows
    await pause(250);
  }
  return [];
};

/** Opens a thread by a click on its row of the list showing: Gmail opens a thread from its list, not from an address naming its legacy id. */
const openRow = async (
  app: ElectronApplication,
  contentsId: number,
  thread: string
): Promise<boolean> =>
  (await readPane(
    app,
    contentsId,
    `(() => { const row = [...document.querySelectorAll('[role="main"] tr.zA')].find((found) => found.offsetParent !== null && found.querySelector(${quote(`[data-legacy-thread-id="${thread}"]`)}) !== null); if (row === undefined) { return ""; } for (const type of ["mousedown", "mouseup", "click"]) { row.dispatchEvent(new MouseEvent(type, { bubbles: true })); } return "opened"; })()`
  )) === "opened";

// The mails sent to fill a kind first, then All Mail, a page at a time.
const CORPUS_LISTS = [
  `search/${encodeURIComponent('subject:"Corpus"')}`,
  "all",
];
const LIST_PAGES = 20;

/** The threads of each page of each list, in order, each once, with the page that lists it. */
const corpusThreads = async (app: ElectronApplication, contentsId: number) => {
  const threads = new Map<string, string>();
  for (const list of CORPUS_LISTS) {
    let previous = "";
    for (let page = 1; page <= LIST_PAGES; page += 1) {
      const hash = page === 1 ? list : `${list}/p${page}`;
      // oxlint-disable-next-line no-await-in-loop -- one list is open at a time
      const rows = await rowsOf(app, contentsId, hash);
      // A page past the last leaves the last one showing.
      if (rows.length === 0 || rows.join(",") === previous) {
        break;
      }
      previous = rows.join(",");
      for (const thread of rows) {
        if (thread !== "" && !threads.has(thread)) {
          threads.set(thread, hash);
        }
      }
    }
  }
  return [...threads].map(([thread, hash]) => ({ hash, thread }));
};

const captureCorpus = async (app: ElectronApplication) => {
  const pane = await gmailPane(app);
  await waitFor(app, pane, '[role="main"]', "Gmail's inbox");
  await mkdir(CORPUS, { recursive: true });
  const shapes = new Map<string, number>();
  const written: string[] = [];
  for (const { hash, thread } of await corpusThreads(app, pane)) {
    if (written.length >= CORPUS_SIZE) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- one thread is open at a time
    await rowsOf(app, pane, hash);
    const opened =
      // oxlint-disable-next-line no-await-in-loop -- one thread is open at a time
      (await openRow(app, pane, thread)) &&
      // oxlint-disable-next-line no-await-in-loop -- one thread is open at a time
      (await shows(app, pane, `h2[data-legacy-thread-id="${thread}"]`)) &&
      // oxlint-disable-next-line no-await-in-loop -- one thread is open at a time
      (await shows(app, pane, ".a3s"));
    if (!opened) {
      console.log(`Skipped a thread whose body did not render`);
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- one thread is open at a time
    const body = await readPane(app, pane, BODY);
    // A body Gmail took away while it was read answers nothing.
    if (body === "") {
      console.log(`Skipped a thread whose body went`);
      continue;
    }
    const entry = corpusEntry.parse(JSON.parse(body));
    // What a session sent the account to test a feature is no mail's shape, and neither is a body Gmail clipped, which repeats one paragraph up to its clipping size and ends in its own link, nor one with no text, such as a lone line break.
    if (entry.probe || entry.clipped || entry.empty) {
      continue;
    }
    const seen = shapes.get(entry.kind) ?? 0;
    shapes.set(entry.kind, seen + 1);
    // A kind sent to fill a gap is taken once, and any other shape a few times.
    if (entry.named ? seen > 0 : seen >= PER_SHAPE) {
      continue;
    }
    const scrubbed = scrubMail(entry.html);
    const file = path.join(
      CORPUS,
      corpusFileName(entry.kind, entry.named, scrubbed)
    );
    // oxlint-disable-next-line no-await-in-loop -- one thread is open at a time
    await writeFile(
      file,
      `<!-- Corpus: ${entry.kind}. Captured by scripts/gmail/capture.ts --corpus and scrubbed by app/core/engines/scrub.ts's scrubMail. -->\n${scrubbed}\n`
    );
    written.push(path.relative(root, file));
  }
  return written;
};

const run = async () => {
  const profile = process.env.MERU_TEST_PROFILE_DIR;
  if (profile === undefined || profile === "") {
    throw new Error(
      "MERU_TEST_PROFILE_DIR names the user data directory signed in to Gmail: MERU_TEST_PROFILE_DIR=<dir> node scripts/gmail/capture.ts"
    );
  }
  if (!existsSync(path.join(root, "app/dist/main/index.js"))) {
    throw new Error(
      "Nothing to capture from in app/dist/; run pnpm build first"
    );
  }
  // The app is launched on a copy, so a capture never writes to the signed-in profile it reads, unless that is a copy already, whose session a second copy would rotate out from under it.
  const inPlace = process.argv.includes("--in-place");
  const userData = inPlace
    ? profile
    : await mkdtemp(path.join(tmpdir(), "meru-capture-"));
  if (!inPlace) {
    const release = await lockProfile(profile);
    try {
      await cp(profile, userData, {
        filter: (source) => !path.basename(source).startsWith(PROFILE_LOCK),
        recursive: true,
      });
    } finally {
      await release();
    }
  }
  const corpus = process.argv.includes("--corpus");
  let taken = capture;
  if (corpus) {
    taken = captureCorpus;
  } else if (process.argv.includes("--out-of-office")) {
    taken = captureOutOfOffice;
  }
  // MERU_E2E blanks every pane, so the capture turns off what the end-to-end launch sets; a window that may never be on screen is throttled by Chromium until Gmail stops drawing an opened thread.
  const { app, close } = await launch({
    env: { MERU_E2E: "0", MERU_TEST_BACKGROUND: corpus ? "0" : "1" },
    userData,
  });
  try {
    for (const file of await taken(app)) {
      console.log(`Wrote ${file}`);
    }
  } finally {
    await close();
    if (!inPlace) {
      await rm(userData, { force: true, recursive: true });
    }
  }
};

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
