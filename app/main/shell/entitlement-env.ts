import { ENTITLEMENT_URL } from "../../core/entitlement/api.ts";
import type { LifecyclePort } from "../../core/ports.ts";
import type { Entitlement } from "../features/entitlement/index.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The API a run asks for its token: `MERU_ENTITLEMENT_URL` only in a run from the repository, so a packaged app's environment cannot point it elsewhere. */
export const entitlementUrl = (
  lifecycle: Pick<LifecyclePort, "packaged">,
  env: Env
): string =>
  lifecycle.packaged
    ? ENTITLEMENT_URL
    : (env.MERU_ENTITLEMENT_URL ?? ENTITLEMENT_URL);

/** In a run from the repository, makes `MERU_LICENSE_KEY` the license key, removing a stored one when it is unset, as `pnpm dev:pro` and a plain `pnpm dev` after it expect; a packaged app keeps the key it stored. */
export const applyLicenseKeyFromEnv = <K>(
  entitlement: Pick<Entitlement<K>, "setLicenseKey">,
  lifecycle: Pick<LifecyclePort, "packaged">,
  env: Env
): void => {
  if (!lifecycle.packaged) {
    entitlement.setLicenseKey(env.MERU_LICENSE_KEY ?? null);
  }
};
