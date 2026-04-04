/**
 * Round-trip test: html2md → md2html using note-editor demo data.
 *
 * Usage:  node scripts/test-html-roundtrip.mjs
 */

import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Bundle the test entry into a temp file
const testEntry = path.resolve(root, "scripts/_test-html-roundtrip-entry.ts");
const testOut = path.resolve(root, "scripts/_test-html-roundtrip-out.mjs");

await esbuild.build({
    entryPoints: [testEntry],
    bundle: true,
    write: true,
    outfile: testOut,
    format: "esm",
    target: "es2020",
    platform: "node",
    conditions: ["worker"],
    external: ["obsidian"],
    banner: { js: "" },
});

// Run the bundled test
const filter = process.argv.slice(2);
const { run } = await import(`./_test-html-roundtrip-out.mjs?t=${Date.now()}`);
await run(filter.length ? filter : undefined);

// Cleanup
fs.unlinkSync(testOut);
