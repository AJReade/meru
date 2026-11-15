import { cn } from "cn";
import { FileIcon, FolderIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { SHOWN_DOWNLOADS } from "../../../core/engines/downloads.ts";
import type {
  ActiveDownload,
  Download,
} from "../../../core/records/download.ts";
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
  onRemove,
}: {
  readonly item: Download;
  readonly now: number;
  readonly focusable: boolean;
  readonly rowRef: (button: HTMLButtonElement | null) => void;
  readonly onFocus: () => void;
  readonly onRemove: () => void;
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
        onClick={onRemove}
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

/** A download still arriving: its name, how far it has got, and a button that calls it off. Its size is unknown until the server says, which leaves the bar undetermined. */
const ActiveRow = ({ item }: { readonly item: ActiveDownload }) => {
  const client = useDownloadsClient();
  const share = item.total > 0 ? item.received / item.total : null;
  const percent = share === null ? null : Math.round(share * 100);
  return (
    <li
      className="flex items-center gap-1 rounded-lg pr-1"
      data-active-id={item.id}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5">
        <FileIcon
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate">{item.fileName}</span>
          <progress
            aria-label={msg`Download progress`}
            className="bg-muted h-1 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-current"
            max={100}
            value={percent ?? undefined}
          />
          <span className="text-muted-foreground truncate text-xs">
            {percent === null ? msg`Downloading…` : `${percent}%`}
          </span>
        </span>
      </span>
      <Button
        aria-label={msg`Cancel download`}
        onClick={() => {
          void client.invoke(downloads.cancel, { id: item.id });
        }}
        size="icon-sm"
        title={msg`Cancel download`}
        variant="ghost"
      >
        <XIcon />
      </Button>
    </li>
  );
};

const STEPS = {
  ArrowDown: (at: number, last: number) => Math.min(at + 1, last),
  ArrowUp: (at: number) => Math.max(at - 1, 0),
  End: (_at: number, last: number) => last,
  Home: () => 0,
} as const;

const isStep = (key: string): key is keyof typeof STEPS =>
  Object.hasOwn(STEPS, key);

/** The downloads over the panes: those still arriving with their progress and a button to call each off, then the newest finished downloads with how long ago each started, a click opening the file, each row showing it in its folder or taking it off the list, a file that has gone struck through, and Clear all. The arrows and Home and End move through the rows, Enter opens one and Delete takes it off; Escape, a click outside and the window losing focus close it. */
export const Downloads = () => {
  const client = useDownloadsClient();
  const { active: running, items } = useDownloads();
  const shown = items.slice(0, SHOWN_DOWNLOADS);
  const now = useNow();
  const [active, setActive] = useState(0);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.min(active, Math.max(shown.length - 1, 0));
  const close = () => {
    client.send(downloads.close, {});
  };
  // The row goes with the focus it holds, so the focus moves first to the row that takes its place, or the one before the last.
  const remove = (index: number) => {
    const item = shown[index];
    if (item === undefined) {
      return;
    }
    const next = index < shown.length - 1 ? index + 1 : index - 1;
    rows.current[next]?.focus();
    setActive(Math.min(index, next));
    void client.invoke(downloads.remove, { id: item.id });
  };

  useEffect(() => {
    const onBlur = () => {
      client.send(downloads.close, {});
    };
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
    };
  }, [client]);

  const keyDown = (event: KeyboardEvent) => {
    if (!rows.current.some((row) => row !== null && row === event.target)) {
      return;
    }
    const last = shown.length - 1;
    if (isStep(event.key) && last >= 0) {
      event.preventDefault();
      const next = STEPS[event.key](at, last);
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
      remove(at);
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
        onKeyDown={keyDown}
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
        {running.length === 0 ? null : (
          <ul
            aria-label={msg`Downloads in progress`}
            className="flex flex-col gap-0.5 border-b p-1"
          >
            {running.map((item) => (
              <ActiveRow item={item} key={item.id} />
            ))}
          </ul>
        )}
        {shown.length === 0 && running.length === 0 ? (
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
                onFocus={() => {
                  setActive(index);
                }}
                onRemove={() => {
                  remove(index);
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
