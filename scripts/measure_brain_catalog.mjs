/** Local model measurement only: no browser, backend, network request or corpus output. */
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { platform, arch, release } from "node:os";
import { performance } from "node:perf_hooks";

const filename = process.argv[2];
if (!filename)
  throw new Error(
    "Usage: node scripts/measure_brain_catalog.mjs <prepared-catalog.json>",
  );
const root = fileURLToPath(new URL("../apps/console/", import.meta.url));
const require = createRequire(
  new URL("../apps/console/package.json", import.meta.url),
);
const viteRequire = createRequire(require.resolve("vite/package.json"));
const { build } = viteRequire("esbuild");
const compiled = await build({
  stdin: {
    contents:
      'export {validateCatalog,catalogProjection} from "./src/brain/catalog.ts"; export {macroLinks} from "./src/brain/macro-links.ts";',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { validateCatalog, catalogProjection, macroLinks } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
if ((await stat(filename)).size > 30 * 1024 * 1024)
  throw new Error("Input exceeds the 30 MiB preview limit");
const raw = await readFile(filename, "utf8");
const samples = [];
let counts;
for (let i = 0; i < 11; i++) {
  const start = performance.now();
  const value = validateCatalog(JSON.parse(raw));
  const validated = performance.now();
  const projection = catalogProjection(value);
  const projected = performance.now();
  const macros = macroLinks(projection, "domain");
  const complete = performance.now();
  counts = {
    nodes: projection.nodes.length,
    references: projection.relations.length,
    territories: projection.territories.length,
    families: projection.groups.filter((g) => !g.parentId).length,
    groups: projection.groups.length,
    leafGroups: projection.groups.filter(
      (g) => !projection.groups.some((child) => child.parentId === g.id),
    ).length,
    macroPairs: macros.length,
  };
  if (i)
    samples.push({
      parseAndValidateMs: validated - start,
      projectionMs: projected - validated,
      worldAggregationMs: complete - projected,
      totalMs: complete - start,
    });
}
const percentile = (key, p) => {
  const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100;
};
const timings = Object.fromEntries(
  Object.keys(samples[0]).map((key) => [
    key,
    { p50: percentile(key, 0.5), p95: percentile(key, 0.95) },
  ]),
);
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      scope:
        "Node model preparation only; excludes browser rendering, storage, file IO, backend and network. No production capacity qualification.",
      environment: {
        node: process.version,
        platform: platform(),
        arch: arch(),
        release: release(),
      },
      inputBytes: Buffer.byteLength(raw),
      counts,
      warmups: 1,
      samples: samples.length,
      timings,
      processRssMiBAtEnd: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    null,
    2,
  ),
);
