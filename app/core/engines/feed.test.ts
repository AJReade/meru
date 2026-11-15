import { describe, expect, it } from "vitest";

import {
  MORE_THAN_LISTED,
  NONE_UNREAD,
  ONE_UNREAD,
  SIGN_IN_PAGE,
  TWO_UNREAD,
} from "../fixtures/gmail-feeds.ts";
import { parseFeed } from "./feed.ts";

describe(parseFeed, () => {
  it("reads every entry with its entities decoded, the message id from its link, and nothing where the feed gives no subject, snippet or sender name", () => {
    expect(parseFeed(TWO_UNREAD)).toStrictEqual({
      ok: true,
      value: {
        entries: [
          {
            author: { email: "tom@example.com", name: "Tom O'Brien" },
            id: "tag:gmail.google.com,2004:1790000000000000001",
            issued: Date.parse("2026-11-13T08:59:00Z"),
            link: "https://mail.google.com/mail/u/0?account_id=jane@example.com&message_id=18c1a2b3c4d5e6f7&view=conv&extsrc=atom",
            messageId: "18c1a2b3c4d5e6f7",
            subject: `Q3 & Q4 "plans" – Tom's draft`,
            summary: "Here are the <numbers> you asked for — café",
          },
          {
            author: { email: "bot@example.com", name: "12345" },
            id: "tag:gmail.google.com,2004:1790000000000000002",
            issued: Date.parse("2026-11-13T08:00:00Z"),
            link: "https://mail.google.com/mail/u/0?account_id=jane@example.com&message_id=18c1a2b3c4d5e6f8&view=conv&extsrc=atom",
            messageId: "18c1a2b3c4d5e6f8",
            subject: "2024",
            summary: undefined,
          },
        ],
        unread: 2,
      },
    });
  });

  it("leaves out a sender's name the feed gives as nothing, so a notification falls back to the address", () => {
    const parsed = parseFeed(
      TWO_UNREAD.replace("<name>Tom O&#39;Brien</name>", "<name></name>")
    );
    expect(
      parsed.ok ? parsed.value.entries[0]?.author : undefined
    ).toStrictEqual({ email: "tom@example.com", name: undefined });
  });

  it("reads one entry as a list of one, none as an empty list, and the unread count past the entries listed", () => {
    const counts = [ONE_UNREAD, NONE_UNREAD, MORE_THAN_LISTED].map((text) => {
      const parsed = parseFeed(text);
      return parsed.ok
        ? [parsed.value.unread, parsed.value.entries.length]
        : [];
    });
    expect(counts).toStrictEqual([
      [1, 1],
      [0, 0],
      [57, 0],
    ]);
  });

  it("refuses Google's sign-in page and XML that is no feed", () => {
    expect([
      parseFeed(SIGN_IN_PAGE),
      parseFeed("<rss><channel /></rss>"),
      parseFeed(NONE_UNREAD.replace("<fullcount>0</fullcount>", "")),
    ]).toStrictEqual([
      { error: "notXml", ok: false },
      { error: "notAFeed", ok: false },
      { error: "notAFeed", ok: false },
    ]);
  });

  it("leaves out an entry missing its id, sender or time, keeping the rest", () => {
    const broken = TWO_UNREAD.replace(
      "<id>tag:gmail.google.com,2004:1790000000000000002</id>",
      ""
    );
    const parsed = parseFeed(broken);
    expect(
      parsed.ok ? parsed.value.entries.map((entry) => entry.messageId) : []
    ).toStrictEqual(["18c1a2b3c4d5e6f7"]);
  });
});
