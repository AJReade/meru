import { cn } from "cn";
import { FileIcon, FolderIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { SHOWN_DOWNLOADS } from "../../../core/engines/downloads.ts";
import type { Download } from "../../../core/records/download.ts";
import { downloads } from "../../../shared/channels/downloads.ts";
import { msg } from "../../../shared/msg.ts";
import { Button } from "../../ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../ui/dialog.tsx";
import { relativeTime, useNow } from "./relative-time.ts";
import { useDownloads, useDownloadsClient } from "./use-downloads.ts";

const opens = (item: Download) => item.state === "done" && item.exists;

const statusOf = (item: Download): string | null => {
  if (item.state === "failed") {
    return msg`Failed`;
  }
  if (item.state === "cancelled") {
    return msg`Cancelled`;
  }
  return item.exists ? null : msg`File moved or deleted`;
};

const Row = ({
  item,
  now,
  focusable,
  rowRef,
  onFocus,
  onKeyDown,
}: {
  readonly item: Download;
  readonly now: number;
  readonly focusable: boolean;
  readonly rowRef: (button: HTMLButtonElement | null) => void;
  readonly onFocus: () => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
}) => {
  const client = useDownloadsClient();
  const status = statusOf(item);
  const gone = !opens(item);
  return (
    <li
      className="group hover:bg-accent focus-within:bg-accent flex items-center gap-1 rounded-lg pr-1"
      data-download-id={item.id}
    >
      <button
        aria-disabled={gone}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none"
        onClick={() => {
          if (!gone) {
            void client.invoke(downloads.openFile, { id: item.id });
          }
        }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        ref={rowRef}
        tabIndex={focusable ? 0 : -1}
        type="button"
      >
        <FileIcon
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              "truncate",
              gone && "text-muted-foreground line-through"
            )}
          >
            {item.fileName}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {relativeTime(item.createdAt, now)}
            {status === null ? null : ` · ${status}`}
          </span>
        </span>
      </button>
      {gone ? null : (
        <Button
          aria-label={msg`Show in folder`}
          onClick={() => {
            void client.invoke(downloads.showInFolder, { id: item.id });
          }}
          size="icon-sm"
          tabIndex={-1}
          title={msg`Show in folder`}
          variant="ghost"
        >
          <FolderIcon />
        </Button>
      )}
      <Button
        aria-label={msg`Remove from history`}
        onClick={() => {
          void client.invoke(downloads.remove, { id: item.id });
        }}
        size="icon-sm"
        tabIndex={-1}
        title={msg`Remove from history`}
        variant="ghost"
      >
        <XIcon />
      </Button>
    </li>
  );
};

const STEPS: Readonly<Record<string, (at: number, last: number) => number>> = {
  ArrowDown: (at, last) => Math.min(at + 1, last),
  ArrowUp: (at) => Math.max(at - 1, 0),
  End: (_at, last) => last,
  Home: () => 0,
};

/** The download history over the panes: the newest downloads with how long ago each started, a click opening the file, each row showing it in its folder or taking it off the list, a file that has gone struck through, and Clear all. The arrows and Home and End move through the rows, Enter opens one and Delete takes it off; Escape, a click outside and the window losing focus close it. */
export const Downloads = () => {
  const client = useDownloadsClient();
  const { items } = useDownloads();
  const shown = items.slice(0, SHOWN_DOWNLOADS);
  const now = useNow();
  const [active, setActive] = useState(0);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.min(active, Math.max(shown.length - 1, 0));
  const close = () => {
    client.send(downloads.close, {});
  };

  useEffect(() => {
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("blur", close);
    };
  });

  const keyDown = (event: KeyboardEvent) => {
    const last = shown.length - 1;
    const step = STEPS[event.key];
    if (step !== undefined && last >= 0) {
      event.preventDefault();
      const next = step(at, last);
      setActive(next);
      rows.current[next]?.focus();
      return;
    }
    const item = shown[at];
    if (item === undefined) {
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void client.invoke(downloads.remove, { id: item.id });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (opens(item)) {
        void client.invoke(downloads.openFile, { id: item.id });
      }
    }
  };

  return (
    <Dialog
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          close();
        }
      }}
      open
    >
      <DialogContent
        className="top-[14%] w-[28rem] translate-y-0 gap-0 p-0 sm:max-w-[28rem]"
        initialFocus={() => rows.current[at] ?? true}
        showCloseButton={false}
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <DialogTitle>{msg`Downloads`}</DialogTitle>
          <Button
            disabled={items.length === 0}
            onClick={() => {
              void client.invoke(downloads.clear, {});
            }}
            size="sm"
            variant="ghost"
          >
            {msg`Clear all`}
          </Button>
        </div>
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <p className="font-medium">{msg`No downloads yet`}</p>
            <DialogDescription>
              {msg`Files you download appear here for 30 days.`}
            </DialogDescription>
          </div>
        ) : (
          <ul
            aria-label={msg`Downloads`}
            className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto p-1"
          >
            {shown.map((item, index) => (
              <Row
                focusable={index === at}
                item={item}
                key={item.id}
                now={now}
                onKeyDown={keyDown}
                onFocus={() => {
                  setActive(index);
                }}
                rowRef={(button) => {
                  rows.current[index] = button;
                }}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};
