import { DisposableStore } from "../../../core/disposable.ts";
import type { AppEvents } from "../../../core/events.ts";
import type { LogPort } from "../../../core/log.ts";
import type { Unsubscribe } from "../../../core/ports.ts";
import type { Tab } from "../../../core/records/tab.ts";
import { ok } from "../../../core/result.ts";
import type { IpcRegistrar } from "../../../shared/channels/define.ts";
import { google, googlePushes } from "../../../shared/channels/google.ts";
import type { MeetToggle } from "../../../shared/channels/google.ts";
import {
  contentSurfaceArgument,
  googleSurface,
} from "../../../shared/channels/surfaces.ts";
import type { CommandRegistrar } from "../../../shared/commands/define.ts";
import type { ContentPage } from "../stage/tab-views.ts";
import { googleCommands } from "./commands.ts";

export interface GoogleOptions {
  readonly registrar: IpcRegistrar;
  readonly commands: CommandRegistrar;
  /** The built Google preload. */
  readonly preload: string;
  readonly log: LogPort;
  readonly events: Pick<AppEvents, "on">;
}

/** The pages of the Google apps other than Gmail: their preload, and Meet's microphone and camera as commands. */
export class Google {
  readonly #options: GoogleOptions;
  readonly #disposables = new DisposableStore();
  /** Meet's pages, the one focused last at the end, which the toggles act on. */
  readonly #meets: { readonly tabId: string; readonly contentsId: number }[] =
    [];

  constructor(options: GoogleOptions) {
    this.#options = options;
  }

  start(): void {
    const toggle = (which: MeetToggle) => ({
      run: () => {
        const meet = this.#meets.at(-1);
        if (meet !== undefined) {
          this.#options.registrar.push(
            meet.contentsId,
            googlePushes.meetToggle,
            {
              toggle: which,
            }
          );
        }
        return ok(undefined);
      },
      when: () => this.#meets.length > 0,
    });
    this.#disposables.add(
      this.#options.events.on("tab.focused", ({ tabId }) => {
        const at = this.#meets.findIndex((meet) => meet.tabId === tabId);
        const [focused] = at === -1 ? [] : this.#meets.splice(at, 1);
        if (focused !== undefined) {
          this.#meets.push(focused);
        }
      }),
      this.#options.registrar.register(google, {
        failed: ({ message, stack, what }, { profileId }) => {
          this.#options.log.error("A Google page's preload failed", {
            error: { message, name: what, stack },
            profileId,
          });
          return ok(undefined);
        },
      }),
      this.#options.commands.register(googleCommands, {
        toggleMeetCamera: toggle("camera"),
        toggleMeetMicrophone: toggle("microphone"),
      })
    );
  }

  dispose(): void {
    this.#disposables.dispose();
  }

  /** The preload and surface of a Google app's tab other than Gmail. */
  page(tab: Tab): ContentPage {
    return {
      arguments: [contentSurfaceArgument("google")],
      attach: (contentsId): Unsubscribe => {
        const unassign = this.#options.registrar.assign(
          contentsId,
          googleSurface,
          tab.profileId
        );
        if (tab.appId === "meet") {
          this.#meets.push({ contentsId, tabId: tab.id });
        }
        return () => {
          unassign();
          const index = this.#meets.findIndex(
            (meet) => meet.contentsId === contentsId
          );
          if (index !== -1) {
            this.#meets.splice(index, 1);
          }
        };
      },
      preload: this.#options.preload,
    };
  }
}
