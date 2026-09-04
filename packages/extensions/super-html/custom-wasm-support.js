"use strict";

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const START_MARKER = "SUPER_HTML_WASM_SUPPORT_START";
const END_MARKER = "SUPER_HTML_WASM_SUPPORT_END";

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function toPosix(value) {
    return String(value || "").replace(/\\/g, "/");
}

function walkFiles(dir, predicate, result = []) {
    if (!fs.existsSync(dir)) return result;
    for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        if (stat.isDirectory()) {
            walkFiles(file, predicate, result);
        } else if (!predicate || predicate(file)) {
            result.push(file);
        }
    }
    return result;
}

function moveFile(source, target) {
    ensureDir(path.dirname(target));
    try {
        fs.renameSync(source, target);
    } catch (error) {
        if (error && error.code === "EXDEV") {
            fs.copyFileSync(source, target);
            fs.unlinkSync(source);
            return;
        }
        throw error;
    }
}

function hideWasmFiles(buildDir) {
    const files = walkFiles(buildDir, (file) => path.extname(file).toLowerCase() === ".wasm");
    const hidden = [];
    if (!files.length) return hidden;

    const tempRoot = path.join(path.dirname(buildDir), `.super-html-wasm-${Date.now()}-${process.pid}`);
    for (const source of files) {
        const relative = toPosix(path.relative(buildDir, source));
        const temp = path.join(tempRoot, relative);
        moveFile(source, temp);
        hidden.push({ source, temp, relative });
    }

    return hidden;
}

function restoreWasmFiles(hidden) {
    for (const item of hidden) {
        if (!fs.existsSync(item.temp)) continue;
        try {
            moveFile(item.temp, item.source);
        } catch (error) {
            console.error("[super-html] wasm restore failed", item.source, error);
        }
    }
}

function cleanupHiddenWasmFiles(hidden) {
    const roots = new Set(hidden.map((item) => {
        let current = item.temp;
        while (current && current !== path.dirname(current)) {
            if (path.basename(current).startsWith(".super-html-wasm-")) return current;
            current = path.dirname(current);
        }
        return path.dirname(item.temp);
    }));

    for (const root of roots) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch (error) {}
    }
}

function buildWasmResourceMap(hidden) {
    const map = {};
    for (const item of hidden) {
        const file = fs.existsSync(item.source) ? item.source : item.temp;
        if (!fs.existsSync(file)) continue;
        map[item.relative] = fs.readFileSync(file).toString("base64");
    }
    return map;
}

function runtimeScript(wasmResources) {
    return `;(function () {
    /* ${START_MARKER} */
    if (window.__superHtmlWasmSupportInstalled) return;
    window.__superHtmlWasmSupportInstalled = true;

    var NativeFetch = window.fetch;
    var embeddedWasmResources = ${JSON.stringify(wasmResources)};
    var wasmResources = window.__superHtmlWasmResources || Object.create(null);
    var wasmByteCache = window.__superHtmlWasmByteCache || Object.create(null);
    var wasmModuleCache = window.__superHtmlWasmModuleCache || Object.create(null);
    var perfReport = window.__superHtmlPerformance || {
        version: 2,
        bootStartedAt: typeof performance !== "undefined" && performance.now
            ? performance.now() : Date.now(),
        wasm: { eager: true, resources: Object.create(null), decodeMs: 0,
            compileMs: 0, instantiateMs: 0, decodedBytes: 0, errors: 0 }
    };
    Object.assign(wasmResources, embeddedWasmResources);
    embeddedWasmResources = null;
    window.__superHtmlWasmResources = wasmResources;
    window.__superHtmlWasmByteCache = wasmByteCache;
    window.__superHtmlWasmModuleCache = wasmModuleCache;
    window.__superHtmlPerformance = perfReport;
    perfReport.wasm = perfReport.wasm || { eager: true, resources: Object.create(null),
        decodeMs: 0, compileMs: 0, instantiateMs: 0, decodedBytes: 0, errors: 0 };
    perfReport.wasm.resources = perfReport.wasm.resources || Object.create(null);
    perfReport.longTasks = perfReport.longTasks || { count: 0, totalMs: 0, maxMs: 0 };

    if (typeof PerformanceObserver === "function" && !perfReport.longTaskObserver) {
        try {
            perfReport.longTaskObserver = new PerformanceObserver(function (list) {
                list.getEntries().forEach(function (entry) {
                    var duration = Number(entry.duration) || 0;
                    perfReport.longTasks.count++;
                    perfReport.longTasks.totalMs += duration;
                    perfReport.longTasks.maxMs = Math.max(perfReport.longTasks.maxMs, duration);
                });
            });
            perfReport.longTaskObserver.observe({ type: "longtask", buffered: true });
        } catch (error) {
            perfReport.longTaskObserver = null;
        }
    }

    function now() {
        return typeof performance !== "undefined" && performance.now
            ? performance.now() : Date.now();
    }

    function metricFor(key) {
        var resources = perfReport.wasm.resources;
        return resources[key] || (resources[key] = {
            decodeMs: 0, compileMs: 0, instantiateMs: 0,
            decodedBytes: 0, compileCount: 0, instantiateCount: 0,
            cacheHits: 0, status: "embedded"
        });
    }

    function reportError(key, phase, error) {
        var metric = metricFor(key || "unknown");
        metric.status = "error";
        metric.errorPhase = phase;
        metric.error = String(error && (error.message || error) || "unknown");
        perfReport.wasm.errors++;
    }

    function cleanUrl(value) {
        value = String(value == null ? "" : value).replace(/\\\\/g, "/");
        value = value.split("#")[0].split("?")[0];
        value = value.replace(/^data:/, "").replace(/^_SUPER_URL/, "");
        value = value.replace(/^[a-zA-Z]+:\\/\\/[^/]+\\//, "");
        value = value.replace(/^\\.\\//, "").replace(/^\\//, "");
        return value;
    }

    function candidateUrls(input) {
        var raw = input && input.url ? input.url : input;
        var clean = cleanUrl(raw);
        var list = [clean];
        var parts = clean.split("/");
        for (var i = 1; i < parts.length; i++) list.push(parts.slice(i).join("/"));
        return list;
    }

    function ensureEngineCcAlias(map) {
        if (!map || map["cocos-js/cc.js"]) return;
        for (var key in map) {
            if (key.indexOf("cocos-js/_virtual_cc-") !== -1 || key.indexOf("_virtual_cc-") !== -1) {
                map["cocos-js/cc.js"] = map[key];
                break;
            }
        }
    }

    function lookupMapEntry(map, input) {
        if (!map) return null;
        ensureEngineCcAlias(map);
        var candidates = candidateUrls(input);
        for (var i = 0; i < candidates.length; i++) {
            if (Object.prototype.hasOwnProperty.call(map, candidates[i])) {
                return { key: candidates[i], value: map[candidates[i]] };
            }
        }

        var clean = candidates[0] || "";
        for (var key in map) {
            if (clean === key || clean.slice(-key.length - 1) === "/" + key) {
                return { key: key, value: map[key] };
            }
        }

        if (clean === "cocos-js/cc.js" || clean.endsWith("/cocos-js/cc.js") || clean === "cc.js") {
            for (var key in map) {
                if (key.indexOf("cocos-js/_virtual_cc-") !== -1 || key.indexOf("_virtual_cc-") !== -1) {
                    map["cocos-js/cc.js"] = map[key];
                    return { key: key, value: map[key] };
                }
            }
        }

        return null;
    }

    function lookupMap(map, input) {
        var entry = lookupMapEntry(map, input);
        return entry ? entry.value : null;
    }

    function lookupResource(input) {
        ensureEngineCcAlias(window.__res);
        var entry = lookupMapEntry(wasmByteCache, input);
        if (entry) {
            metricFor(entry.key).cacheHits++;
            return { key: entry.key, value: entry.value, wasm: true };
        }
        entry = lookupMapEntry(wasmResources, input);
        if (entry) return { key: entry.key, value: entry.value, wasm: true };

        if (typeof window.getRes === "function") {
            var candidates = candidateUrls(input);
            for (var i = 0; i < candidates.length; i++) {
                try {
                    var value = window.getRes(candidates[i]);
                    if (value != null) return { key: candidates[i], value: value,
                        wasm: /\\.wasm$/i.test(candidates[i]) };
                } catch (error) {}
            }
        }

        entry = lookupMapEntry(window.__res, input);
        if (entry) {
            return { key: entry.key, value: entry.value,
                wasm: /\\.wasm$/i.test(cleanUrl(input && input.url ? input.url : input)) };
        }

        return null;
    }

    function base64ToBytes(base64) {
        var binary = window.atob(base64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function dataUriToBytes(dataUri) {
        var comma = dataUri.indexOf(",");
        var meta = comma >= 0 ? dataUri.slice(0, comma) : "";
        var body = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
        if (/;base64/i.test(meta)) return base64ToBytes(body);

        var text = decodeURIComponent(body);
        var bytes = new Uint8Array(text.length);
        for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
        return bytes;
    }

    function mimeForUrl(url, isWasm) {
        if (isWasm || /\\.wasm(?:$|[?#])/i.test(String(url))) return "application/wasm";
        if (/\\.json(?:$|[?#])/i.test(String(url))) return "application/json";
        if (/\\.css(?:$|[?#])/i.test(String(url))) return "text/css";
        if (/\\.js(?:$|[?#])/i.test(String(url))) return "application/javascript";
        return "application/octet-stream";
    }

    function bodyForResource(resource, mime) {
        var value = resource.value;
        if (typeof value !== "string") return value;
        if (value.indexOf("data:") === 0) return dataUriToBytes(value);
        if (mime === "application/wasm") {
            var key = resource.key || "unknown";
            var cached = wasmByteCache[key];
            if (cached) {
                metricFor(key).cacheHits++;
                return cached;
            }
            var startedAt = now();
            var bytes = base64ToBytes(value);
            var elapsed = now() - startedAt;
            var metric = metricFor(key);
            metric.decodeMs += elapsed;
            metric.decodedBytes = bytes.byteLength;
            metric.status = "decoded";
            perfReport.wasm.decodeMs += elapsed;
            perfReport.wasm.decodedBytes += bytes.byteLength;
            wasmByteCache[key] = bytes;
            // The Uint8Array is the compact canonical copy. Drop the 4/3-sized
            // base64 string before Cocos starts allocating the scene and Bullet heap.
            delete wasmResources[key];
            return bytes;
        }
        return value;
    }

    function responseFor(input, resource) {
        var url = input && input.url ? input.url : input;
        var mime = mimeForUrl(url, resource.wasm);
        var body = bodyForResource(resource, mime);
        var response = new Response(body, {
            status: 200,
            statusText: "OK",
            headers: { "Content-Type": mime }
        });
        if (resource.wasm) {
            response.__superHtmlWasmKey = resource.key;
            response.__superHtmlWasmBytes = body;
        }
        return response;
    }

    if (typeof Response === "function") {
        window.fetch = function superHtmlFetch(input, init) {
            var resource = lookupResource(input);
            if (resource) return Promise.resolve(responseFor(input, resource));
            if (NativeFetch) return NativeFetch.apply(this, arguments);
            return Promise.reject(new TypeError("Failed to fetch " + String(input)));
        };
    }

    if (typeof WebAssembly !== "undefined") {
        var nativeCompileStreaming = WebAssembly.compileStreaming;
        var nativeInstantiateStreaming = WebAssembly.instantiateStreaming;
        var nativeInstantiate = WebAssembly.instantiate;
        var wasmModuleKeys = typeof WeakMap === "function" ? new WeakMap() : new Map();

        function compileEmbedded(key, bytes) {
            var cached = wasmModuleCache[key];
            if (cached) {
                metricFor(key).cacheHits++;
                return cached;
            }
            var startedAt = now();
            var metric = metricFor(key);
            metric.compileCount++;
            metric.status = "compiling";
            var promise;
            try {
                promise = WebAssembly.compile(bytes).then(function (module) {
                    var elapsed = now() - startedAt;
                    metric.compileMs += elapsed;
                    metric.status = "compiled";
                    perfReport.wasm.compileMs += elapsed;
                    wasmModuleKeys.set(module, key);
                    return module;
                }, function (error) {
                    delete wasmModuleCache[key];
                    reportError(key, "compile", error);
                    throw error;
                });
            } catch (error) {
                reportError(key, "compile", error);
                throw error;
            }
            wasmModuleCache[key] = promise;
            // Eager compilation may finish before the engine requests the module.
            // Attach a rejection handler now so unsupported runtimes do not emit an
            // unhandled rejection; the engine request still receives the same failure.
            promise.catch(function () {});
            return promise;
        }

        function compileEmbeddedResponse(response) {
            var key = response && response.__superHtmlWasmKey;
            var bytes = response && response.__superHtmlWasmBytes;
            return key && bytes ? compileEmbedded(key, bytes) : null;
        }

        function compileFromResponse(response) {
            return Promise.resolve(response)
                .then(function (resolved) { return resolved.arrayBuffer(); })
                .then(function (buffer) { return WebAssembly.compile(buffer); });
        }

        function instantiateFromResponse(response, imports) {
            return Promise.resolve(response)
                .then(function (resolved) { return resolved.arrayBuffer(); })
                .then(function (buffer) { return nativeInstantiate.call(WebAssembly, buffer, imports); });
        }

        WebAssembly.instantiate = function superHtmlInstantiate(moduleOrBytes, imports) {
            var key = wasmModuleKeys.get(moduleOrBytes);
            if (!key) return nativeInstantiate.call(WebAssembly, moduleOrBytes, imports);
            var startedAt = now();
            var metric = metricFor(key);
            metric.instantiateCount++;
            return nativeInstantiate.call(WebAssembly, moduleOrBytes, imports).then(function (result) {
                var elapsed = now() - startedAt;
                metric.instantiateMs += elapsed;
                metric.status = "instantiated";
                perfReport.wasm.instantiateMs += elapsed;
                return result;
            }, function (error) {
                reportError(key, "instantiate", error);
                throw error;
            });
        };

        WebAssembly.compileStreaming = function superHtmlCompileStreaming(source) {
            return Promise.resolve(source).then(function (response) {
                var embedded = compileEmbeddedResponse(response);
                if (embedded) return embedded;
                if (nativeCompileStreaming) {
                    var backup = response && response.clone ? response.clone() : response;
                    return nativeCompileStreaming.call(WebAssembly, Promise.resolve(response)).catch(function () {
                        return compileFromResponse(backup);
                    });
                }
                return compileFromResponse(response);
            });
        };

        WebAssembly.instantiateStreaming = function superHtmlInstantiateStreaming(source, imports) {
            return Promise.resolve(source).then(function (response) {
                var key = response && response.__superHtmlWasmKey;
                var embedded = compileEmbeddedResponse(response);
                if (embedded) {
                    var startedAt = now();
                    var metric = metricFor(key);
                    metric.instantiateCount++;
                    return embedded.then(function (module) {
                        return nativeInstantiate.call(WebAssembly, module, imports).then(function (instance) {
                            var elapsed = now() - startedAt;
                            metric.instantiateMs += elapsed;
                            metric.status = "instantiated";
                            perfReport.wasm.instantiateMs += elapsed;
                            return { module: module, instance: instance };
                        });
                    }).catch(function (error) {
                        reportError(key, "instantiate", error);
                        throw error;
                    });
                }
                if (nativeInstantiateStreaming) {
                    var backup = response && response.clone ? response.clone() : response;
                    return nativeInstantiateStreaming.call(WebAssembly, Promise.resolve(response), imports).catch(function () {
                        return instantiateFromResponse(backup, imports);
                    });
                }
                return instantiateFromResponse(response, imports);
            });
        };

        // Begin compilation before Cocos boot. Engine requests reuse these exact
        // promises, so this never compiles a module twice and keeps the work out of
        // the first gameplay/impact frame.
        Object.keys(wasmResources).forEach(function (key) {
            try {
                var resource = { key: key, value: wasmResources[key], wasm: true };
                compileEmbedded(key, bodyForResource(resource, "application/wasm"));
            } catch (error) {
                reportError(key, "eager", error);
            }
        });
        perfReport.wasm.eagerQueuedAt = now();
    }
    /* ${END_MARKER} */
})();`;
}

function stripExistingRuntime(html) {
    const scriptPattern = new RegExp(
        `<script[^>]*>\\s*;\\(function \\(\\) \\{\\s*/\\* ${START_MARKER} \\*/[\\s\\S]*?/\\* ${END_MARKER} \\*/\\s*\\}\\)\\(\\);\\s*</script>\\s*`,
        "g"
    );
    const inlinePattern = new RegExp(
        `;\\(function \\(\\) \\{\\s*/\\* ${START_MARKER} \\*/[\\s\\S]*?/\\* ${END_MARKER} \\*/\\s*\\}\\)\\(\\);\\s*`,
        "g"
    );
    return html.replace(scriptPattern, "").replace(inlinePattern, "");
}

function injectRuntime(html, wasmResources) {
    if (!Object.keys(wasmResources).length) return html;

    html = stripExistingRuntime(html);
    const bootIndex = html.lastIndexOf("super_load();");
    if (bootIndex >= 0) return `${html.slice(0, bootIndex)}${runtimeScript(wasmResources)}\n${html.slice(bootIndex)}`;

    const scriptTag = `<script type="text/javascript">\n${runtimeScript(wasmResources)}\n</script>\n`;
    const bodyIndex = html.lastIndexOf("</body>");
    if (bodyIndex >= 0) return `${html.slice(0, bodyIndex)}${scriptTag}${html.slice(bodyIndex)}`;

    return `${html}\n${scriptTag}`;
}

async function patchZip(file, wasmResources) {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    let changed = false;

    for (const name of Object.keys(zip.files).filter((entry) => entry.toLowerCase().endsWith(".html"))) {
        const entry = zip.file(name);
        if (!entry) continue;

        const html = await entry.async("string");
        const patched = injectRuntime(html, wasmResources);
        if (patched !== html) {
            zip.file(name, patched);
            changed = true;
        }
    }

    if (changed) {
        const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
        fs.writeFileSync(file, buffer);
    }

    return changed;
}

async function patchGeneratedHtml(buildDir, hidden) {
    if (!hidden.length) return { html: 0, zip: 0, resources: 0 };

    const outputDir = path.join(path.dirname(buildDir), "super-html");
    const wasmResources = buildWasmResourceMap(hidden);
    const resources = Object.keys(wasmResources).length;
    if (!resources || !fs.existsSync(outputDir)) return { html: 0, zip: 0, resources };

    let htmlCount = 0;
    let zipCount = 0;

    for (const file of walkFiles(outputDir)) {
        const ext = path.extname(file).toLowerCase();
        if (ext === ".html") {
            const html = fs.readFileSync(file, "utf8");
            const patched = injectRuntime(html, wasmResources);
            if (patched !== html) {
                fs.writeFileSync(file, patched);
                htmlCount++;
            }
        } else if (ext === ".zip") {
            if (await patchZip(file, wasmResources)) zipCount++;
        }
    }

    return { html: htmlCount, zip: zipCount, resources };
}

module.exports = {
    hideWasmFiles,
    restoreWasmFiles,
    cleanupHiddenWasmFiles,
    patchGeneratedHtml,
    runtimeScript,
};
