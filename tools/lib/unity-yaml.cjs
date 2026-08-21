'use strict';
/**
 * Minimal Unity-YAML reader.
 * Unity serializes a strict, machine-generated subset of YAML: 2-space indent,
 * block mappings, block sequences and flow mappings. A full YAML library is both
 * slower and looser than we need here, so this parses exactly that subset.
 */

function parseScalar (raw) {
    const s = raw.trim();
    if (s === '') return '';
    if (s[0] === '{' || s[0] === '[') return parseFlow(s);
    if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
    if (s[0] === '"') {
        try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); }
    }
    if (/^-?\d+$/.test(s)) {
        // Unity fileIDs can be 19 digits. Rounding one to a double silently breaks
        // every reference that points at it, so keep unsafe integers as strings.
        const n = parseInt(s, 10);
        return Number.isSafeInteger(n) ? n : s;
    }
    if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return parseFloat(s);
    return s;
}

/** Parse a flow mapping/sequence such as `{fileID: 0, guid: ab, type: 3}` or `[]`. */
function parseFlow (s) {
    let i = 0;
    function ws () { while (i < s.length && /\s/.test(s[i])) i++; }
    function value () {
        ws();
        if (s[i] === '{') return mapping();
        if (s[i] === '[') return sequence();
        const start = i;
        while (i < s.length && s[i] !== ',' && s[i] !== '}' && s[i] !== ']') i++;
        return parseScalar(s.slice(start, i));
    }
    function mapping () {
        const out = {}; i++; ws();
        if (s[i] === '}') { i++; return out; }
        for (;;) {
            ws();
            const ks = i;
            while (i < s.length && s[i] !== ':') i++;
            const key = s.slice(ks, i).trim(); i++;
            out[key] = value(); ws();
            if (s[i] === ',') { i++; continue; }
            if (s[i] === '}') { i++; }
            break;
        }
        return out;
    }
    function sequence () {
        const out = []; i++; ws();
        if (s[i] === ']') { i++; return out; }
        for (;;) {
            out.push(value()); ws();
            if (s[i] === ',') { i++; continue; }
            if (s[i] === ']') { i++; }
            break;
        }
        return out;
    }
    return value();
}

const indentOf = (line) => line.length - line.replace(/^ +/, '').length;

/**
 * Parse `lines[from, to)` as a YAML value whose members sit at column `indent`.
 */
function parseBlock (lines, from, to, indent) {
    let first = from;
    while (first < to && lines[first].trim() === '') first++;
    if (first >= to) return null;

    if (lines[first].trimStart().startsWith('- ')) return parseSeq(lines, first, to, indent);
    return parseMap(lines, first, to, indent);
}

function parseSeq (lines, from, to, indent) {
    const out = [];
    let i = from;
    while (i < to) {
        const line = lines[i];
        if (line.trim() === '') { i++; continue; }
        if (indentOf(line) < indent) break;
        if (!line.trimStart().startsWith('- ')) break;
        const rest = line.slice(indent + 2);
        let j = i + 1;
        while (j < to) {
            const l = lines[j];
            if (l.trim() === '') { j++; continue; }
            const ind = indentOf(l);
            if (ind < indent) break;
            if (ind === indent && l.trimStart().startsWith('- ')) break;
            if (ind === indent) break;
            j++;
        }
        const head = rest.trim();
        if (head.startsWith('{') || head.startsWith('[')) {
            out.push(parseScalar(rest));
        } else if (j > i + 1 || head.includes(':')) {
            const sub = [' '.repeat(indent + 2) + rest].concat(lines.slice(i + 1, j));
            out.push(parseBlock(sub, 0, sub.length, indent + 2));
        } else {
            out.push(parseScalar(rest));
        }
        i = j;
    }
    return out;
}

function parseMap (lines, from, to, indent) {
    const out = {};
    let i = from;
    while (i < to) {
        const line = lines[i];
        if (line.trim() === '') { i++; continue; }
        const ind = indentOf(line);
        if (ind < indent) break;
        if (ind > indent) { i++; continue; }
        const trimmed = line.trim();
        if (trimmed.startsWith('- ')) break;
        const ci = trimmed.indexOf(':');
        if (ci < 0) { i++; continue; }
        const key = trimmed.slice(0, ci).trim();
        const inlineVal = trimmed.slice(ci + 1);

        if (inlineVal.trim() !== '') {
            out[key] = parseScalar(inlineVal);
            i++;
            continue;
        }

        // Children are either deeper-indented (mapping) or a sequence at the SAME
        // indent as the key -- Unity writes block sequences without extra indent.
        let j = i + 1;
        while (j < to && lines[j].trim() === '') j++;
        if (j >= to) { out[key] = null; i = j; continue; }

        const childIndent = indentOf(lines[j]);
        if (childIndent === ind && lines[j].trimStart().startsWith('- ')) {
            let end = j;
            while (end < to) {
                const l = lines[end];
                if (l.trim() === '') { end++; continue; }
                const li = indentOf(l);
                if (li < ind) break;
                if (li === ind && !l.trimStart().startsWith('- ')) break;
                end++;
            }
            out[key] = parseSeq(lines, j, end, ind);
            i = end;
            continue;
        }
        if (childIndent > ind) {
            let end = j;
            while (end < to) {
                const l = lines[end];
                if (l.trim() === '') { end++; continue; }
                if (indentOf(l) <= ind) break;
                end++;
            }
            out[key] = parseBlock(lines, j, end, childIndent);
            i = end;
            continue;
        }
        out[key] = null;
        i = j;
    }
    return out;
}

/** Split a Unity asset/scene file into `{ classId, fileID, typeName, data }` documents. */
function parseUnityFile (text) {
    const lines = text.split(/\r?\n/);
    const docs = [];
    let cur = null;
    let start = 0;
    const flush = (end) => {
        if (!cur) return;
        const body = lines.slice(start, end);
        const typeLine = body.findIndex((l) => l.trim() !== '' && !l.startsWith('%') && indentOf(l) === 0);
        if (typeLine >= 0) {
            cur.typeName = body[typeLine].trim().replace(/:$/, '');
            const rest = body.slice(typeLine + 1);
            cur.data = parseBlock(rest, 0, rest.length, 2) || {};
        } else {
            cur.typeName = 'Unknown';
            cur.data = {};
        }
        docs.push(cur);
    };
    for (let i = 0; i < lines.length; i++) {
        const m = /^--- !u!(\d+) &(-?\d+)/.exec(lines[i]);
        if (!m) continue;
        flush(i);
        cur = { classId: parseInt(m[1], 10), fileID: m[2], typeName: '', data: null };
        start = i + 1;
    }
    flush(lines.length);
    return docs;
}

/** Parse a standalone `.meta` / `.asset` file (single implicit document). */
function parseUnityMeta (text) {
    const lines = text.split(/\r?\n/);
    return parseBlock(lines, 0, lines.length, 0) || {};
}

module.exports = { parseUnityFile, parseUnityMeta, parseBlock, parseFlow, parseScalar };
