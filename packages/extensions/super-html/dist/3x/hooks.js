"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.onAfterBuild = void 0;

const path = require("path");
const CocosMain = require("../platform/cocos/cocos_main").default;
const buildCache = require("../platform/cocos/cache").default;
const wasmSupport = require("../../custom-wasm-support");
const buildPolicy = require("../../custom-build-policy");
const engineSupport = require("../../custom-engine-support");

function isWebBuild(options) {
    return options && (options.platform === "web-mobile" || options.platform === "web-desktop");
}

function isIgnorableCoreError(error) {
    const message = String((error && error.message) || error || "");
    const stack = String((error && error.stack) || "");
    return message.includes("Unexpected token '<'") && stack.includes("dist\\core\\build.js");
}

function runSuperHtml(buildDir) {
    return new Promise((resolve, reject) => {
        const canHandleProcessErrors = typeof process !== "undefined" && process && process.on;
        let settled = false;

        const cleanup = () => {
            if (canHandleProcessErrors && process.removeListener) {
                process.removeListener("uncaughtException", onUncaughtException);
            }
        };

        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(true);
        };

        const fail = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        const onUncaughtException = (error) => {
            if (isIgnorableCoreError(error)) {
                console.warn("[super-html] ignored non-critical core JSON response error:", error.message);
                return;
            }
            fail(error);
        };

        if (canHandleProcessErrors) {
            process.on("uncaughtException", onUncaughtException);
        }

        try {
            const projectRoot = Editor.Project.path;
            const obfuscate = buildPolicy.readProjectPolicy(projectRoot);
            if (obfuscate !== undefined) {
                console.log(`[super-html] JavaScript obfuscation: ${obfuscate} (playable-config.json); minification unchanged.`);
            }
            buildPolicy.withObfuscationPolicy(buildCache, obfuscate,
                () => new CocosMain(Editor.App.version, buildDir, finish));
        } catch (error) {
            fail(error);
        }
    });
}

exports.onAfterBuild = async function onAfterBuild(options, result) {
    if (!isWebBuild(options)) return;

    const buildDir = result && result.dest;
    if (!buildDir) return;

    const engineAliasState = engineSupport.prepareEngineAlias(buildDir);
    if (engineAliasState) {
        console.log(`[super-html] engine alias prepared: cc.js -> ${engineAliasState.virtualCcName}`);
        if (engineAliasState.engineModules.created.length) {
            console.log(
                `[super-html] restored engine companion modules: ${engineAliasState.engineModules.created.join(", ")}`
            );
        }
    }

    const hiddenWasmFiles = wasmSupport.hideWasmFiles(buildDir);

    try {
        await runSuperHtml(buildDir);
    } catch (error) {
        console.error(error);
    } finally {
        wasmSupport.restoreWasmFiles(hiddenWasmFiles);
        engineSupport.restoreEngineAlias(engineAliasState);
    }

    try {
        const patched = await wasmSupport.patchGeneratedHtml(buildDir, hiddenWasmFiles);
        if (patched.resources) {
            console.log(
                `[super-html] wasm support: embedded ${patched.resources} wasm file(s), patched ${patched.html} html file(s), ${patched.zip} zip file(s).`
            );
        }
    } catch (error) {
        console.error("[super-html] wasm support patch failed", error);
    } finally {
        wasmSupport.cleanupHiddenWasmFiles(hiddenWasmFiles);
    }

    try {
        const superHtmlDir = path.join(path.dirname(buildDir), "super-html");
        const enginePatched = await engineSupport.patchAllBuildOutputs(superHtmlDir);
        if (enginePatched.html || enginePatched.zip) {
            console.log(
                `[super-html] engine alias: patched ${enginePatched.html} html file(s), ${enginePatched.zip} zip file(s).`
            );
        }
    } catch (error) {
        console.error("[super-html] engine alias patch failed", error);
    }
};
