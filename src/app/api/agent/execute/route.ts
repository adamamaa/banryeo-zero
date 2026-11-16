import { NextRequest, NextResponse } from "next/server";
import { runToolChain } from "@/lib/tools";
import { POLICY_SCENARIOS } from "@/data/policies";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : d);
    const result = await runToolChain({
      age: num(b.age, 26),
      region: String(b.region || "서울특별시 관악구 봉천로 123, 301호"),
      monthlyIncomeManwon: num(b.monthlyIncomeManwon, 130),
      depositManwon: num(b.depositManwon, 1000),
      monthlyRentManwon: num(b.monthlyRentManwon, 75),
      separateLivingMonths: num(b.separateLivingMonths, 15),
      auditMode: b.auditMode === "fixed" ? "fixed" : "defect",
      essayText: String(
        b.essayText ?? POLICY_SCENARIOS[0].applicationFormTemplate.generatedEssayDraft
      ),
      publicDataApiKey: b.publicDataApiKey || process.env.PUBLIC_DATA_API_KEY || "",
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "도구 실행 오류", detail: String(error) }, { status: 500 });
  }
}
