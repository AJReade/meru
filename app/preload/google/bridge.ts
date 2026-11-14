import { webFrame } from "electron";

/**
 * The "Docs Offline" extension injects a script that does nothing but set these globals, which tell Docs the clipboard permissions it has; without them the Edit menu's cut, copy and paste only offer to install the extension. The pane grants the clipboard itself, so only the globals are missing, and they have to be in the page's own world, which is the one thing a content preload writes there.
 */
const markDocsExtensionInstalled = () => {
  Reflect.set(window, "_docs_chrome_extension_exists", true);
  Reflect.set(window, "_docs_chrome_extension_permissions", [
    "clipboardRead",
    "clipboardWrite",
  ]);
};

export const grantDocsClipboard = async (): Promise<void> => {
  await webFrame.executeJavaScript(
    `(${markDocsExtensionInstalled.toString()})()`
  );
};
