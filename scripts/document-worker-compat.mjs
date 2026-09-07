// Prepended to the bundled Document Worker, before any upstream code runs.
// Older iPad WebViews lack this API. The Reader iframe's polyfill cannot reach
// this separate worker global, including SDT modules loaded into it later.
// Keep this in ZotFlow's packaging layer so upstream assets and Pack stay intact.
export const DOCUMENT_WORKER_PREAMBLE = `
if (typeof Promise.withResolvers !== "function") {
    Object.defineProperty(Promise, "withResolvers", {
        configurable: true,
        writable: true,
        value: function withResolvers() {
            var resolve, reject;
            var promise = new this(function (res, rej) {
                resolve = res;
                reject = rej;
            });
            return { promise: promise, resolve: resolve, reject: reject };
        }
    });
}
`;
