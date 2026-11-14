import { cn } from "cn";
import { DownloadIcon } from "lucide-react";

import { downloads } from "../../../shared/channels/downloads.ts";
import { msg } from "../../../shared/msg.ts";
import { useClient } from "../../client-context.tsx";
import { Button } from "../../ui/button.tsx";
import { useTooltip } from "../commands/use-tooltip.ts";

const BUTTON_SIZE = {
  narrow: "icon",
  titlebar: "icon-sm",
  wide: "sm",
} as const;

/** The button the downloads overlay opens from, beside the launcher's, in the titlebar or at the foot of the sidebar. */
export const DownloadsButton = ({
  place,
}: {
  readonly place: "titlebar" | "narrow" | "wide";
}) => {
  const wide = place === "wide";
  const client = useClient();
  const label = msg`Downloads`;
  const title = useTooltip(label, "downloads.open");
  return (
    <Button
      className={cn(
        "draggable-none text-muted-foreground",
        wide && "w-full justify-start"
      )}
      data-downloads-button=""
      onClick={() => {
        client.send(downloads.open, {});
      }}
      size={BUTTON_SIZE[place]}
      tabIndex={-1}
      title={title}
      variant="ghost"
    >
      <DownloadIcon />
      {wide ? label : null}
    </Button>
  );
};
