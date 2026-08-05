import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const outputDirectory = join(appRoot, "dist");

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [
    join(appRoot, "src", "content.ts"),
    join(appRoot, "src", "background.ts"),
    join(appRoot, "src", "popup.ts"),
  ],
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir: outputDirectory,
});

await Promise.all([
  cp(join(appRoot, "manifest.json"), join(outputDirectory, "manifest.json")),
  cp(join(appRoot, "src", "popup.html"), join(outputDirectory, "popup.html")),
]);
