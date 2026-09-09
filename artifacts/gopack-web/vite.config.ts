import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "node:fs";

const isProd = process.env.NODE_ENV === "production";
const isReplit = process.env.REPL_ID !== undefined;

// PORT and BASE_PATH are only required in dev (Replit workflow injects them).
// Vercel builds run with NODE_ENV=production and don't need them.
const port = Number(process.env.PORT || 3000);
const basePath = process.env.BASE_PATH || "/";
const appleAppSiteAssociationPath = path.resolve(
  import.meta.dirname,
  "public/.well-known/apple-app-site-association"
);

const appleAppSiteAssociationPlugin = {
  name: "apple-app-site-association",
  configureServer(server: { middlewares: { use: (handler: Function) => void } }) {
    server.middlewares.use(serveAppleAppSiteAssociation);
  },
  configurePreviewServer(server: { middlewares: { use: (handler: Function) => void } }) {
    server.middlewares.use(serveAppleAppSiteAssociation);
  },
};

function serveAppleAppSiteAssociation(
  request: { url?: string },
  response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: Buffer) => void },
  next: () => void
) {
  const pathname = request.url?.split("?")[0];
  if (!pathname?.endsWith("/.well-known/apple-app-site-association")) {
    next();
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "public, max-age=3600");
  response.end(readFileSync(appleAppSiteAssociationPath));
}

if (!isProd && !process.env.PORT) {
  throw new Error("PORT environment variable is required in development.");
}

const replitPlugins =
  !isProd && isReplit
    ? [
        await import("@replit/vite-plugin-runtime-error-modal").then((m) =>
          m.default()
        ),
        await import("@replit/vite-plugin-cartographer").then((m) =>
          m.cartographer({
            root: path.resolve(import.meta.dirname, ".."),
          })
        ),
        await import("@replit/vite-plugin-dev-banner").then((m) =>
          m.devBanner()
        ),
      ]
    : [];

export default defineConfig({
  base: basePath,
  // The path router rejects requests into node_modules. Use a visible cache
  // location outside it so optimized modules can be served through preview.
  cacheDir: path.resolve(import.meta.dirname, "vite-cache"),
  plugins: [appleAppSiteAssociationPlugin, react(), tailwindcss(), ...replitPlugins],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets"
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
