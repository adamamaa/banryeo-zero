// AI 서류 검수 결과의 형식
export interface AuditFinding {
  id: string;
  docId: string;
  docTitle: string;
  type: "single_rule" | "cross_check" | "seal_verify";
  severity: "critical" | "warning" | "pass";
  title: string;
  detail: string;
  ruleReference: string;
  fixAction: string;
  highlightBox?: {
    top: string;
    left: string;
    width: string;
    height: string;
    badgeText: string;
  };
}

export interface MockDocumentPreview {
  docId: string;
  docTitle: string;
  fileName: string;
  renamedFileName: string;
  issuedDate: string;
  headerTitle: string;
  fields: {
    label: string;
    value: string;
    status: "ok" | "error" | "warning";
    errorTag?: string;
  }[];
  stampText?: string;
  stampStatus?: "valid" | "missing";
}

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
