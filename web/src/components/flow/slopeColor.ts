/** 경사 수준 lv(0 평지 · 1 완만 · 2 언덕, 사이 값은 섞이는 구간)를 색으로 바꾼다.
   색 자체는 tokens.css 의 --g-* 에서 읽는다 — CSS(차트·범례)는 color-mix, 카카오 폴리라인은 같은 oklab 식을 JS 로 */

const TOK = ["--g-flat", "--g-gentle", "--g-hill"];

/** lv → CSS 색 문자열. 테마가 바뀌어도 var() 라서 자동으로 따라간다 */
export function levelCss(lv: number): string {
  const x = Math.min(2, Math.max(0, lv));
  const i = Math.min(1, Math.floor(x));
  const t = Math.round((x - i) * 100);
  if (t === 0) return `var(${TOK[i]})`;
  if (t === 100) return `var(${TOK[i + 1]})`;
  return `color-mix(in oklab, var(${TOK[i + 1]}) ${t}%, var(${TOK[i]}))`;
}

type Lab = [number, number, number];

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function srgbToOklab([r, g, b]: number[]): Lab {
  const [R, G, B] = [r, g, b].map((v) => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `#${lin.map((v) => Math.round(Math.min(1, Math.max(0, fromLin(v))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** 토큰 3개를 sRGB 로 읽어 oklab 으로 바꿔 둔다 (canvas 가 oklch 를 파싱해 준다). 테마가 바뀌면 다시 부른다 */
export function readRamp(): Lab[] {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return TOK.map((t) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${t})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    return srgbToOklab(Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)));
  });
}

/** lv → #rrggbb (카카오 폴리라인용) */
export function levelHex(ramp: Lab[], lv: number): string {
  const x = Math.min(2, Math.max(0, lv));
  const i = Math.min(1, Math.floor(x));
  const t = x - i;
  return oklabToHex(ramp[i].map((v, k) => v + (ramp[i + 1][k] - v) * t) as Lab);
}
