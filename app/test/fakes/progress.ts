import type { DownloadProgress } from "../../core/engines/downloads.ts";
import type { ProgressPort } from "../../core/ports.ts";

export class FakeProgress implements ProgressPort {
  /** What the bar shows now. */
  shown: DownloadProgress = { kind: "none" };

  readonly set = (progress: DownloadProgress) => {
    this.shown = progress;
  };
}
