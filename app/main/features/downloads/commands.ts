import { defineCommands } from "../../../shared/commands/define.ts";
import { msg } from "../../../shared/msg.ts";

// 3.x's key for its download history.
export const downloadsCommands = defineCommands(
  "downloads",
  {
    open: {
      label: msg`Downloads`,
      menu: { order: 13, section: "view" },
      shortcut: { default: "CmdOrCtrl+Alt+L" },
    },
  },
  { label: msg`Downloads`, order: 38 }
);
