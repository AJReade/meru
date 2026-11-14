interface HtmlPolicy {
  readonly createHTML: (input: string) => string;
}

interface PolicyFactory {
  readonly createPolicy: (name: string, rules: HtmlPolicy) => HtmlPolicy;
}

// TypeScript's DOM library does not declare Trusted Types, so the factory is told apart by its one method.
const isPolicyFactory = (value: unknown): value is PolicyFactory =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "createPolicy") === "function";

let policy: HtmlPolicy | undefined;

/** Parses markup into a document of its own, which runs no script and loads nothing. Gmail requires Trusted Types and the preload's world inherits that, so the markup passes through a policy that leaves it unchanged; should Gmail's policy ever allowlist names, `createPolicy` throws and the caller's failure path reports it. */
export const parseHtml = (html: string): Document => {
  const factory: unknown = Reflect.get(globalThis, "trustedTypes");
  if (policy === undefined && isPolicyFactory(factory)) {
    policy = factory.createPolicy("meru-clipped-messages", {
      createHTML: (input) => input,
    });
  }
  return new DOMParser().parseFromString(
    policy?.createHTML(html) ?? html,
    "text/html"
  );
};
