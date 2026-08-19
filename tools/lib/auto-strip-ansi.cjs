'use strict';

/**
 * Tự động bỏ escape ANSI khi output KHÔNG đi ra terminal.
 * =======================================================
 * `require('./lib/auto-strip-ansi.cjs')` một dòng ở đầu tool là đủ.
 *
 * Vì sao làm ở tầng stdout thay vì sửa từng chuỗi: các tool hiện có nhúng
 * escape rải rác trong template literal (68 chỗ trên 5 file). Viết lại từng chỗ
 * rủi ro làm vỡ literal; chặn ở stdout thì phủ hết, kể cả escape thêm về sau.
 *
 * Đo được: output của `ai:scene` có 793/3513 byte là escape ANSI (22%) — với
 * AI agent đó là token rác thuần, không mang thông tin nào.
 *
 * Không làm gì khi màu đang bật (người dùng ngồi ở terminal thật).
 */

const { isColorEnabled, stripAnsi } = require('./term-color.cjs');

if (!isColorEnabled() && !process.env.PLAYABLE_KEEP_ANSI) {
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    stream.write = (chunk, encoding, callback) => {
      if (typeof chunk === 'string') {
        return original(stripAnsi(chunk), encoding, callback);
      }
      if (Buffer.isBuffer(chunk)) {
        return original(Buffer.from(stripAnsi(chunk.toString('utf8')), 'utf8'), encoding, callback);
      }
      return original(chunk, encoding, callback);
    };
  }
}

module.exports = {};
