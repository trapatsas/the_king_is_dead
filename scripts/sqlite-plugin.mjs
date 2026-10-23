import { build } from "vite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Keep the server-only graph out of the browser and Vite's config loader.
 * Development uses Vite's TS loader; local preview uses a built Node bundle. */
export function sqliteCapturePlugin() {
  let needsBackend = false;
  const install = (server, load) => {
    let instance;
    let factory;
    const close = () => {
      const service = instance;
      instance = undefined;
      factory = undefined;
      service?.close();
    };
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/api/")) {
        next();
        return;
      }
      try {
        const module = await load();
        if (factory !== module.openStorage) {
          close();
          instance = module.openStorage();
          factory = module.openStorage;
        }
        await instance.handler(req, res, next);
      } catch {
        try {
          close();
        } catch {
          /* Preserve the storage-unavailable response. */
        }
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "SQLite storage unavailable" }));
      }
    });
    server.httpServer?.once("close", () => {
      close();
    });
  };
  return {
    name: "king-sqlite-capture",
    configResolved(config) {
      needsBackend = config.command === "build" && !config.build.ssr;
    },
    configureServer(server) {
      install(server, () => server.ssrLoadModule("/src/server/api.ts"));
    },
    configurePreviewServer(server) {
      install(
        server,
        () => import(pathToFileURL(resolve("dist-server/api.mjs")).href),
      );
    },
    async closeBundle() {
      if (!needsBackend) return;
      await build({
        configFile: false,
        logLevel: "warn",
        build: {
          ssr: "src/server/api.ts",
          outDir: "dist-server",
          rollupOptions: { output: { entryFileNames: "api.mjs" } },
        },
      });
    },
  };
}
