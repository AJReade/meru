import type { Unsubscribe } from "../../core/ports.ts";
import type {
  GmailPageSettings,
  GmailStyles,
} from "../../shared/channels/gmail.ts";
import type { GmailSurface } from "../../shared/channels/surfaces.ts";
import type { Bridge } from "../content/bridge-port.ts";
import type { DomScheduler } from "../content/scheduler.ts";
import type { SelectorEntry } from "../content/selectors.ts";
import { cssOf } from "../content/styles.ts";
import type { StyleRule } from "../content/styles.ts";
import type { PageCanvas } from "./dark-theme/canvas.ts";
import type { GmailHttp, GmailRpc } from "./rpc.ts";

/** Where the page is and how to move it, which Gmail navigates itself. */
export interface PageLocation {
  readonly href: () => string;
  readonly setHash: (hash: string) => void;
}

export interface FeatureContext {
  readonly document: Document;
  readonly settings: GmailPageSettings;
  readonly bridge: Bridge<GmailSurface>;
  readonly scheduler: DomScheduler;
  readonly location: PageLocation;
  /** The one module that speaks Gmail's action endpoint, which lives as long as the page load. */
  readonly rpc: GmailRpc;
  /** Gmail's own pages, fetched in the page's session. */
  readonly http: GmailHttp;
  /** A 2D canvas, which samples an image the page shows. */
  readonly canvas: PageCanvas;
  /** Replaces this feature's style sheet, or takes it down when the CSS is empty. */
  readonly style: (css: string) => void;
  /** True the first time this page load asks for the key, so a report main needs once is sent once. */
  readonly once: (key: string) => boolean;
  /** Takes what the feature attached, which is undone before it is applied again. */
  readonly undo: (disposer: Unsubscribe) => void;
}

export interface GmailFeature {
  /** Names its style sheet and the `gmail.<name>` setting it is drawn from. */
  readonly id: string;
  /** Whether it runs wherever the page is, rather than only under the mailbox. */
  readonly anywhere?: boolean;
  /** Watched once per page load under the mailbox, whatever the settings, so its miss is told once. */
  readonly entry?: SelectorEntry;
  /** Applied as the preload starts and again on every settings change; whatever it attaches goes to the context's `undo`. */
  readonly apply: (context: FeatureContext) => void;
}

/** A feature that is a style sheet one of the `styles` settings turns on, and an entry watching the markers its rules hang off. */
export const cssFeature = (declaration: {
  id: keyof GmailStyles;
  rules: readonly StyleRule[];
  entry?: SelectorEntry;
}): GmailFeature => ({
  apply: ({ settings, style }) => {
    style(settings.styles[declaration.id] ? cssOf(declaration.rules) : "");
  },
  entry: declaration.entry,
  id: declaration.id,
});
