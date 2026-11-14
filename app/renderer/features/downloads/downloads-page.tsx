import { useMemo } from "react";

import { downloads } from "../../../shared/channels/downloads.ts";
import { msg } from "../../../shared/msg.ts";
import { Button } from "../../ui/button.tsx";
import type { PageContent } from "../settings/page-content.ts";
import { SettingsSection } from "../settings/settings-section.tsx";
import { useSetting } from "../settings/use-setting.ts";
import { useSettingsClient } from "../settings/use-settings-client.ts";

/** The folder downloads go to, the system's Downloads folder until the user picks another with the system's folder picker. */
export const DownloadFolder = () => {
  const client = useSettingsClient();
  const location = useSetting("downloads.location");
  const defaultFolder = useMemo(() => {
    const answered = client.sendSync(downloads.defaultFolder, {});
    return answered.ok ? answered.value : "";
  }, [client]);
  return (
    <SettingsSection>
      <div
        className="flex items-center justify-between gap-6 p-4"
        data-setting="downloads.location"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm">{msg`Download folder`}</span>
          <span
            className="text-muted-foreground truncate text-sm"
            data-download-folder=""
            title={location ?? defaultFolder}
          >
            {location ?? defaultFolder}
          </span>
        </div>
        <Button
          className="shrink-0"
          onClick={() => {
            void client.invoke(downloads.chooseFolder, {});
          }}
          variant="outline"
        >
          {msg`Choose folder…`}
        </Button>
      </div>
    </SettingsSection>
  );
};

export const downloadsContent: PageContent = {
  Content: DownloadFolder,
  page: "downloads",
};
