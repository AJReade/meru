import { useEffect, useState } from "react";

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const DAY = 86_400_000;

const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const calendars = new Map<string, Intl.DateTimeFormat>();

/** The calendar day `time` falls on in the zone, counted from the epoch, so that a day of 23 or 25 hours still counts as one. */
const dayOf = (time: number, timeZone: string | undefined): number => {
  const key = timeZone ?? "";
  const calendar =
    calendars.get(key) ??
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "numeric",
      timeZone,
      year: "numeric",
    });
  calendars.set(key, calendar);
  const parts = calendar.formatToParts(time);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY;
};

/** How long before `now` `then` was: in calendar days in the zone, the system's unless one is named, once it was another day, and otherwise in the largest unit it fills, "now" under a minute or for a time after `now`. */
export const relativeTime = (
  then: number,
  now: number,
  timeZone?: string
): string => {
  const at = Math.min(then, now);
  const days = dayOf(now, timeZone) - dayOf(at, timeZone);
  if (days > 0) {
    return format.format(-days, "day");
  }
  const elapsed = now - at;
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) {
      return format.format(-Math.floor(elapsed / size), unit);
    }
  }
  return format.format(0, "second");
};

/** How often the times move on: the finest unit shown is the minute. */
const TICK = 30_000;

/** The time now, moving on every `TICK`, so every row of a list reads one clock. */
export const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
};
