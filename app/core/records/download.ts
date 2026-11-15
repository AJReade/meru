import { z } from "zod";

import { idSchema } from "./id.ts";

/** How a download ended: saved whole, stopped by the network or the disk, or called off before it finished. */
const downloadStateSchema = z.enum(["done", "failed", "cancelled"]);

/** A download the history keeps: where it went, when it started, how it ended, and whether its file was there when last looked for. */
export const downloadSchema = z.object({
  createdAt: z.number(),
  exists: z.boolean(),
  fileName: z.string(),
  filePath: z.string(),
  id: idSchema,
  state: downloadStateSchema,
});

export type Download = z.infer<typeof downloadSchema>;

/** A download under way: what it will be called, and how much of it has arrived of how much, `total` being zero while the server has not said how big it is. */
export const activeDownloadSchema = z.object({
  fileName: z.string(),
  id: idSchema,
  received: z.number(),
  total: z.number(),
});

export type ActiveDownload = z.infer<typeof activeDownloadSchema>;
