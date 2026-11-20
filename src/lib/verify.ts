// 답변 검증: AI가 낸 최종 답을 서버가 규칙으로 다시 확인한다.
// 도구 결과(자격 계산)·오늘 날짜·공식 도메인과 대조해, 고쳐야 할 점이 있으면 AI에게 한 번 다시 쓰게 한다.
import { isNegativeAnswer, parseCard } from "./card";
import { resolveAlternatives, type AltCandidate } from "./alternatives";
import { benefitExcerpt, findAmountIssues, pickOfficial, type OfficialRecord } from "./officialFacts";
import type { EligibilitySummary } from "./eligibility";
import { localYmd } from "./deadline";

export interface VerifyCheck {
  name: string;
  ok: boolean;
  note: string;
  // fix: AI에게 고쳐 쓰게 함 · warn: 화면에 알리기만 함
  severity: "fix" | "warn";
}

export interface Verification {
  passed: boolean;
  retried: boolean;
  checks: VerifyCheck[];
}

// 정부·공공기관 도메인 (정부24는 gov.kr)
const OFFICIAL_HOST = /(^|\.)(go\.kr|or\.kr|gov\.kr)$/;

// 출처 목록에 남길지: 공공기관 도메인이거나 사용자가 등록한 사이트만 (검색 출처는 제목이 도메인으로 온다)
export function isTrustedSource(s: { title: string; url: string }, hosts: string[]) {
  let host = "";
  try {
    host = new URL(s.url).hostname.replace(/^www\./, "");
  } catch {}
  const title = s.title.trim().toLowerCase().replace(/^www\./, "");
  return [host, title].some((h) => OFFICIAL_HOST.test(h) || hosts.some((x) => h === x || h.endsWith("." + x)));
}
// "엑셀로 정리해줘", "워드 파일 만들어 줘", "csv로 뽑아줘", "캘린더 파일 줘" 같은 요청
const WANTS_FILE =
  /(엑셀|xlsx|스프레드시트|csv|docx|워드\s*(파일|문서)|워드로|캘린더\s*파일|\bics\b|파일로|pdf로|hwp로|한글\s*파일로)[^.?!\n]{0,14}(만들|뽑|작성|정리|내보|내려|다운|저장|줘|주세요)/i;

function rawLinks(text: string): string[] {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return [];
  try {
    const raw = JSON.parse(text.slice(a, b + 1));
    const urls: string[] = [];
    for (const l of Array.isArray(raw?.links) ? raw.links : []) if (l?.url) urls.push(String(l.url));
    return urls;
  } catch {
    return [];
  }
}

export function verifyAnswer(
  text: string,
  opts: {
    summary?: EligibilitySummary;
    today?: Date;
    hosts?: string[];
    alternativesSearched?: boolean;
    alternatives?: AltCandidate[];
    question?: string;
    fileCount?: number;
    official?: OfficialRecord[];
  } = {}
): VerifyCheck[] {
  const checks: VerifyCheck[] = [];
  // 날짜 비교는 한국 시간 기준 (프롬프트에 알려 준 오늘과 같게)
  const [ty, tm, td] = localYmd(opts.today ?? new Date()).split("-").map(Number);
  const todayYmd = new Date(ty, tm - 1, td);
  const s = opts.summary;
  const hosts = opts.hosts ?? [];

  // 1. 형식: 화면이 카드로 보여줄 수 있는 JSON인지
  const card = parseCard(text, hosts.map((host) => ({ name: host, url: `https://${host}`, host })));
  checks.push(
    card
      ? { name: "답변 형식", ok: true, note: "근거 카드로 표시 가능", severity: "fix" }
      : { name: "답변 형식", ok: false, note: "정해진 JSON 카드 형식이 아닙니다. JSON 객체 하나만 출력하세요.", severity: "fix" }
  );

  // 2. 수치: 자격 계산 도구 결과와 같은지
  if (s) {
    const wrong: string[] = [];
    if (s.percents.length) {
      for (const m of Array.from(text.matchAll(/중위[^%]{0,40}?(\d{1,3}(?:\.\d+)?)\s*%/g))) {
        const v = Number(m[1]);
        if (!s.percents.some((p) => Math.abs(v - p) <= 0.2)) wrong.push(`${v}%`);
      }
    }
    checks.push(
      wrong.length
        ? {
            name: "계산 수치",
            ok: false,
            note: `자격 확인 결과와 공고 기준(${s.percents.join("%, ")}%)에 없는 수치(${wrong.join(", ")})를 썼습니다. 도구 결과 수치로 고치세요.`,
            severity: "fix",
          }
        : { name: "계산 수치", ok: true, note: `${s.policyName} 자격 확인 결과와 일치`, severity: "fix" }
    );

    // 3. 판정: 대조 결과와 반대로 말하지 않는지
    // "충족하지 못", "맞지 않"처럼 부정이 이어지는 말은 긍정으로 세지 않는다
    const positive =
      /(신청\s*대상(에(?!서)|입니다|이에요|이 됩니다)|받을\s*수\s*있(어요|습니다)|(자격|요건)(은|이|을|도)?\s*(모두\s*)?(충족(?!(하지|되지)\s*(않|못)|\s*(못|안))|맞(?!지\s*(않|못)))|맞을\s*수\s*있)/.test(text);
    const negative = /(대상이\s*아니|요건을\s*충족하지\s*못|받을\s*수\s*없|부적격)/.test(text);
    // 미충족 판정에서는 "어렵다", "초과" 같은 말로 안 된다고 밝혔으면 맞게 안내한 것으로 본다
    const negativeAny =
      negative ||
      /(대상에서\s*제외|아닙니다|(충족|해당)(하지|되지)\s*(않|못)|충족\s*못|맞지\s*(않|못)|신청(할|이)?\s*수\s*없|어렵|불가|미충족|초과)/.test(text);
    const mentionsCheck = /확인|추가|남아|필요/.test(text);
    let verdictIssue = "";
    if (s.verdict === "ineligible" && positive && !negativeAny) verdictIssue = "대조 결과는 '미충족 조건 있음'인데 신청 대상이라고 안내했습니다.";
    else if (s.verdict === "eligible" && negative && !positive) verdictIssue = "대조 결과는 '확인한 조건 충족'인데 대상이 아니라고 안내했습니다.";
    else if (s.verdict === "needs_check" && positive && !mentionsCheck)
      verdictIssue = "확인이 남은 조건이 있는데 확정적으로 대상이라고 안내했습니다. 남은 조건을 밝히세요.";
    const verdictLabel = { eligible: "확인한 조건 충족", needs_check: "확인이 더 필요", ineligible: "미충족 조건 있음" }[s.verdict];
    checks.push(
      verdictIssue
        ? { name: "판정 일치", ok: false, note: verdictIssue, severity: "fix" }
        : { name: "판정 일치", ok: true, note: `계산 판정(${verdictLabel})과 같은 결론`, severity: "fix" }
    );
  }

  // 4. 날짜: 이미 지난 마감일을 지금 신청 가능한 것처럼 안내하지 않는지
  const past: string[] = [];
  for (const m of Array.from(text.matchAll(/(20\d{2})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})\s*일?/g))) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime()) || d >= todayYmd) continue;
    const end = (m.index ?? 0) + m[0].length;
    // "5월 29일 접수 마감", "2026.5.29.(금) 마감"처럼 날짜 바로 뒤에 마감이 오면 마감 사실을 말한 것이고,
    // "2026.3.30.~2026.5.29."의 앞 날짜는 기간의 시작일이라 마감일이 아니다
    const after = text.slice(end, end + 14);
    // 다만 "마감이니 서두르세요"처럼 뒤에서 아직 신청할 수 있다고 말하면 잡는다
    const stillOpen = /(서두르|신청하세요|신청\s*가능|접수\s*중|진행\s*중|남았|놓치지)/.test(text.slice(end, end + 30));
    if (!stillOpen && /^[.\s]*(\([월화수목금토일]\))?\s*((접수|신청|모집)\s*)?마감/.test(after)) continue;
    if (/^[.\s]*(\([월화수목금토일]\))?\s*[~∼～–]/.test(after)) continue;
    const around = text.slice(Math.max(0, (m.index ?? 0) - 20), end + 20);
    // "마감됐다", "차기 공고 확인"처럼 이미 끝났다고 밝힌 문맥은 제외한다
    if (/(마감|까지|기한)/.test(around) && !/(마감됐|마감되었|마감된|종료|지났|끝났|이미|지난|불가|차기|다음\s*(공고|모집|접수)|내년|재공고)/.test(around)) past.push(m[0].trim());
  }
  checks.push(
    past.length
      ? {
          name: "날짜",
          ok: false,
          note: `오늘(${ty}.${tm}.${td}) 기준 이미 지난 마감일(${past.join(", ")})을 신청 가능한 것처럼 안내했습니다. 마감됐다고 밝히고 다음 접수 일정이나 확인 방법을 안내하세요.`,
          severity: "fix",
        }
      : { name: "날짜", ok: true, note: "지난 마감일을 신청 가능처럼 안내하지 않음", severity: "fix" }
  );

  // 5. 확정 표현: 최종 판정은 접수 기관이 하므로 단정하지 않는지
  const absolute = text.match(/(100\s*%\s*(통과|합격|선정|받)|무조건|반드시\s*받|확실히\s*받|틀림없이)/);
  checks.push(
    absolute
      ? {
          name: "확정 표현",
          ok: false,
          note: `'${absolute[0]}' 같은 확정 표현을 썼습니다. 최종 판정은 접수 기관이 한다고 바꾸세요.`,
          severity: "fix",
        }
      : { name: "확정 표현", ok: true, note: "단정 표현 없음", severity: "fix" }
  );

  // 대안: "안 된다"로 끝내지 않고 다른 길을 찾았는지 (안 된다는 답일 때만 검사)
  if (card && (s?.verdict === "ineligible" || isNegativeAnswer(card.summary))) {
    // 화면에 실제로 나가는 대안만 센다 (원본도 공식 링크도 없는 대안은 빠진다)
    const count = resolveAlternatives(card, opts.alternatives || [], true).alternatives?.length || 0;
    checks.push(
      count || opts.alternativesSearched
        ? {
            name: "대안 제시",
            ok: true,
            note: count ? `대신 쓸 수 있는 지원 ${count}개 제시` : "실시간 공고에서 대안을 찾아봄",
            severity: "fix",
          }
        : {
            name: "대안 제시",
            ok: false,
            note: "안 된다고만 답했습니다. 사용자의 원래 목적을 정해 find_alternatives로 다른 지원을 찾고, alternatives에 넣어 다시 답하세요.",
            severity: "fix",
          }
    );
  }

  // 금액: 정책 금액이 가장 최근 공식 원문(같은 해의 다른 공식 원문 포함)과 같은지
  const officialUsed = pickOfficial(opts.official || []);
  if (card && officialUsed.length) {
    const issues = findAmountIssues(card, opts.official || []);
    checks.push(
      issues.length
        ? {
            name: "공식 원문",
            ok: false,
            note: issues
              .slice(0, 3)
              .map(
                (i) =>
                  `'${i.policy}'의 '${i.amount}'이(가) 최신 공식 원문(${i.record.source}, ${i.record.updated} 수정)에 없습니다. 원문: "${benefitExcerpt(i.record)}"`
              )
              .join(" / ")
              .concat(" 원문 기준으로 고치세요."),
            severity: "fix",
          }
        : {
            name: "공식 원문",
            ok: true,
            note: `정책 ${officialUsed.length}개를 최신 공식 원문과 대조`,
            severity: "fix",
          }
    );
  }

  // 파일: 파일을 달라고 했는데 말로만 답하지 않았는지
  if (WANTS_FILE.test(opts.question || "")) {
    const count = opts.fileCount || 0;
    checks.push(
      count
        ? { name: "파일 생성", ok: true, note: `요청한 파일 ${count}개 생성`, severity: "fix" }
        : {
            name: "파일 생성",
            ok: false,
            note: "파일을 요청받았는데 만들지 않았습니다. create_file을 호출해 파일을 만든 뒤 다시 답하세요.",
            severity: "fix",
          }
    );
  }

  // 6. 링크: 공식 사이트·등록 사이트만 남기고 나머지는 화면에서 뺀다 (고쳐 쓰게 하진 않음)
  const bad = rawLinks(text).filter((u) => {
    try {
      const url = new URL(u);
      const host = url.hostname.replace(/^www\./, "");
      return url.protocol !== "https:" || !(OFFICIAL_HOST.test(host) || hosts.includes(host));
    } catch {
      return true;
    }
  });
  checks.push(
    bad.length
      ? { name: "링크", ok: false, note: `공식 사이트가 아닌 링크 ${bad.length}개는 표시하지 않았습니다.`, severity: "warn" }
      : { name: "링크", ok: true, note: "안내한 링크는 모두 공식·등록 사이트", severity: "warn" }
  );

  return checks;
}
