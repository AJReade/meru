// node scripts/entitlement/stub.ts
import { startStub } from "../lib/entitlement-stub.ts";
import type { Stub } from "../lib/entitlement-stub.ts";

/** The license key the development stand-in answers Pro for. */
export const PRO_LICENSE_KEY = "PRO-KEY";

/** The entitlement API's stand-in as a development run uses it: a trial to a device with no license key, Pro to `PRO_LICENSE_KEY`. */
export const startDevStub = async (): Promise<Stub> => {
  const stub = await startStub();
  stub.answer(PRO_LICENSE_KEY, { deviceLimit: 3, kind: "pro" });
  return stub;
};

if (import.meta.main) {
  const stub = await startDevStub();
  console.log(`MERU_ENTITLEMENT_URL=${stub.url}`);
}
