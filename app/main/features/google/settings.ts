import { z } from "zod";

import { msg } from "../../../shared/msg.ts";
import { defineSetting } from "../../../shared/settings/define.ts";

export const googleSettings = [
  defineSetting("meet.globalShortcuts", {
    default: true,
    description: msg`Let the Meet microphone and camera shortcuts work while another app has focus.`,
    label: msg`System-wide Meet shortcuts`,
    page: "shortcuts",
    restart: false,
    schema: z.boolean(),
    scope: "global",
    section: msg`Google Meet`,
    tier: "free",
  }),
] as const;
