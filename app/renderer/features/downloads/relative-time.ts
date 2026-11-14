import { useEffect, useState } from "react";

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** How long before `now` `then` was, in the largest unit it fills, and "now" under a minute. */
export const relativeTime = (
  then: number,
  now: number,
  format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
): string => {
  const elapsed = Math.max(0, now - then);
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) {
      return format.format(-Math.floor(elapsed / size), unit);
    }
  }
  return format.format(0, "second");
};

/** How often the times move on: the finest unit shown is the minute. */
export const TICK = 30_000;

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
