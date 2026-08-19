'use strict';

/**
 * Cache tăng dần cho porter prefab.
 * =================================
 * Bỏ qua prefab mà CẢ nguồn LẪN output đều không đổi từ lần chạy trước.
 *
 * Vì sao cần: vòng làm việc của AI agent là port -> xem report -> sửa -> port lại.
 * Không có cache thì mỗi lần lặp phải trả lại toàn bộ chi phí, kể cả với những
 * prefab chưa ai chạm vào.
 *
 * ĐỘ MỊN CỦA CACHE — cố ý chọn thô để KHÔNG BAO GIỜ trả kết quả cũ sai:
 *   hit = (prefab nguồn không đổi) AND (prefab đích không đổi)
 *         AND (KHÔNG có file nào trong phạm vi --src thay đổi)
 *
 * Vì porter không khai báo được đầy đủ đồ thị phụ thuộc của một prefab (nested
 * prefab, material, sprite, controller...), việc chỉ so mtime của prefab nguồn
 * là KHÔNG đủ: sửa một material sẽ không làm cache hết hiệu lực. Nên cache dùng
 * thêm "chữ ký phạm vi": số file + mtime lớn nhất của mọi asset dưới --src.
 * Sửa bất cứ thứ gì trong phạm vi đó thì toàn bộ cache của phạm vi mất hiệu lực.
 *
 * Đánh đổi: sửa một prefab sẽ khiến cả phạm vi port lại. Bù lại, không có
 * đường nào để cache trả ra output cũ đã sai. Cache sai tệ hơn không cache.
 */

const fs = require('fs');
const path = require('path');

const CACHE_VERSION = 1;

/** Dấu vân tay của một file: kích thước + mtime. Đủ nhạy, không cần đọc nội dung. */
function fileStamp(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${Math.floor(st.mtimeMs)}`;
  } catch (_) {
    return 'missing';
  }
}

/**
 * Chữ ký của cả phạm vi nguồn: số file asset + mtime lớn nhất.
 * Một lần duyệt thư mục --src (không phải toàn bộ Assets), nên rẻ.
 */
const SCOPE_EXTENSIONS = new Set([
  '.prefab', '.mat', '.asset', '.controller', '.anim', '.physicmaterial',
  '.fbx', '.obj', '.png', '.jpg', '.jpeg', '.tga', '.psd', '.exr',
  '.shader', '.shadergraph', '.cs', '.meta',
]);

function scopeSignature(root) {
  let count = 0;
  let newest = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!SCOPE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      count += 1;
      try {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime > newest) newest = mtime;
      } catch (_) { /* file vừa bị xoá — bỏ qua */ }
    }
  };
  try {
    const stat = fs.statSync(root);
    if (stat.isDirectory()) walk(root);
    else { count = 1; newest = stat.mtimeMs; }
  } catch (_) {
    return 'unreadable';
  }
  return `${count}:${Math.floor(newest)}`;
}

/** Những option làm output khác đi — đổi chúng thì phải port lại. */
function optionsFingerprint(options) {
  return JSON.stringify({
    recursive: !!options.recursive,
    copyAssets: !!options.copyAssets,
    convertFbxFallback: !!options.convertFbxFallback,
    scriptMode: options.scriptMode || '',
    stripPrivatePrefix: options.stripPrivatePrefix !== false,
    layerMap: options.layerMap || null,
    unityRoot: options.unityRoot || '',
    cocosRoot: options.cocosRoot || '',
    modelImportWaitMs: Number(options.modelImportWaitMs ?? -1),
  });
}

class PortCache {
  /**
   * @param {string} cacheFile đường dẫn file cache (mặc định .unity/port-cache.json)
   * @param {object} options option của lần chạy hiện tại
   * @param {boolean} enabled false thì mọi lookup đều miss (dùng cho --no-cache)
   */
  constructor(cacheFile, options, enabled = true, scopeRoot = null) {
    this.file = cacheFile;
    this.enabled = enabled;
    this.optionsKey = optionsFingerprint(options);
    this.scopeKey = scopeRoot ? scopeSignature(scopeRoot) : 'no-scope';
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
    this.dirty = false;
    this._load();
  }

  _load() {
    if (!this.enabled || !this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.version === CACHE_VERSION
          && raw.optionsKey === this.optionsKey
          && raw.scopeKey === this.scopeKey) {
        for (const [key, value] of Object.entries(raw.entries || {})) this.entries.set(key, value);
      }
    } catch (_) {
      // Không đọc được thì bắt đầu lại từ đầu — an toàn hơn là đoán.
    }
  }

  /**
   * Prefab này có thể bỏ qua không?
   * @param {string} sourceFile prefab nguồn của Unity
   * @param {string} outputFile prefab đích của Cocos
   * @param {string[]} dependencies các file Unity mà prefab phụ thuộc
   */
  canSkip(sourceFile, outputFile) {
    if (!this.enabled) return false;
    const entry = this.entries.get(path.resolve(sourceFile));
    if (!entry) { this.misses += 1; return false; }

    // Output phải còn tồn tại và đúng như lúc ghi ra.
    if (!fs.existsSync(outputFile)) { this.misses += 1; return false; }
    if (entry.output !== fileStamp(outputFile)) { this.misses += 1; return false; }

    // Nguồn không đổi.
    if (entry.source !== fileStamp(sourceFile)) { this.misses += 1; return false; }

    // Phụ thuộc gián tiếp (material/sprite/nested prefab) đã được bao bởi
    // scopeKey ở tầng load: nếu bất kỳ file nào trong --src đổi thì toàn bộ
    // cache của phạm vi này đã bị loại từ đầu.
    this.hits += 1;
    return true;
  }

  /** Ghi nhận một prefab vừa port xong. */
  record(sourceFile, outputFile, counts = null) {
    if (!this.enabled) return;
    this.entries.set(path.resolve(sourceFile), {
      source: fileStamp(sourceFile),
      output: fileStamp(outputFile),
      counts: counts ? { high: counts.high, medium: counts.medium, low: counts.low } : null,
    });
    this.dirty = true;
  }

  /** Lấy lại severity đã lưu để bản tóm tắt vẫn đúng khi bỏ qua prefab. */
  cachedCounts(sourceFile) {
    const entry = this.entries.get(path.resolve(sourceFile));
    return (entry && entry.counts) || { high: 0, medium: 0, low: 0 };
  }

  save() {
    if (!this.enabled || !this.file || !this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const payload = {
        version: CACHE_VERSION,
        optionsKey: this.optionsKey,
        scopeKey: this.scopeKey,
        savedAt: new Date().toISOString(),
        entries: Object.fromEntries(this.entries),
      };
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.warn(`[unity-cocos-port] WARN: không ghi được cache (${error.message}); lần sau sẽ port lại toàn bộ.`);
    }
  }

  summary() {
    if (!this.enabled) return 'cache: tắt';
    return `cache: ${this.hits} hit, ${this.misses} miss`;
  }
}

module.exports = { PortCache, fileStamp, optionsFingerprint, scopeSignature, CACHE_VERSION };
