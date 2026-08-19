'use strict';

/**
 * Màu terminal có điều kiện — dùng chung cho mọi tool.
 * =====================================================
 * Các tool dành cho AI agent (headless-verifier, zero-gc-linter, scene-inspector,
 * verify-prefab...) đang nhúng escape ANSI vô điều kiện. Khi agent pipe output,
 * mỗi nhãn tốn thêm token rác cho `\x1b[36m` / `\x1b[0m` mà không mang thông tin.
 *
 * Quy tắc bật màu (theo thứ tự ưu tiên):
 *   1. FORCE_COLOR=1        -> luôn bật (cho terminal giả lập trong CI)
 *   2. NO_COLOR có mặt      -> luôn tắt (chuẩn no-color.org)
 *   3. CI có mặt            -> tắt
 *   4. stdout không phải TTY -> tắt  (đây là trường hợp AI agent)
 *   5. còn lại              -> bật
 */

const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function computeEnabled(env = process.env, stream = process.stdout) {
  if (env.FORCE_COLOR === '1' || env.FORCE_COLOR === 'true') return true;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.CI !== undefined && env.CI !== '' && env.CI !== 'false') return false;
  return !!(stream && stream.isTTY);
}

let enabled = computeEnabled();

/** Bọc text bằng màu `name`, hoặc trả nguyên text khi màu bị tắt. */
function color(name, text) {
  if (!enabled) return String(text);
  const code = CODES[name];
  return code ? `${code}${text}${CODES.reset}` : String(text);
}

/** Cho phép test/ghi đè thủ công. */
function setEnabled(value) {
  enabled = !!value;
}

function isColorEnabled() {
  return enabled;
}

/**
 * Bỏ mọi escape ANSI khỏi một chuỗi — dùng khi phải in lại output của tool khác
 * mà không muốn kéo theo token rác.
 */
function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

module.exports = { color, setEnabled, isColorEnabled, stripAnsi, computeEnabled, CODES };
