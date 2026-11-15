import { chromeSurface } from "../../shared/channels/surfaces.ts";
import { createClient } from "../client.ts";
import { DownloadsButton } from "../features/downloads/downloads-button.tsx";
import { LauncherButton } from "../features/launcher/launcher-button.tsx";
import { Sidebar } from "../features/sidebar/sidebar.tsx";
import { Dividers } from "../features/stage/dividers.tsx";
import { Titlebar } from "../features/titlebar/titlebar.tsx";
import { chromeStores, mountPage } from "../page.tsx";

import "../ui/globals.css";

const client = createClient(window, chromeSurface);

mountPage(
  client,
  chromeStores(
    client,
    <>
      <div className="on-chrome bg-chrome text-chrome-foreground flex h-full flex-col">
        <Titlebar
          trailing={
            <>
              <DownloadsButton place="titlebar" />
              <LauncherButton place="titlebar" />
            </>
          }
        />
        <div className="flex min-h-0 flex-1">
          <Sidebar
            foot={(size) => (
              <>
                <LauncherButton place={size} />
                <DownloadsButton place={size} />
              </>
            )}
          />
        </div>
      </div>
      <Dividers />
    </>
  )
);
