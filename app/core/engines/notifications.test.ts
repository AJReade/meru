import { describe, expect, it } from "vitest";

import { ONE_UNREAD, TWO_UNREAD } from "../fixtures/gmail-feeds.ts";
import type { FeedEntry } from "../records/feed.ts";
import { parseFeed } from "./feed.ts";
import {
  admitPageNotice,
  appNotice,
  mailNotice,
  NO_PAGE_NOTICES,
  notifiable,
  PAGE_NOTICE_LIMIT,
  PAGE_NOTICE_WINDOW,
} from "./notifications.ts";
import type { PageNotices } from "./notifications.ts";

const entriesOf = (text: string): readonly FeedEntry[] => {
  const parsed = parseFeed(text);
  return parsed.ok ? parsed.value.entries : [];
};

const two = entriesOf(TWO_UNREAD);
const one = entriesOf(ONE_UNREAD);
const [newest, older] = two;
const subjects = (entries: readonly FeedEntry[]) =>
  entries.map((entry) => entry.subject);

describe(notifiable, () => {
  it("keeps only important mail when asked, and all of it when the Important feed could not be read", () => {
    const important = new Set([older?.id ?? ""]);
    expect([
      subjects(notifiable(two, "all", important)),
      subjects(notifiable(two, "important", important)),
      subjects(notifiable(two, "important", undefined)),
    ]).toStrictEqual([
      ['Q3 & Q4 "plans" – Tom\'s draft', "2024"],
      ["2024"],
      ['Q3 & Q4 "plans" – Tom\'s draft', "2024"],
    ]);
  });
});

describe(mailNotice, () => {
  const shown = {
    labelled: false,
    profileLabel: "Work",
    showSender: true,
    showSubject: true,
    showSummary: true,
  } as const;

  it("puts the subject in the subtitle on macOS and above the snippet elsewhere, naming the profile only for someone with several", () => {
    const [entry] = one;
    expect(
      entry === undefined
        ? []
        : [
            mailNotice(entry, { ...shown, platform: "darwin" }),
            mailNotice(entry, { ...shown, labelled: true, platform: "win32" }),
          ]
    ).toStrictEqual([
      { body: "Are you free at noon", subtitle: "Lunch?", title: "Ann" },
      { body: "Lunch?\nAre you free at noon", title: "[Work] Ann" },
    ]);
  });

  it("titles a notice with the profile when the sender is hidden, and leaves out an empty snippet", () => {
    expect(
      older === undefined || newest === undefined
        ? []
        : [
            mailNotice(older, { ...shown, platform: "linux" }),
            mailNotice(newest, {
              ...shown,
              platform: "darwin",
              showSender: false,
              showSubject: false,
              showSummary: false,
            }),
          ]
    ).toStrictEqual([{ body: "2024", title: "12345" }, { title: "Work" }]);
  });
});

describe(appNotice, () => {
  const raised = {
    body: "Starts in ten minutes",
    title: "Standup",
  } as const;
  const shown = {
    alwaysSilent: false,
    appName: "Calendar",
    labelled: false,
    profileLabel: "Work",
  } as const;

  it("titles the notice with the app, keeping the page's own title as the subtitle on macOS and above the body elsewhere", () => {
    expect([
      appNotice(raised, { ...shown, platform: "darwin" }),
      appNotice(raised, { ...shown, labelled: true, platform: "win32" }),
    ]).toStrictEqual([
      {
        body: "Starts in ten minutes",
        silent: false,
        subtitle: "Standup",
        title: "Calendar",
      },
      {
        body: "Standup\nStarts in ten minutes",
        silent: false,
        title: "[Work] Calendar",
      },
    ]);
  });

  it("keeps what the page asked of the sound, and silences an app that plays its own", () => {
    expect([
      appNotice({ ...raised, silent: true }, { ...shown, platform: "linux" }),
      appNotice(
        { title: "Standup" },
        { ...shown, alwaysSilent: true, platform: "darwin" }
      ),
    ]).toStrictEqual([
      {
        body: "Standup\nStarts in ten minutes",
        silent: true,
        title: "Calendar",
      },
      {
        silent: true,
        subtitle: "Standup",
        title: "Calendar",
      },
    ]);
  });
});

const verdictsAt = (times: readonly number[]) => {
  let notices: PageNotices = NO_PAGE_NOTICES;
  return times.map((now) => {
    const admitted = admitPageNotice(notices, now);
    ({ notices } = admitted);
    return admitted.verdict;
  });
};

describe(admitPageNotice, () => {
  it(`shows ${PAGE_NOTICE_LIMIT} a window, then one saying more were held back, then nothing until the window has room`, () => {
    const flood = Array.from({ length: 2000 }, (_, index) => index);
    const verdicts = verdictsAt(flood);
    expect([
      verdicts.slice(0, PAGE_NOTICE_LIMIT + 1),
      verdicts.filter((verdict) => verdict !== "drop").length,
    ]).toStrictEqual([["show", "show", "show", "show", "held"], 5]);
  });

  it("shows again once the window has aged out, and says once more that more were held back", () => {
    const later = PAGE_NOTICE_WINDOW + 3;
    expect(
      verdictsAt([0, 1, 2, 3, 4, 5, later, later, later, later, later, later])
    ).toStrictEqual([
      "show",
      "show",
      "show",
      "show",
      "held",
      "drop",
      "show",
      "show",
      "show",
      "show",
      "held",
      "drop",
    ]);
  });
});
