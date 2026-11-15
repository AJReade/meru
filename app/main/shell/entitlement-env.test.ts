import { describe, expect, it } from "vitest";

import { ENTITLEMENT_URL } from "../../core/entitlement/api.ts";
import { AppEvents } from "../../core/events.ts";
import { FakeClock } from "../../test/fakes/clock.ts";
import { FakeEntitlementApi } from "../../test/fakes/entitlement-api.ts";
import { FakeFs } from "../../test/fakes/fs.ts";
import { fakeIds } from "../../test/fakes/ids.ts";
import { FakeLifecycle } from "../../test/fakes/lifecycle.ts";
import { FakeLog } from "../../test/fakes/log.ts";
import { FakeOnline } from "../../test/fakes/online.ts";
import { FakePower } from "../../test/fakes/power.ts";
import {
  ENTITLEMENT_FILE,
  Entitlement,
} from "../features/entitlement/index.ts";
import { applyLicenseKeyFromEnv, entitlementUrl } from "./entitlement-env.ts";

const LOCAL = "http://127.0.0.1:4000/entitlement/issue";

/** The license key the API is first asked about, over a stored key and the environment `env`. */
const keyAsked = async (
  packaged: boolean,
  stored: string | null,
  env: Record<string, string>
) => {
  const lifecycle = new FakeLifecycle("darwin", packaged);
  const api = new FakeEntitlementApi();
  const entitlement = new Entitlement({
    api,
    clock: new FakeClock(),
    events: new AppEvents(),
    fs: new FakeFs({
      [ENTITLEMENT_FILE]: JSON.stringify({
        data: {
          deviceId: "device-1",
          lastAnswer: null,
          licenseKey: stored,
          rejected: null,
          token: null,
        },
        version: 1,
      }),
    }),
    ids: fakeIds("device-"),
    keys: new Map<string, Parameters<typeof crypto.subtle.verify>[1]>(),
    lifecycle,
    log: new FakeLog().scoped("entitlement"),
    online: new FakeOnline(true),
    power: new FakePower(),
    subtle: crypto.subtle,
  });
  await entitlement.open();
  applyLicenseKeyFromEnv(entitlement, lifecycle, env);
  entitlement.start();
  await expect.poll(() => api.requests.length).toBe(1);
  entitlement.dispose();
  return api.requests[0]?.licenseKey;
};

describe(entitlementUrl, () => {
  it("takes MERU_ENTITLEMENT_URL only in a run from the repository", () => {
    const env = { MERU_ENTITLEMENT_URL: LOCAL };
    expect(entitlementUrl(new FakeLifecycle("darwin", false), env)).toBe(LOCAL);
    expect(entitlementUrl(new FakeLifecycle("darwin", false), {})).toBe(
      ENTITLEMENT_URL
    );
    expect(entitlementUrl(new FakeLifecycle("darwin", true), env)).toBe(
      ENTITLEMENT_URL
    );
  });
});

describe(applyLicenseKeyFromEnv, () => {
  it("asks for MERU_LICENSE_KEY in a run from the repository", async () => {
    await expect(
      keyAsked(false, null, { MERU_LICENSE_KEY: "PRO-KEY" })
    ).resolves.toBe("PRO-KEY");
  });

  it("removes a stored key in a run from the repository without the variable", async () => {
    await expect(keyAsked(false, "OLD-KEY", {})).resolves.toBeNull();
  });

  it("keeps the stored key in a packaged app, whatever the environment holds", async () => {
    await expect(
      keyAsked(true, "OLD-KEY", { MERU_LICENSE_KEY: "PRO-KEY" })
    ).resolves.toBe("OLD-KEY");
  });
});
