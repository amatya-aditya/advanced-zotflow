/**
 * Reverse round-trip test: MD → HTML → MD
 *
 * Usage:  node scripts/test-md-roundtrip.mjs
 */

import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Bundle the test entry into a temp file
const testEntry = path.resolve(root, "scripts/_test-md-roundtrip-entry.ts");
const testOut = path.resolve(root, "scripts/_test-md-roundtrip-out.mjs");

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
const { run } = await import(`./_test-md-roundtrip-out.mjs?t=${Date.now()}`);
await run(filter.length ? filter : undefined);

// Cleanup
fs.unlinkSync(testOut);
