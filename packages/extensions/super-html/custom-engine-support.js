"use strict";

const fs = require("fs");
const path = require("path");

let JSZip = null;
try {
    JSZip = require("jszip");
} catch (e) {
    try {
        JSZip = require(path.join(__dirname, "node_modules", "jszip"));
    } catch (e2) {}
}

let UglifyJS = null;
try {
    UglifyJS = require("uglify-js");
} catch (e) {}

const ENGINE_COMPANIONS = [
    {
        family: "meshopt",
        importPrefix: "meshopt_decoder.wasm-",
        sourceJs: ["native", "external", "emscripten", "meshopt", "meshopt_decoder.wasm.js"],
        sourceWasm: ["native", "external", "emscripten", "meshopt", "meshopt_decoder.wasm.wasm"],
        assetPrefix: "meshopt_decoder.wasm-",
        fallbackAssetName: "meshopt_decoder.wasm.wasm",
    },
    {
        family: "bullet",
        importPrefix: "bullet.release.wasm-",
        sourceJs: ["native", "external", "emscripten", "bullet", "bullet.release.wasm.js"],
        sourceWasm: ["native", "external", "emscripten", "bullet", "bullet.release.wasm.wasm"],
        assetPrefix: "bullet.release.wasm-",
        fallbackAssetName: "bullet.release.wasm.wasm",
    },
];

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
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

function getTemplatePath() {
    const candidates = [
        path.join(__dirname, "static", "cc-template.js"),
        path.join(__dirname, "..", "static", "cc-template.js"),
        path.join(__dirname, "cc-template.js"),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function getCcWrapperCode(virtualCcName) {
    const templatePath = getTemplatePath();
    if (templatePath) {
        let code = fs.readFileSync(templatePath, "utf8");
        return code.replace(/_virtual_cc-[^"]+\.js/, virtualCcName);
    }
    return null;
}

function findVirtualCcInDir(dir) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    return files.find((f) => f.startsWith("_virtual_cc-") && f.endsWith(".js")) || null;
}

function findDynamicEngineImports(code) {
    const result = [];
    const seen = new Set();
    const pattern = /\.import\(["']\.\/([^"']+\.js)["']\)/g;
    let match;
    while ((match = pattern.exec(code))) {
        const name = match[1];
        if (name !== path.basename(name) || seen.has(name)) continue;
        seen.add(name);
        result.push(name);
    }
    return result;
}

function candidateEngineRoots(explicitRoot) {
    const bases = [];
    if (explicitRoot) bases.push(explicitRoot);
    if (typeof Editor !== "undefined" && Editor && Editor.App && Editor.App.path) {
        bases.push(Editor.App.path);
    }
    if (typeof process !== "undefined") {
        if (process.resourcesPath) bases.push(process.resourcesPath);
        if (process.execPath) bases.push(path.dirname(process.execPath));
    }

    const candidates = [];
    const seen = new Set();
    for (const base of bases) {
        for (const candidate of [
            base,
            path.join(base, "resources", "resources", "3d", "engine"),
            path.join(base, "resources", "3d", "engine"),
            path.join(base, "..", "resources", "resources", "3d", "engine"),
        ]) {
            const resolved = path.resolve(candidate);
            if (seen.has(resolved)) continue;
            seen.add(resolved);
            candidates.push(resolved);
        }
    }
    return candidates;
}

function findEngineRoot(explicitRoot) {
    return candidateEngineRoots(explicitRoot).find((candidate) =>
        fs.existsSync(path.join(candidate, "native", "external", "emscripten"))) || null;
}

function minifyEngineSource(source, label) {
    if (!UglifyJS) return source;
    const result = UglifyJS.minify(source, {
        compress: true,
        mangle: true,
        output: { comments: false },
    });
    if (result.error) {
        throw new Error(`[super-html] failed to minify ${label}: ${result.error.message}`);
    }
    return result.code;
}

function createEngineGlueModule(family, source) {
    if (family === "meshopt") {
        const body = source.replace(/export\s+default\s+MeshoptDecoder\s*;?\s*$/, "");
        if (body === source) {
            throw new Error("[super-html] unsupported meshopt decoder source: default export not found");
        }
        const code = minifyEngineSource(body, "meshopt decoder");
        return `System.register([],function(e){"use strict";return{execute:function(){${code};e("default",MeshoptDecoder)}}});`;
    }

    if (family === "bullet") {
        const code = minifyEngineSource(source, "Bullet runtime");
        return `System.register([],function(e){"use strict";return{execute:function(){var module={exports:{}},exports=module.exports;${code};var runtime=module.exports&&Object.keys(module.exports).length?module.exports:Bullet;e("b",Object.freeze({__proto__:null,default:runtime}))}}});`;
    }

    throw new Error(`[super-html] unsupported engine companion family: ${family}`);
}

function createEngineAssetModule(assetRelative) {
    return `System.register([],function(e){"use strict";return{execute:function(){e("default",${JSON.stringify(assetRelative)})}}});`;
}

function ensureEngineWasmAsset(cocosJsDir, config, engineRoot) {
    const assetsDir = path.join(cocosJsDir, "assets");
    ensureDir(assetsDir);
    const existing = fs.readdirSync(assetsDir).find((name) =>
        name.startsWith(config.assetPrefix) && name.endsWith(".wasm"));
    if (existing) return `assets/${existing}`;

    const source = path.join(engineRoot, ...config.sourceWasm);
    if (!fs.existsSync(source)) {
        throw new Error(`[super-html] missing ${config.family} wasm source: ${source}`);
    }
    const target = path.join(assetsDir, config.fallbackAssetName);
    fs.copyFileSync(source, target);
    return `assets/${config.fallbackAssetName}`;
}

function prepareEngineCompanions(cocosJsDir, virtualCcName, options = {}) {
    const virtualPath = path.join(cocosJsDir, virtualCcName);
    const imports = findDynamicEngineImports(fs.readFileSync(virtualPath, "utf8"));
    const missing = imports.filter((name) => !fs.existsSync(path.join(cocosJsDir, name)));
    if (!missing.length) return { created: [], imports, engineRoot: null };

    const relevantConfigs = ENGINE_COMPANIONS.filter((config) =>
        missing.some((name) => name.startsWith(config.importPrefix)));
    if (!relevantConfigs.length) return { created: [], imports, engineRoot: null };

    const engineRoot = findEngineRoot(options.engineRoot);
    if (!engineRoot) {
        throw new Error(
            `[super-html] cannot restore missing engine modules (${missing.join(", ")}): Cocos engine root not found`
        );
    }

    const created = [];
    for (const config of relevantConfigs) {
        const familyImports = imports.filter((name) => name.startsWith(config.importPrefix));
        if (familyImports.length < 2) {
            throw new Error(`[super-html] unsupported ${config.family} import layout in ${virtualCcName}`);
        }

        const glueName = familyImports[0];
        const assetModuleName = familyImports[1];
        const gluePath = path.join(cocosJsDir, glueName);
        const assetModulePath = path.join(cocosJsDir, assetModuleName);
        const assetRelative = ensureEngineWasmAsset(cocosJsDir, config, engineRoot);

        if (!fs.existsSync(gluePath)) {
            const sourcePath = path.join(engineRoot, ...config.sourceJs);
            if (!fs.existsSync(sourcePath)) {
                throw new Error(`[super-html] missing ${config.family} JavaScript source: ${sourcePath}`);
            }
            const source = fs.readFileSync(sourcePath, "utf8");
            fs.writeFileSync(gluePath, createEngineGlueModule(config.family, source), "utf8");
            created.push(glueName);
        }

        if (!fs.existsSync(assetModulePath)) {
            fs.writeFileSync(assetModulePath, createEngineAssetModule(assetRelative), "utf8");
            created.push(assetModuleName);
        }
    }

    const unresolved = imports.filter((name) => !fs.existsSync(path.join(cocosJsDir, name)));
    if (unresolved.length) {
        throw new Error(`[super-html] unresolved dynamic engine modules: ${unresolved.join(", ")}`);
    }

    return { created, imports, engineRoot };
}

/**
 * Prepares engine files in buildDir/cocos-js:
 * Ensures BOTH `cc.js` (SystemJS wrapper) AND `_virtual_cc-<hash>.js` (engine payload) exist.
 */
function prepareEngineAlias(buildDir, options = {}) {
    if (!buildDir || !fs.existsSync(buildDir)) return null;

    const cocosJsDir = path.join(buildDir, "cocos-js");
    if (!fs.existsSync(cocosJsDir)) return null;

    const virtualCcName = findVirtualCcInDir(cocosJsDir);
    if (!virtualCcName) return null;

    const ccJsPath = path.join(cocosJsDir, "cc.js");
    const wrapperCode = getCcWrapperCode(virtualCcName);

    if (wrapperCode) {
        // Ensure cc.js exists and has the wrapper code
        if (!fs.existsSync(ccJsPath)) {
            fs.writeFileSync(ccJsPath, wrapperCode, "utf8");
            console.log(`[super-html] Created cocos-js/cc.js pointing to ${virtualCcName}`);
        } else {
            const current = fs.readFileSync(ccJsPath, "utf8");
            if (!current.includes(virtualCcName)) {
                fs.writeFileSync(ccJsPath, wrapperCode, "utf8");
                console.log(`[super-html] Updated cocos-js/cc.js pointing to ${virtualCcName}`);
            }
        }
    }

    const engineModules = prepareEngineCompanions(cocosJsDir, virtualCcName, options);

    return {
        buildDir,
        cocosJsDir,
        virtualCcName,
        ccJsPath,
        engineModules,
    };
}

function restoreEngineAlias(state) {
    // No-op: both files remain in buildDir/cocos-js for static serving
}

function findKnownVirtualCcContent(virtualCcName) {
    const searchDirs = [
        path.resolve(__dirname, "../../temp"),
        path.resolve(__dirname, "../../build"),
    ];
    for (const searchDir of searchDirs) {
        if (!fs.existsSync(searchDir)) continue;
        const found = walkFiles(searchDir, (f) => path.basename(f) === virtualCcName);
        if (found.length > 0 && fs.statSync(found[0]).size > 1000000) {
            return fs.readFileSync(found[0]);
        }
    }
    return null;
}

/**
 * Patches an HTML string to ensure both cocos-js/cc.js and cocos-js/_virtual_cc-*.js are available.
 */
async function patchHtmlContent(htmlContent) {
    let changed = false;
    let result = htmlContent;

    // 1. Check for zip payload format: window.__zip = "..."
    const zipMarker = 'window.__zip = "';
    const sIdx = result.indexOf(zipMarker);
    if (sIdx !== -1 && JSZip) {
        const eIdx = result.indexOf('"', sIdx + zipMarker.length);
        if (eIdx !== -1) {
            const base64 = result.substring(sIdx + zipMarker.length, eIdx);
            try {
                const zip = await JSZip.loadAsync(base64, { base64: true });
                let virtualCcEntry = null;
                for (const name of Object.keys(zip.files)) {
                    if (name.startsWith("cocos-js/_virtual_cc-") && name.endsWith(".js")) {
                        virtualCcEntry = name;
                        break;
                    }
                }

                // If virtualCcEntry is present in zip but cc.js is missing or too large
                if (virtualCcEntry) {
                    const virtualName = path.basename(virtualCcEntry);
                    const wrapperCode = getCcWrapperCode(virtualName);
                    if (wrapperCode) {
                        const existingCc = zip.files["cocos-js/cc.js"];
                        if (!existingCc || existingCc._data.uncompressedSize > 50000) {
                            zip.file("cocos-js/cc.js", wrapperCode);
                            changed = true;
                        }
                    }
                } else if (zip.files["cocos-js/cc.js"]) {
                    // Check if cc.js references a virtual file that is missing from zip
                    const ccText = await zip.files["cocos-js/cc.js"].async("string");
                    const vMatch = ccText.match(/_virtual_cc-[^"]+\.js/);
                    if (vMatch) {
                        const neededVirtual = vMatch[0];
                        const entryPath = "cocos-js/" + neededVirtual;
                        if (!zip.files[entryPath]) {
                            const vContent = findKnownVirtualCcContent(neededVirtual);
                            if (vContent) {
                                zip.file(entryPath, vContent);
                                changed = true;
                            }
                        }
                    }
                }

                if (changed) {
                    const newBase64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
                    result = result.substring(0, sIdx + zipMarker.length) + newBase64 + result.substring(eIdx);
                }
            } catch (err) {
                console.warn("[super-html] failed inspecting zip in HTML:", err.message);
            }
        }
    }

    // 2. Check for inline window.__res format
    const vMatch = result.match(/"cocos-js\/(_virtual_cc-[^"]+\.js)":/);
    if (vMatch && !result.includes('"cocos-js/cc.js":')) {
        const virtualName = vMatch[1];
        const wrapperCode = getCcWrapperCode(virtualName);
        if (wrapperCode) {
            const virtualEntry = vMatch[0];
            const startIdx = result.indexOf(virtualEntry);
            if (startIdx !== -1) {
                const ccEntry = `"cocos-js/cc.js":${JSON.stringify(wrapperCode)},`;
                result = result.slice(0, startIdx) + ccEntry + result.slice(startIdx);
                changed = true;
            }
        }
    }

    return { changed, content: result };
}

/**
 * Patches a standalone ZIP file generated by Super-HTML.
 */
async function patchZipFile(zipFilePath) {
    if (!JSZip || !fs.existsSync(zipFilePath)) return false;

    try {
        const buffer = fs.readFileSync(zipFilePath);
        const zip = await JSZip.loadAsync(buffer);
        let modified = false;

        let virtualCcEntry = null;
        for (const name of Object.keys(zip.files)) {
            if (name.startsWith("cocos-js/_virtual_cc-") && name.endsWith(".js")) {
                virtualCcEntry = name;
                break;
            }
        }

        if (virtualCcEntry) {
            const virtualName = path.basename(virtualCcEntry);
            const wrapperCode = getCcWrapperCode(virtualName);
            if (wrapperCode && !zip.files["cocos-js/cc.js"]) {
                zip.file("cocos-js/cc.js", wrapperCode);
                modified = true;
            }
        }

        for (const name of Object.keys(zip.files)) {
            if (name.toLowerCase().endsWith(".html")) {
                const htmlText = await zip.file(name).async("string");
                const patchResult = await patchHtmlContent(htmlText);
                if (patchResult.changed) {
                    zip.file(name, patchResult.content);
                    modified = true;
                }
            }
        }

        if (modified) {
            const newBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
            fs.writeFileSync(zipFilePath, newBuffer);
            return true;
        }
    } catch (err) {
        console.warn("[super-html] failed patching zip:", zipFilePath, err.message);
    }

    return false;
}

/**
 * Walks an output directory and patches all HTML and ZIP files.
 */
async function patchAllBuildOutputs(outputDir) {
    if (!outputDir || !fs.existsSync(outputDir)) return { html: 0, zip: 0 };

    let htmlCount = 0;
    let zipCount = 0;

    for (const file of walkFiles(outputDir)) {
        const ext = path.extname(file).toLowerCase();
        if (ext === ".html") {
            try {
                const text = fs.readFileSync(file, "utf8");
                const patchResult = await patchHtmlContent(text);
                if (patchResult.changed) {
                    fs.writeFileSync(file, patchResult.content);
                    htmlCount++;
                }
            } catch (err) {
                console.warn("[super-html] failed patching html:", file, err.message);
            }
        } else if (ext === ".zip") {
            if (await patchZipFile(file)) {
                zipCount++;
            }
        }
    }

    return { html: htmlCount, zip: zipCount };
}

module.exports = {
    findDynamicEngineImports,
    findEngineRoot,
    createEngineGlueModule,
    createEngineAssetModule,
    prepareEngineCompanions,
    getCcWrapperCode,
    prepareEngineAlias,
    restoreEngineAlias,
    patchHtmlContent,
    patchZipFile,
    patchAllBuildOutputs,
};
