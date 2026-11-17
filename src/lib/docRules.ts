import type { AuditFinding, MockDocumentPreview } from "@/data/policies";
import { maskPii } from "./gemini";

// 텍스트 서류용 규칙 검수 엔진. API 키 없이 동작하며, 파일명이 아니라 내용을 읽는다.
// ponytail: "키: 값" 줄 단위 파싱만 지원. 스캔 이미지·PDF는 Gemini 경로(run/route.ts)가 처리.

export interface AuditResult {
  summaryTitle: string;
  passProbability: number;
  documents: MockDocumentPreview[];
  findings: AuditFinding[];
  crossCheckMatrix: {
    checkName: string;
    sourceA: string;
    sourceB: string;
    status: "pass" | "fail";
    note: string;
  }[];
  autoFilledFields: { label: string; value: string; sourceDoc: string }[];
}

type DocKind = "rr" | "lease" | "family" | "unknown";
type Field = MockDocumentPreview["fields"][number];

const KIND_TITLE: Record<DocKind, string> = {
  rr: "주민등록등본",
  lease: "임대차계약서",
  family: "가족관계증명서",
  unknown: "미식별 서류",
};

const DATE_RE = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/;

function detectKind(text: string): DocKind {
  if (/주민등록표|주민등록등본/.test(text)) return "rr";
  if (/임대차/.test(text)) return "lease";
  if (/가족관계/.test(text)) return "family";
  return "unknown";
}

function parseFields(text: string): Field[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([^:：\[\]]{2,30})[:：]\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ label: m[1].trim(), value: maskPii(m[2].trim()).masked, status: "ok" as const }));
}

const find = (fields: Field[], re: RegExp) => fields.find((f) => re.test(f.label));
const unit = (v?: string) => v?.match(/(\d+)\s*호/)?.[1];
const personName = (v?: string) => v?.match(/[가-힣]{2,4}/)?.[0];

function flag(field: Field | undefined, tag: string, status: "error" | "warning" = "error") {
  if (field) {
    field.status = status;
    field.errorTag = tag;
  }
}

export function auditTextDocs(
  docs: { fileName: string; text: string }[],
  today = new Date()
): AuditResult {
  const findings: AuditFinding[] = [];
  const matrix: AuditResult["crossCheckMatrix"] = [];
  const add = (f: Omit<AuditFinding, "id">) => findings.push({ id: `f-${findings.length + 1}`, ...f });

  const parsed = docs.map((d, i) => {
    const kind = detectKind(d.text);
    return { ...d, kind, docId: `doc-${i + 1}`, fields: parseFields(d.text) };
  });

  for (const d of parsed) {
    const base = { docId: d.docId, docTitle: KIND_TITLE[d.kind] };

    if (d.kind === "unknown") {
      add({
        ...base,
        type: "single_rule",
        severity: "warning",
        title: "서류 종류를 식별하지 못했습니다",
        detail: `${d.fileName}에서 주민등록등본·임대차계약서·가족관계증명서 표제를 찾지 못했습니다.`,
        ruleReference: "공고문 22p [별표4] 제출서류 목록",
        fixAction: "제출 대상 서류가 맞는지 확인하세요.",
      });
    }

    if (d.kind === "rr") {
      const moveIn = find(d.fields, /전입일/);
      if (!moveIn || !DATE_RE.test(moveIn.value)) {
        flag(moveIn, "전입일 미표시");
        add({
          ...base,
          type: "single_rule",
          severity: "critical",
          title: "등본에 전입일이 표시되지 않았습니다",
          detail: "별도 거주 기간을 확인할 수 없어 독립가구 특례 심사가 불가능합니다.",
          ruleReference: "공고문 22p [별표4] 제1호",
          fixAction: "정부24 재발급 시 [전입일/변동일: 포함]을 선택하세요.",
        });
      } else {
        const [, y, m, day] = moveIn.value.match(DATE_RE)!;
        const months =
          (today.getFullYear() - Number(y)) * 12 +
          (today.getMonth() + 1 - Number(m)) -
          (today.getDate() < Number(day) ? 1 : 0);
        if (months < 12) {
          flag(moveIn, `별도 거주 ${months}개월`, "warning");
          add({
            ...base,
            type: "single_rule",
            severity: "warning",
            title: `별도 거주 기간이 ${months}개월로 1년 미만입니다`,
            detail: "독립가구 단독산정 특례는 1년 이상 별도 거주가 요건입니다. 원가구 소득 합산 심사 대상이 됩니다.",
            ruleReference: "공고문 18p [별표2] 제3호",
            fixAction: "원가구(부모) 소득 증빙 서류를 추가로 준비하세요.",
          });
        }
      }

      const history = find(d.fields, /주소변동/);
      if (!history || /미포함|미표시|비공개/.test(history.value) || !/포함/.test(history.value)) {
        flag(history, "주소변동 이력 누락");
        add({
          ...base,
          type: "single_rule",
          severity: "critical",
          title: "최근 5년 주소변동 이력이 빠져 있습니다",
          detail: "등본에 과거 주소변동 사항이 포함되지 않았습니다.",
          ruleReference: "공고문 22p [별표4] 제1호",
          fixAction: "정부24 재발급 시 [과거의 주소변동 사항: 최근 5년 포함]을 선택하세요.",
        });
      }
    }

    if (d.kind === "lease") {
      const fixedDate = find(d.fields, /확정일자/);
      if (!fixedDate || !/\d/.test(fixedDate.value) || /없음|누락|미날인|미식별/.test(fixedDate.value)) {
        flag(fixedDate, "확정일자 없음");
        add({
          ...base,
          type: "seal_verify",
          severity: "critical",
          title: "계약서에 확정일자가 없습니다",
          detail: "확정일자 번호나 날인 기재를 찾지 못했습니다.",
          ruleReference: "공고문 22p [별표4] 제2호",
          fixAction: "부동산거래관리시스템(rtms.molit.go.kr)에서 주택임대차계약 신고필증을 발급해 함께 제출하세요.",
        });
      }
    }

    if (d.kind === "family") {
      const type = find(d.fields, /증명서\s*(구분|종류)/);
      const isDetailed = type ? /상세/.test(type.value) : /상세/.test(d.text);
      if (!isDetailed) {
        flag(type, "일반증명서");
        add({
          ...base,
          type: "single_rule",
          severity: "critical",
          title: "'상세'가 아닌 '일반' 증명서입니다",
          detail: "공고문은 신청인 기준 상세증명서만 인정합니다.",
          ruleReference: "공고문 22p [별표4] 제3호",
          fixAction: "대법원 전자가족관계등록시스템에서 [상세증명서]를 선택해 재발급하세요.",
        });
      }
    }
  }

  // 서류 간 교차 검증: 등본 ↔ 계약서
  const rr = parsed.find((d) => d.kind === "rr");
  const lease = parsed.find((d) => d.kind === "lease");
  if (rr && lease) {
    const rrAddr = find(rr.fields, /주소/);
    const leaseAddr = find(lease.fields, /소재지|주소/);
    const [a, b] = [unit(rrAddr?.value), unit(leaseAddr?.value)];
    const unitOk = Boolean(a && b && a === b);
    matrix.push({
      checkName: "등본 현주소 ↔ 계약서 소재지 호수",
      sourceA: a ? `등본 ${a}호` : "등본: 호수 미확인",
      sourceB: b ? `계약서 ${b}호` : "계약서: 호수 미확인",
      status: unitOk ? "pass" : "fail",
      note: unitOk ? "호수 일치" : "호수 불일치 또는 확인 불가",
    });
    if (!unitOk) {
      flag(leaseAddr, "등본과 호수 불일치");
      flag(rrAddr, "계약서와 호수 불일치", "warning");
      add({
        docId: lease.docId,
        docTitle: "등본 ↔ 임대차계약서",
        type: "cross_check",
        severity: "critical",
        title: `등본(${a ?? "?"}호)과 계약서(${b ?? "?"}호)의 호수가 다릅니다`,
        detail: "문패 호수와 건축물대장 호수가 다른 경우 자주 발생합니다.",
        ruleReference: "공고문 22p [별표4] 제2호",
        fixAction: "임대인이 서명한 거주 동·호수 확인서를 첨부하거나 계약서를 정정하세요.",
      });
    }

    const [n1, n2] = [personName(find(rr.fields, /성명/)?.value), personName(find(lease.fields, /임차인/)?.value)];
    const nameOk = Boolean(n1 && n2 && n1 === n2);
    matrix.push({
      checkName: "신청인 ↔ 임차인 성명",
      sourceA: `등본: ${n1 ?? "미확인"}`,
      sourceB: `계약서: ${n2 ?? "미확인"}`,
      status: nameOk ? "pass" : "fail",
      note: nameOk ? "명의 일치" : "명의 불일치 또는 확인 불가",
    });
    if (!nameOk) {
      add({
        docId: lease.docId,
        docTitle: "등본 ↔ 임대차계약서",
        type: "cross_check",
        severity: "critical",
        title: "등본 세대주와 계약서 임차인 성명이 일치하지 않습니다",
        detail: "임차인은 신청자 본인이어야 합니다.",
        ruleReference: "공고문 3p 제2조",
        fixAction: "본인 명의 계약서인지 확인하세요.",
      });
    }
  }

  const name = personName(rr && find(rr.fields, /성명/)?.value) || "신청인";
  const documents: MockDocumentPreview[] = parsed.map((d, i) => {
    const bad = findings.some((f) => f.docId === d.docId && f.severity === "critical");
    return {
      docId: d.docId,
      docTitle: KIND_TITLE[d.kind],
      fileName: d.fileName,
      renamedFileName: `2026청년월세_${name}_${String(i + 1).padStart(2, "0")}_${KIND_TITLE[d.kind]}.pdf`,
      issuedDate: find(d.fields, /발급일/)?.value || "",
      headerTitle: d.text.match(/\[([^\]]+)\]/)?.[1] || KIND_TITLE[d.kind],
      fields: d.fields,
      stampText: bad ? "보완 필요" : "규칙 통과",
      stampStatus: bad ? "missing" : "valid",
    };
  });

  const risks = findings.length;
  if (risks === 0) {
    add({
      docId: parsed[0]?.docId || "doc-1",
      docTitle: "전체 서류",
      type: "cross_check",
      severity: "pass",
      title: "점검한 규칙에서 반려 위험을 찾지 못했습니다",
      detail: `서류 ${parsed.length}건에 대해 발급 옵션과 교차 항목을 확인했습니다.`,
      ruleReference: "공고문 22p [별표4]",
      fixAction: "제출 탭 아래 신청 패키지에서 자동 기입된 신청서를 확인하세요.",
    });
  }

  const autoFilledFields = [
    rr && find(rr.fields, /성명/) && { label: "신청인 성명", f: find(rr.fields, /성명/)!, src: "주민등록등본" },
    rr && find(rr.fields, /주소지/) && { label: "현 거주지", f: find(rr.fields, /주소지/)!, src: "주민등록등본" },
    rr && find(rr.fields, /전입일/) && { label: "전입일", f: find(rr.fields, /전입일/)!, src: "주민등록등본" },
    lease && find(lease.fields, /보증금/) && { label: "임대차 조건", f: find(lease.fields, /보증금/)!, src: "임대차계약서" },
    lease && find(lease.fields, /확정일자/) && { label: "확정일자", f: find(lease.fields, /확정일자/)!, src: "임대차계약서" },
  ]
    .filter((x): x is { label: string; f: Field; src: string } => Boolean(x) && x !== undefined)
    .filter((x) => x.f.status === "ok")
    .map((x) => ({ label: x.label, value: x.f.value, sourceDoc: x.src }));

  return {
    summaryTitle: risks ? `반려 위험 ${risks}건 감지 — 제출 전 보완 필요` : "점검한 규칙에서 반려 위험 없음",
    passProbability: 0,
    documents,
    findings,
    crossCheckMatrix: matrix,
    autoFilledFields,
  };
}
