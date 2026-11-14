import { once } from "node:events";
import { createServer } from "node:http";

export interface GoogleStub {
  /** The page every Google pane shows, as the app takes it in `MERU_GOOGLE_URL`. */
  readonly url: string;
  readonly stop: () => Promise<void>;
}

// A page the preload's patch reaches as Calendar's own would: one notification raised through the constructor and one through a service worker's registration, which is why the worker is served beside it. Loopback is a secure context, so Chromium registers it.
const PAGE = `<!doctype html>
<title>Calendar</title>
<script>
  new Notification("Standup", { body: "Starts in ten minutes" });
  navigator.serviceWorker.register("/sw.js").then(async (registration) => {
    await navigator.serviceWorker.ready;
    await registration.showNotification("Lunch", { body: "At noon" });
  });
</script>
`;

/** A loopback stand-in for a Google app's page, which raises two notifications as it loads. */
export const startGoogleStub = async (): Promise<GoogleStub> => {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://stub");
    if (pathname === "/sw.js") {
      response.writeHead(200, { "content-type": "text/javascript" }).end("");
    } else if (pathname === "/") {
      response.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The Google stub has no port");
  }
  return {
    stop: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
    url: `http://127.0.0.1:${address.port}/`,
  };
};
