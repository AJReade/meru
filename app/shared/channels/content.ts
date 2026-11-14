import { z } from "zod";

/** What a content preload says of a failure of its own: what it was doing and the error, which main logs; a page load reports only its first few. */
export const contentFailureSchema = z.object({
  what: z.string().min(1).max(100),
  message: z.string().max(1000),
  stack: z.string().max(4000).optional(),
});

export type ContentFailure = z.infer<typeof contentFailureSchema>;
