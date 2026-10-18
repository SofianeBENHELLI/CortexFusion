import type { Connect, Plugin } from "vite";

const invalidNavigation = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Adresse invalide · Open BrAIn</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}
body{margin:0;background:#fff;color:#171717}
main{max-width:36rem;margin:12vh auto;padding:1.5rem;overflow-wrap:anywhere}
h1{font-size:1.75rem;line-height:1.2}p{line-height:1.6}
a{display:inline-block;color:inherit;padding:.75rem 1rem;border:1px solid currentColor;border-radius:.5rem}
a:focus-visible{outline:3px solid currentColor;outline-offset:4px}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}
</style></head><body><main>
<p>Open Br<strong>AI</strong>n</p>
<h1>Cette adresse est invalide</h1>
<p>Le lien contient un encodage incorrect. Revenez à l’accueil pour reprendre la navigation. Vos données locales sont conservées.</p>
<a href="/">Revenir à l’accueil</a>
</main></body></html>`;

/** Catch invalid path encoding before Vite's SPA fallback exposes its stack. */
export const guardNavigation: Connect.NextHandleFunction = (req, res, next) => {
  try {
    let path = decodeURIComponent((req.url ?? "/").split("?", 1)[0]);
    // Run before Vite's static, raw-import and SPA middleware. Never reflect
    // private filesystem paths or rely solely on the development allow-list.
    for (let depth = 0; depth < 5; depth += 1) {
      if (/(?:^|[/\\])(?:\.runtime|\.git)(?:[/\\]|$)/i.test(path)) {
        res.statusCode = 403;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          req.method === "HEAD" ? undefined : '{"error":"forbidden_path"}',
        );
        return;
      }
      // Encoded literal percent signs remain valid navigation. Repeated
      // decoding is only a conservative private-directory check.
      let decoded: string;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        break;
      }
      if (decoded === path) break;
      path = decoded;
    }
  } catch {
    const html =
      (req.method === "GET" || req.method === "HEAD") &&
      req.headers.accept?.includes("text/html");
    res.statusCode = 400;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Type",
      html ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    );
    res.end(
      req.method === "HEAD"
        ? undefined
        : html
          ? invalidNavigation
          : '{"error":"invalid_path"}',
    );
    return;
  }
  next();
};

export function navigationGuard(): Plugin {
  return {
    name: "cortex-navigation-guard",
    configureServer(server) {
      server.middlewares.use(guardNavigation);
    },
    configurePreviewServer(server) {
      server.middlewares.use(guardNavigation);
    },
  };
}
