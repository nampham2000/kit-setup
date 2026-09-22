"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Build-time counterpart to PlayableConfigManager: use the same authored JSON,
// without importing Cocos runtime components into the Creator build worker.
function obfuscationPolicy(config) {
    const value = config && config.build && config.build.obfuscateJavaScript;
    if (value !== undefined && typeof value !== "boolean") {
        throw new TypeError("playable-config.json: build.obfuscateJavaScript must be a boolean");
    }
    return value;
}

function readProjectPolicy(projectRoot) {
    const file = path.join(projectRoot, "assets", "resources", "playable-config.json");
    if (!fs.existsSync(file)) return undefined;
    return obfuscationPolicy(JSON.parse(fs.readFileSync(file, "utf8")));
}

// Super-HTML 5.2.3's CocosMain constructor synchronously reads cache.get() and
// copies enable_obfuscator into its build config. Scope the override to that
// constructor only; never persist panel localStorage or edit the vendor core.
// Undefined retains the extension's existing behavior for other projects.
function withObfuscationPolicy(cache, enabled, construct) {
    if (enabled === undefined) return construct();
    if (typeof enabled !== "boolean" || typeof cache?.get !== "function") {
        throw new TypeError("Unsupported Super-HTML obfuscation policy/cache API");
    }
    const original = cache.get;
    const override = function (...args) {
        return { ...original.apply(this, args), enable_obfuscator: enabled };
    };
    cache.get = override;
    try {
        return construct();
    } finally {
        if (cache.get === override) cache.get = original;
    }
}

module.exports = { obfuscationPolicy, readProjectPolicy, withObfuscationPolicy };
