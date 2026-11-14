import { act } from "react";
import { describe, expect, it } from "vitest";

import { downloads } from "../../../shared/channels/downloads.ts";
import { settings } from "../../../shared/channels/settings.ts";
import { answer, mountSettings, settle } from "../../testing.tsx";
import { DownloadFolder } from "./downloads-page.tsx";

const mount = (location: string | null) =>
  mountSettings(<DownloadFolder />, [
    answer(downloads.defaultFolder, "/Users/me/Downloads"),
    answer(downloads.chooseFolder, null),
    answer(settings.snapshot, {
      layers: {
        global: location === null ? {} : { "downloads.location": location },
        profiles: {},
      },
      locked: {},
    }),
  ]);

const folder = () =>
  document.querySelector("[data-download-folder]")?.textContent;

describe(DownloadFolder, () => {
  it("names the system's Downloads folder until another is chosen, then that one", () => {
    mount(null);
    const first = folder();
    act(() => {
      document.body.replaceChildren();
    });
    mount("/Volumes/Files");
    expect([first, folder()]).toStrictEqual([
      "/Users/me/Downloads",
      "/Volumes/Files",
    ]);
  });

  it("asks main for the folder picker", async () => {
    const { sentOn } = mount(null);
    act(() => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Choose folder…")
        ?.click();
    });
    await settle();
    expect(sentOn(downloads.chooseFolder)).toStrictEqual([{}]);
  });
});
