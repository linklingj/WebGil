// TTS에 전달할 숫자를 한국어 발음이 고정된 텍스트로 바꾼다.
// 화면 원문·문서 트리·LLM 컨텍스트는 건드리지 않는다. 엔진마다 `7`을 seven/일곱/칠처럼
// 다르게 읽는 문제를 피하려는 낭독 전용 정규화 단계다.

const DIGITS = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL_UNITS = ["", "십", "백", "천"];
const LARGE_UNITS = ["", "만", "억", "조", "경"];

/**
 * 한국어 TTS용 숫자 정규화.
 *
 * - 일반 수: `12` → `십이`, `2026` → `이천이십육`
 * - 날짜·금액·퍼센트·소수·서수는 단위를 읽기 좋은 말로 분리한다.
 * - 전화번호·사업자번호 같은 하이픈 식별자는 숫자를 하나씩 읽는다.
 * - URL·이메일·버전·경로·파일명은 기술 식별자라 변환하지 않는다.
 */
export function normalizeKoreanNumberSpeech(text: string): string {
  const protectedParts: string[] = [];
  const protect = (value: string): string => {
    // 숫자가 없는 private-use 문자 토큰을 쓴다. 그래야 뒤의 숫자 정규화가 보호 값을 건드리지 않는다.
    const token = `\uE000${String.fromCodePoint(0xe100 + protectedParts.length)}\uE001`;
    protectedParts.push(value);
    return token;
  };

  let result = text.replace(
    /https?:\/\/[^\s,]+|www\.[^\s,]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:[A-Za-z]+\d+|\d+)(?:\.\d+){2,}|(?:[A-Za-z]:\\\\|\\\\\\\\)[^\s,]+|(?:~|(?<![A-Za-z0-9]))\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+|[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9]{1,8}/g,
    protect,
  );

  // 날짜를 일반 숫자보다 먼저 처리해야 2026-08-19가 세 개의 숫자로 흩어지지 않는다.
  result = result.replace(
    /(?<!\d)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/g,
    (_match, year: string, month: string, day: string) =>
      `${toSinoNumber(year)} 년 ${toSinoNumber(month)} 월 ${toSinoNumber(day)} 일`,
  );
  // 사업자·주문·전화번호처럼 긴 하이픈 식별자는 수량이 아니므로 자릿수대로 읽는다.
  // 날짜는 바로 위에서 먼저 치환되어 이 규칙에 들어오지 않는다.
  result = result.replace(
    /(?<!\d)(\d{2,}(?:-\d{2,})+)(?!\d)/g,
    (_match, identifier: string) => {
      const digits = identifier.replace(/-/g, "");
      return digits.length >= 7 ? identifier.split("-").map(spellDigits).join(", ") : identifier;
    },
  );
  result = result.replace(
    /(?<!\d)(0\d{1,2})[-\s](\d{3,4})[-\s](\d{4})(?!\d)/g,
    (_match, first: string, second: string, third: string) =>
      `${spellDigits(first)}, ${spellDigits(second)}, ${spellDigits(third)}`,
  );
  result = result.replace(
    /(-?\d(?:\d|,(?=\d))*(?:\.\d+)?)\s*원(?![\p{L}\p{N}_])/gu,
    (_match, number: string) => `${speakNumber(number)} 원`,
  );
  result = result.replace(
    /(-?\d(?:\d|,(?=\d))*(?:\.\d+)?)\s*%(?![\p{L}\p{N}_])/gu,
    (_match, number: string) => `${speakNumber(number)} 퍼센트`,
  );
  result = result.replace(
    /(?<![A-Za-z0-9_])(-?\d(?:\d|,(?=\d))*)\s*번(?![A-Za-z0-9_])/g,
    (_match, number: string) => `${speakNumber(number)} 번`,
  );
  result = result.replace(
    /(?<![A-Za-z0-9_])(-?\d(?:\d|,(?=\d))*)\s*개(?![A-Za-z0-9_])/g,
    (_match, number: string) => `${speakNumber(number)} 개`,
  );
  result = result.replace(
    /(?<![A-Za-z0-9_])(-?\d(?:\d|,(?=\d))*)\s*년(?![A-Za-z0-9_])/g,
    (_match, number: string) => `${speakNumber(number)} 년`,
  );
  result = result.replace(
    /(?<![A-Za-z0-9_])-?\d(?:\d|,(?=\d))*(?:\.\d+)?(?![A-Za-z0-9_])/g,
    (number: string) => speakNumber(number),
  );
  result = normalizeSpeechSymbols(result);

  return result.replace(/\uE000([\uE100-\uF8FF])\uE001/g, (_match, marker: string) => {
    const index = marker.codePointAt(0)! - 0xe100;
    return protectedParts[index] ?? "";
  });
}

/**
 * 화면 표현용 특수문자를 TTS가 안정적으로 읽을 수 있는 한국어 말로 바꾼다.
 * URL·이메일·버전·경로·파일명은 위 보호 토큰에 들어 있으므로 이 단계에서 변형되지 않는다.
 */
function normalizeSpeechSymbols(text: string): string {
  return text
    .replace(/\r?\n+/g, ". ")
    .replace(/…/g, ". ")
    .replace(/→/g, " 다음 ")
    .replace(/←/g, " 이전 ")
    .replace(/↔/g, " 양방향 ")
    .replace(/⇒/g, " 이어서 ")
    .replace(/※/g, " 참고 ")
    .replace(/[•·]/g, ", ")
    .replace(/\+/g, " 플러스 ")
    .replace(/\//g, " 슬래시 ")
    .replace(/_/g, " 밑줄 ")
    .replace(/#/g, " 샵 ")
    .replace(/@/g, " 골뱅이 ")
    .replace(/&/g, " 앤드 ")
    .replace(/\*/g, " 별표 ")
    .replace(/=/g, " 이퀄 ")
    .replace(/\|/g, " 세로줄 ")
    // 괄호는 보통 보충 설명의 경계일 뿐이라 읽으면 문장 흐름을 과하게 끊는다.
    .replace(/[()[\]{}]/g, " ")
    .replace(/-/g, " 하이픈 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function speakNumber(value: string): string {
  const normalized = value.replace(/,/g, "");
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer, decimal] = unsigned.split(".");
  const spokenInteger = toSinoNumber(integer);
  const spoken = decimal === undefined ? spokenInteger : `${spokenInteger} 점 ${spellDigits(decimal)}`;
  return negative ? `마이너스 ${spoken}` : spoken;
}

function spellDigits(value: string): string {
  return value.split("").map((digit) => DIGITS[Number(digit)] ?? digit).join(" ");
}

/** 0 이상 정수를 한자어 수사로 읽는다. 매우 긴 식별자는 보호 규칙에서 제외된다. */
function toSinoNumber(value: string): string {
  const digits = value.replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(digits) || digits.length > LARGE_UNITS.length * 4) return value;
  if (digits === "0") return DIGITS[0];

  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 4) groups.unshift(digits.slice(Math.max(0, end - 4), end));

  return groups
    .map((group, index) => {
      const spoken = speakFourDigits(group);
      const unitIndex = groups.length - index - 1;
      // 만 단위의 1은 보통 "만"으로 읽는다. 억 이상은 "일억"처럼 일도 읽는다.
      const omitOneBeforeMan = group === "1" && unitIndex === 1;
      return spoken ? `${omitOneBeforeMan ? "" : spoken}${LARGE_UNITS[unitIndex]}` : "";
    })
    .filter(Boolean)
    .join(" ");
}

function speakFourDigits(group: string): string {
  const padded = group.padStart(4, "0");
  const out: string[] = [];
  for (let index = 0; index < padded.length; index++) {
    const digit = Number(padded[index]);
    if (digit === 0) continue;
    const unit = SMALL_UNITS[padded.length - index - 1];
    // 십·백·천 앞의 '일'은 한국어 수사에서 보통 생략한다.
    out.push(`${digit === 1 && unit ? "" : DIGITS[digit]}${unit}`);
  }
  return out.join("");
}
