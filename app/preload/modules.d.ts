// Vite hands a file imported with `?raw` over as its text, which is how a test reads a fixture.
declare module "*.html?raw" {
  const text: string;
  export default text;
}

// Vite gathers every file a pattern matches at build time, which is how a test reads a corpus of fixtures without naming each.
interface ImportMeta {
  glob: (
    pattern: string,
    options: { eager: true; import: "default"; query: "?raw" }
  ) => Record<string, string>;
}
