import { DisposableStore } from "../../core/disposable.ts";
import { gmail, gmailPushes } from "../../shared/channels/gmail.ts";
import type { GmailPageSettings } from "../../shared/channels/gmail.ts";
import type { GmailSurface } from "../../shared/channels/surfaces.ts";
import type { Bridge } from "../content/bridge-port.ts";
import { failureReporter } from "../content/failures.ts";
import { DomScheduler } from "../content/scheduler.ts";
import { StyleLayers } from "../content/styles.ts";
import type { GmailFeature, PageLocation } from "./feature.ts";
import { gmailFeatures } from "./features/index.ts";
import { GmailRpc } from "./rpc.ts";
import type { GmailHttp } from "./rpc.ts";

export interface GmailAppOptions {
  readonly document: Document;
  readonly bridge: Bridge<GmailSurface>;
  readonly location: PageLocation;
  /** Gmail's own endpoints, which only a page's requests carry the credentials for. */
  readonly http: GmailHttp;
  /** The page's cookies, which carry Gmail's action token. */
  readonly cookie: () => string;
  readonly features?: readonly GmailFeature[];
  readonly now?: () => number;
  readonly grace?: number;
  readonly requestFrame?: (task: () => void) => void;
}

export interface GmailApp {
  readonly dispose: () => void;
}

/** The Gmail preload: it reads the settings main holds before the page paints, applies each feature the address allows, and applies them again whenever main says they changed. */
export const startGmail = (options: GmailAppOptions): GmailApp => {
  const { bridge, document, location } = options;
  const features = options.features ?? gmailFeatures;
  const styles = new StyleLayers(document);
  const fail = failureReporter((failure) => {
    bridge.send(gmail.failed, failure);
  });
  const first = bridge.sendSync(gmail.settings, {});
  if (!first.ok) {
    fail(
      "readSettings",
      new Error(`${first.error.kind}: ${first.error.message}`)
    );
    return {
      dispose: () => {
        styles.dispose();
      },
    };
  }

  const scheduler = new DomScheduler({
    document,
    fail: (id, error) => {
      fail(`entry ${id}`, error);
    },
    grace: options.grace,
    now: options.now,
    report: (selector) => {
      bridge.send(gmail.selectorMiss, { selector });
    },
    requestFrame: options.requestFrame,
  });
  const asked = new Set<string>();
  let applied = new DisposableStore();
  let current = first.value;
  const rpc = new GmailRpc({
    cookie: options.cookie,
    http: options.http,
    mailbox: () => current.mailbox,
    markup: () => document.documentElement.outerHTML,
    now: options.now ?? Date.now,
    signIn: () => current.signIn,
  });

  const apply = (settings: GmailPageSettings) => {
    current = settings;
    applied.dispose();
    const store = new DisposableStore();
    applied = store;
    const underMailbox = location.href().startsWith(settings.mailbox);
    for (const feature of features) {
      if (feature.anywhere !== true && !underMailbox) {
        styles.remove(feature.id);
        continue;
      }
      try {
        feature.apply({
          bridge,
          document,
          location,
          rpc,
          once: (key) => {
            const asking = !asked.has(key);
            asked.add(key);
            return asking;
          },
          scheduler,
          settings,
          style: (css) => {
            styles.set(feature.id, css);
          },
          undo: (disposer) => {
            store.add(disposer);
          },
        });
      } catch (error) {
        fail(`feature ${feature.id}`, error);
      }
    }
    bridge.send(gmail.settingsAck, { version: settings.version });
  };

  if (location.href().startsWith(first.value.mailbox)) {
    for (const { entry } of features) {
      if (entry !== undefined) {
        scheduler.register(entry);
      }
    }
  }
  apply(first.value);
  const unfollow = bridge.on(gmailPushes.settingsChanged, apply);
  scheduler.start();

  return {
    dispose: () => {
      unfollow();
      applied.dispose();
      scheduler.dispose();
      styles.dispose();
    },
  };
};
