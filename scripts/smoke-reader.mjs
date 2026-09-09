// Exercise the built reader in a real Chromium iframe without Obsidian's
// MathJax global or a Penpal handshake. Uses Chrome's DevTools protocol.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve("reader/reader/build/obsidian");
const profile = await mkdtemp(path.join(tmpdir(), "zotflow-reader-smoke-"));
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
    try {
        if (req.url === "/") {
            res.setHeader("Content-Type", "text/html");
            res.end("<!doctype html><html><head><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style></head><body></body></html>");
            return;
        }
        // Obsidian's private prototype extensions are intentionally absent.
        if (req.url === "/enhance.js") { res.end(""); return; }
        const file = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
        if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
        res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
    const endpoint = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Chrome did not start")), 15000);
        chrome.once("error", reject);
        chrome.stderr.on("data", chunk => {
            const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
    });
    const port = new URL(endpoint).port;
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
    let id = 0;
    const pending = new Map();
    const exceptions = [];
    socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
        if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
        }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    await call("Runtime.enable");
    await call("Page.navigate", { url: origin });
    const files = await readdir(root, { recursive: true, withFileTypes: true });
    const resources = Object.fromEntries(files.filter(f => f.isFile()).map(f => {
        const key = path.relative(root, path.join(f.parentPath ?? f.path, f.name)).replaceAll("\\", "/");
        return [key, origin + "/" + key];
    }));
    const expression = `(${async function (resources) {
        while (document.readyState !== "complete") await new Promise(r => setTimeout(r, 10));
        window.MathJax = undefined;
        window.OBSIDIAN_THEME_VARIABLES = { ":root": {} };
        const frame = document.createElement("iframe");
        frame.sandbox.add("allow-scripts", "allow-same-origin", "allow-forms");
        const parent = {
            getObsidianThemeVariables: () => ({ ":root": {} }),
            getBlobUrlMap: () => resources,
            isAndroidApp: () => false,
            isLocalReader: () => true,
            getOrigin: () => location.origin,
            getMathJaxConfig: () => ({}),
            getStyleSheets: () => document.styleSheets,
            getColorScheme: () => "light",
            getPluginSettings: () => ({}),
            handleEvent: event => { if (event.type === "ready") window.smokeReaderReady = true; },
            getSDTPack: async () => ({ ok: false, reason: "unavailable" }),
        };
        const connected = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Reader bootstrap timed out")), 10000);
            frame.__OBSIDIAN_BRIDGE__ = () => ({ token: "smoke", parent, register: async child => {
                clearTimeout(timeout); resolve(child); return { ok: true };
            } });
        });
        const html = await fetch(resources["reader.html"]).then(r => r.text());
        const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        frame.src = url;
        document.body.appendChild(frame);
        const child = await connected;
        window.smokeChild = child;
        // A generated one-page PDF exercises the nested PDF.js iframe too.
        const stream = "BT /F1 24 Tf 40 100 Td (ZotFlow PDF smoke test) Tj ET";
        const objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        ];
        let pdf = "%PDF-1.4\n";
        const offsets = [0];
        for (const [i, obj] of objects.entries()) {
            offsets.push(pdf.length);
            pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
        }
        const xref = pdf.length;
        pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        await Promise.race([
            child.initReader({type: "pdf", data: {buf: new TextEncoder().encode(pdf)}, colorScheme: "light", platform: "web", enableReadAloud: false}),
            new Promise((_, reject) => setTimeout(() => reject(new Error("PDF render timed out")), 20000)),
        ]);
        const pdfWindow = frame.contentWindow._reader._primaryView._iframeWindow;
        await pdfWindow.PDFViewerApplication.pdfViewer.firstPagePromise;
        return { connected: true, readerReady: window.smokeReaderReady, pages: pdfWindow.PDFViewerApplication.pagesCount, hostMathJax: typeof window.MathJax };
    }} )(${JSON.stringify(resources)})`;
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify({ result, exceptions }));
    console.log(JSON.stringify({ result: result.result.value, exceptions }, null, 2));
    if (exceptions.length) process.exitCode = 1;
    await call("Runtime.evaluate", { expression: "window.smokeChild.destroy()", awaitPromise: true });
    await call("Browser.close");
} finally {
    socket?.close();
    chrome.kill();
    server.close();
    // This unique temporary profile was created above; never remove a user profile.
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
