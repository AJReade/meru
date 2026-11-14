import { z } from "zod";

import { idSchema } from "./id.ts";

/** How a download ended: saved whole, stopped by the network or the disk, or called off before it finished. */
export const downloadStateSchema = z.enum(["done", "failed", "cancelled"]);

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
