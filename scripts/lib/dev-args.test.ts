import { describe, expect, it } from "vitest";

import { splitArgs } from "./dev-args.ts";

describe(splitArgs, () => {
  it("claims --profile and --background and passes the rest to Electron", () => {
    expect(
      splitArgs(
        ["--profile", "work", "--inspect", "--background", "--disable-gpu"],
        {}
      )
    ).toStrictEqual({
      background: true,
      electronArgs: ["--inspect", "--disable-gpu"],
      entitlement: "free",
      profile: "work",
    });
    expect(splitArgs(["--profile=home"], {}).profile).toBe("home");
  });

  it("runs in the background when the environment asks", () => {
    expect(splitArgs([], { MERU_BACKGROUND: "1" }).background).toBeTruthy();
    expect(splitArgs([], {}).background).toBeFalsy();
  });

  it("takes --entitlement in either form, free when it is absent", () => {
    expect(splitArgs([], {}).entitlement).toBe("free");
    expect(splitArgs(["--entitlement=pro"], {}).entitlement).toBe("pro");
    expect(
      splitArgs(["--entitlement", "trial", "--profile", "a", "--inspect"], {})
    ).toStrictEqual({
      background: false,
      electronArgs: ["--inspect"],
      entitlement: "trial",
      profile: "a",
    });
  });

  it("refuses an --entitlement it does not know, a missing one or a second one", () => {
    const refusal = "--entitlement takes one of free, trial, pro, once";
    expect(() => splitArgs(["--entitlement=team"], {})).toThrow(refusal);
    expect(() => splitArgs(["--entitlement"], {})).toThrow(refusal);
    expect(() =>
      splitArgs(["--entitlement=trial", "--entitlement", "pro"], {})
    ).toThrow(refusal);
  });

  it("refuses --profile without a name", () => {
    expect(() => splitArgs(["--profile"], {})).toThrow(
      "--profile needs a name"
    );
  });
});
