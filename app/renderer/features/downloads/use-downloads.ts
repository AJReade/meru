import { createContext } from "react";

import {
  downloads,
  downloadsPushes,
} from "../../../shared/channels/downloads.ts";
import type { DownloadsSnapshot } from "../../../shared/channels/downloads.ts";
import type { DownloadsSurface } from "../../../shared/channels/surfaces.ts";
import { defineClientContext } from "../../client-context.tsx";
import { syncedStore, useWholeStore } from "../../store.ts";
import type { Store, SyncSource } from "../../store.ts";

const downloadsClient = defineClientContext<DownloadsSurface>("downloads");

/** Gives the downloads overlay's page its client, on the downloads surface. */
export const DownloadsClientProvider = downloadsClient.Provider;

export const useDownloadsClient = downloadsClient.use;

const NO_DOWNLOADS: DownloadsSnapshot = { items: [] };

/** The page's copy of the download history, empty until main first answers. */
export const createDownloadsStore = (
  client: SyncSource<
    (typeof downloads.snapshot)["result"],
    (typeof downloadsPushes.changed)["payload"]
  >
): Store<DownloadsSnapshot> =>
  syncedStore(
    client,
    downloads.snapshot,
    downloadsPushes.changed,
    NO_DOWNLOADS
  );

export const DownloadsContext = createContext<
  Store<DownloadsSnapshot> | undefined
>(undefined);

/** The download history as main last pushed it, newest first. */
export const useDownloads = (): DownloadsSnapshot =>
  useWholeStore(DownloadsContext, "useDownloads");
