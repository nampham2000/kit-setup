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

/**
 * Prepares engine files in buildDir/cocos-js:
 * Ensures BOTH `cc.js` (SystemJS wrapper) AND `_virtual_cc-<hash>.js` (engine payload) exist.
 */
function prepareEngineAlias(buildDir) {
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

    return {
        buildDir,
        cocosJsDir,
        virtualCcName,
        ccJsPath,
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
    getCcWrapperCode,
    prepareEngineAlias,
    restoreEngineAlias,
    patchHtmlContent,
    patchZipFile,
    patchAllBuildOutputs,
};
