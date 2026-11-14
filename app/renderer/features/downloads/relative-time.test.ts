import { describe, expect, it } from "vitest";

import { relativeTime } from "./relative-time.ts";

const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const LONDON = "Europe/London";
const at = (iso: string) => Date.parse(iso);

describe(relativeTime, () => {
  it("counts calendar days in the zone, so an hour across midnight is yesterday and 25 hours across two midnights is two days", () => {
    expect(
      relativeTime(
        at("2026-06-01T23:30:00Z"),
        at("2026-06-02T00:30:00Z"),
        "UTC"
      )
    ).toBe(format.format(-1, "day"));
    expect(
      relativeTime(
        at("2026-06-01T23:30:00Z"),
        at("2026-06-03T00:30:00Z"),
        "UTC"
      )
    ).toBe(format.format(-2, "day"));
    expect(
      relativeTime(
        at("2026-06-02T01:00:00Z"),
        at("2026-06-02T23:00:00Z"),
        "UTC"
      )
    ).toBe(format.format(-22, "hour"));
  });

  it("reads the day in the zone named, not in UTC", () => {
    // 23:30 UTC on 1 June is 00:30 on 2 June in London's summer time.
    expect(
      relativeTime(
        at("2026-06-01T23:30:00Z"),
        at("2026-06-02T10:00:00Z"),
        LONDON
      )
    ).toBe(format.format(-10, "hour"));
  });

  it("keeps calendar days across a change of the clocks", () => {
    // London's clocks go forward at 01:00 UTC on 29 March 2026, so these are 23 hours apart on consecutive days.
    expect(
      relativeTime(
        at("2026-03-28T12:00:00Z"),
        at("2026-03-29T11:00:00Z"),
        LONDON
      )
    ).toBe(format.format(-1, "day"));
    // They go back at 01:00 UTC on 25 October 2026, so these 26 hours span two midnights.
    expect(
      relativeTime(
        at("2026-10-24T22:00:00Z"),
        at("2026-10-26T00:10:00Z"),
        LONDON
      )
    ).toBe(format.format(-2, "day"));
    expect(
      relativeTime(
        at("2026-10-24T22:30:00Z"),
        at("2026-10-25T23:00:00Z"),
        LONDON
      )
    ).toBe(format.format(-1, "day"));
  });

  it("reads a time after now as now", () => {
    const now = at("2026-06-02T10:00:00Z");
    expect(relativeTime(now + 86_400_000 * 3, now, "UTC")).toBe(
      format.format(0, "second")
    );
  });
});
