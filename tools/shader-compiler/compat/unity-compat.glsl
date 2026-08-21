// ---- Unity -> GLSL compatibility layer ------------------------------------
// Inlined into both stages by cocos-effect-generator. Không dùng .chunk vì việc
// phân giải chunk phụ thuộc vị trí file trong asset db của từng project; inline
// thì chạy đúng ở mọi layout.
//
// Năm hàm dưới đây tương ứng năm chỗ HLSL và GLSL khác nhau mà vẫn compile được
// ở cả hai bên — nghĩa là sai thì không có lỗi biên dịch, chỉ khác hình.

#define CLIP(x) if ((x) < 0.0) discard

float sat (float x) { return clamp(x, 0.0, 1.0); }
vec2  sat (vec2 x)  { return clamp(x, 0.0, 1.0); }
vec3  sat (vec3 x)  { return clamp(x, 0.0, 1.0); }
vec4  sat (vec4 x)  { return clamp(x, 0.0, 1.0); }

// HLSL '%' cắt về 0, GLSL mod() làm tròn xuống. Hai cái lệch nhau khi toán hạng
// âm — đúng trường hợp các property tốc độ cuộn (scroll speed) hay dùng.
float hmod (float x, float y) {
  float q = x / y;
  return x - y * (sign(q) * floor(abs(q)));
}
vec2 hmod (vec2 x, float y) { return vec2(hmod(x.x, y), hmod(x.y, y)); }

// HLSL mul(M, v) với M = float2x2(c, -s, s, c) khai báo theo hàng.
vec2 rotRow (vec2 v, float c, float s) { return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// HLSL mul(v, M) cùng M — vector bên trái làm chuyển vị tích.
vec2 rotCol (vec2 v, float c, float s) { return vec2(c * v.x + s * v.y, -s * v.x + c * v.y); }

/**
 * Lấy mẫu theo quy ước UV của Unity.
 *
 * Gốc texture của Unity ở dưới-trái, của Cocos ở trên-trái. Lật UV của mesh thì
 * ảnh hiện đúng nhưng LẶNG LẼ đảo ngược mọi cách dùng uv.y mang tính thủ tục —
 * gradient nền, gió cỏ, sọc hologram, UV clipping, offset đổ bóng. Vì vậy giữ
 * nguyên không gian UV của Unity trong toàn shader và chỉ lật ở chỗ lấy mẫu.
 * Vẫn đúng khi UV lặp (REPEAT): 1 - fract(y) chính là hàng đối xứng trong mỗi ô,
 * đúng bằng phép hiệu chỉnh cần thiết.
 */
vec4 texU (sampler2D s, vec2 uv) { return texture(s, vec2(uv.x, 1.0 - uv.y)); }
