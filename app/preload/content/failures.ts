import { messageOf } from "../../core/values.ts";
import type { ContentFailure } from "../../shared/channels/content.ts";

/** How many of its own failures a page load reports; past them a preload that fails in a loop says nothing more. */
export const FAILURES_PER_PAGE = 5;

/** Turns what a preload caught into the report main logs, sending at most `FAILURES_PER_PAGE` of them. */
export const failureReporter = (
  send: (failure: ContentFailure) => void
): ((what: string, error: unknown) => void) => {
  let sent = 0;
  return (what, error) => {
    if (sent >= FAILURES_PER_PAGE) {
      return;
    }
    sent += 1;
    send({
      message: messageOf(error).slice(0, 1000),
      what,
      ...(error instanceof Error && error.stack !== undefined
        ? { stack: error.stack.slice(0, 4000) }
        : {}),
    });
  };
};
