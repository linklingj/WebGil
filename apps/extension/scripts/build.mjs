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
    join(appRoot, "src", "panel", "panel.ts"),
  ],
  bundle: true,
  format: "iife",
  target: "chrome114", // chrome.sidePanel
  outdir: outputDirectory,
  // panel.ts가 import하는 panel.css는 esbuild가 panel.css로 함께 뽑아준다.
  loader: { ".css": "css" },
});

// 패널 진입점이 src/panel/에 있어 esbuild가 dist/panel/{panel.js,panel.css}로 뽑는다.
// html도 같은 폴더에 두면 상대 경로가 그대로 맞는다(manifest는 "panel/panel.html").
await mkdir(join(outputDirectory, "panel"), { recursive: true });
await Promise.all([
  cp(join(appRoot, "manifest.json"), join(outputDirectory, "manifest.json")),
  cp(join(appRoot, "src", "panel", "panel.html"), join(outputDirectory, "panel", "panel.html")),
]);
