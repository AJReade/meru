export const DEV_ENTITLEMENTS = ["free", "trial", "pro"] as const;

export type DevEntitlement = (typeof DEV_ENTITLEMENTS)[number];

export interface DevArgs {
  readonly profile: string | undefined;
  readonly background: boolean;
  readonly entitlement: DevEntitlement;
  /** Everything the dev script does not claim, passed to Electron as typed. */
  readonly electronArgs: string[];
}

const isDevEntitlement = (value: string): value is DevEntitlement =>
  DEV_ENTITLEMENTS.some((allowed) => allowed === value);

const ENTITLEMENT_ERROR = `--entitlement takes one of ${DEV_ENTITLEMENTS.join(", ")}, once`;

export const splitArgs = (
  args: readonly string[],
  env = process.env
): DevArgs => {
  let profile: string | undefined;
  let background = env.MERU_BACKGROUND === "1";
  let entitlement: DevEntitlement | undefined;
  const electronArgs: string[] = [];

  const takeEntitlement = (value: string | undefined) => {
    if (
      entitlement !== undefined ||
      value === undefined ||
      !isDevEntitlement(value)
    ) {
      throw new Error(ENTITLEMENT_ERROR);
    }
    entitlement = value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--background") {
      background = true;
    } else if (arg === "--profile") {
      index += 1;
      profile = args[index];
      if (profile === undefined) {
        throw new Error("--profile needs a name");
      }
    } else if (arg?.startsWith("--profile=") === true) {
      profile = arg.slice("--profile=".length);
    } else if (arg === "--entitlement") {
      index += 1;
      takeEntitlement(args[index]);
    } else if (arg?.startsWith("--entitlement=") === true) {
      takeEntitlement(arg.slice("--entitlement=".length));
    } else if (arg !== undefined) {
      electronArgs.push(arg);
    }
  }

  return {
    background,
    electronArgs,
    entitlement: entitlement ?? "free",
    profile,
  };
};
