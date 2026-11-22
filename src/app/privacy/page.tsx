import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "개인정보처리방침 | 반려제로" };

// 보호책임자 연락처. 팀 이메일이 정해지면 여기만 바꾼다.
const CONTACT = { name: "반려제로 팀", label: "GitHub 이슈", href: "https://github.com/adamamaa/gonggo-pass/issues" };
const EFFECTIVE = "2026년 11월 22일";

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-8 text-[15px] font-semibold text-slate-900">{children}</h2>
);

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-slate-700">
      <Link href="/" className="text-xs font-medium text-brand-700 hover:underline">
        ← 반려제로로 돌아가기
      </Link>
      <h1 className="mt-4 text-xl font-bold text-slate-900">개인정보처리방침</h1>
      <p className="mt-2">
        반려제로(이하 &quot;서비스&quot;)는 개인정보 보호법에 따라 이용자의 개인정보를 보호하고, 관련 고충을 빠르게 처리하기
        위해 다음과 같이 개인정보처리방침을 둡니다. 서비스는 회원가입이 없고, 이용자가 입력한 정보를 서비스 서버에 저장하지
        않습니다.
      </p>

      <H>1. 처리 목적</H>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>청년 지원사업 자격 확인과 금액 계산</li>
        <li>제출 서류의 누락·불일치 사전 점검, 보완 안내와 서류 초안 작성</li>
        <li>내 조건에 맞는 공고와 대신 받을 수 있는 지원 추천</li>
        <li>인스타그램 정책 게시물 내용과 공식 공고 대조</li>
      </ul>

      <H>2. 처리 항목</H>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>이용자가 입력한 질문과 이전 대화</li>
        <li>이용자가 입력한 내 정보: 지역, 나이, 소득, 가구, 주거, 취업·학업 상태 등 자격 조건</li>
        <li>이용자가 첨부한 서류(이미지·PDF·텍스트)와 그 안에 적힌 정보</li>
        <li>이용자가 입력한 인스타그램 게시물 링크</li>
        <li>접속 기록: 서비스 이용 과정에서 IP 주소, 접속 시각, 브라우저 정보가 호스팅 업체에 자동으로 남을 수 있습니다.</li>
      </ul>
      <p className="mt-2">
        서비스는 주민등록번호를 수집하지 않습니다. 텍스트 서류는 주민등록번호 뒷자리·휴대전화번호·계좌번호를 가린 뒤 전송하지만,
        이미지·PDF는 원본이 그대로 전송되므로 주민등록번호 뒷자리 등을 가린 서류나 화면에서 제공하는 가상 서류를 사용해
        주세요. 주민등록표 등본은 정부24에서 발급할 때 주민등록번호 뒷자리를 표시하지 않도록 선택할 수 있습니다.
      </p>

      <H>3. 보유 기간과 파기</H>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          서비스 서버에는 질문, 내 정보, 첨부 서류를 저장하지 않습니다. 답변을 만드는 동안에만 처리하고, 응답이 끝나면 남기지
          않습니다. 서버 기록에는 호출 횟수·사용량 같은 숫자와 오류 메시지만 남습니다.
        </li>
        <li>
          대화 기록, 내 정보, 설정은 이용자의 브라우저(localStorage)에만 저장되며, 이용자가 직접 지울 때까지 유지됩니다. 화면의
          대화 삭제 기능이나 브라우저의 사이트 데이터 삭제로 언제든 파기할 수 있습니다.
        </li>
        <li>처리를 맡은 업체(아래 4항)는 각 업체의 약관에 따라 정보를 일정 기간 보관할 수 있습니다.</li>
      </ul>

      <H>4. 처리 위탁과 국외 이전</H>
      <p className="mt-2">
        서비스는 답변 생성과 운영을 위해 아래 업체에 처리를 맡기며, 이 중 일부는 국외에서 처리됩니다. 정보는 이용자가 질문하거나
        서류를 올릴 때마다 암호화된 통신(HTTPS)으로 전송됩니다.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-3 font-medium">받는 곳 (국가)</th>
              <th className="py-2 pr-3 font-medium">맡기는 일</th>
              <th className="py-2 pr-3 font-medium">전송 항목</th>
              <th className="py-2 font-medium">보유 기간</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <tr className="border-b border-slate-100">
              <td className="py-2 pr-3">Google LLC (미국 등)</td>
              <td className="py-2 pr-3">Gemini API로 답변 생성, 자격 판단, 서류 판독, 웹 검색</td>
              <td className="py-2 pr-3">질문, 이전 대화, 내 정보, 첨부 서류, 게시물 캡션·대본</td>
              <td className="py-2">Google Gemini API 약관에 따름 (오남용 방지 목적의 일정 기간)</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2 pr-3">Vercel Inc. (미국 등)</td>
              <td className="py-2 pr-3">웹사이트 호스팅과 서버 실행</td>
              <td className="py-2 pr-3">위 요청 전체(저장하지 않고 전달), 접속 기록</td>
              <td className="py-2">Vercel 약관에 따름</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2 pr-3">Treg · ScrapeCreators (미국 등)</td>
              <td className="py-2 pr-3">공개 인스타그램 게시물의 캡션·대본 가져오기</td>
              <td className="py-2 pr-3">이용자가 입력한 게시물 링크만</td>
              <td className="py-2">같은 링크 재조회용 1일 저장, 그 밖에는 각 업체 약관에 따름</td>
            </tr>
            <tr>
              <td className="py-2 pr-3">공공데이터포털 · 온통청년 (대한민국)</td>
              <td className="py-2 pr-3">지원사업 공고 조회</td>
              <td className="py-2 pr-3">정책 이름, 검색어, 지역 등 조회 조건</td>
              <td className="py-2">각 기관 정책에 따름</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3">
        국외 이전을 원하지 않으면 서비스를 이용하지 않거나, 실제 정보 대신 예시 값과 가상 서류로 체험할 수 있습니다. 이 경우
        내 정보에 맞춘 판정은 받을 수 없습니다. 서비스는 이용자의 개인정보를 위 목적 밖으로 제3자에게 제공하지 않습니다.
      </p>

      <H>5. 이용자의 권리와 행사 방법</H>
      <p className="mt-2">
        이용자는 언제든 자신의 개인정보를 열람·정정·삭제하거나 처리 정지를 요구할 수 있습니다. 서비스 서버에는 저장된 정보가
        없으므로, 브라우저에 저장된 정보는 화면에서 직접 고치거나 지울 수 있습니다. 그 밖의 문의는 아래 보호책임자에게 해
        주세요.
      </p>

      <H>6. 안전성 확보 조치</H>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>모든 통신은 HTTPS로 암호화합니다.</li>
        <li>질문·내 정보·서류를 서버에 저장하지 않습니다.</li>
        <li>텍스트로 보내는 내용은 주민등록번호 뒷자리·휴대전화번호·계좌번호를 가린 뒤 AI로 전송합니다.</li>
        <li>화면에서 민감한 값을 가려 보이게 하는 설정을 제공합니다.</li>
      </ul>

      <H>7. 자동 수집 장치</H>
      <p className="mt-2">
        서비스는 쿠키와 방문 분석 도구를 쓰지 않습니다. 대화 기록과 설정을 이용자의 브라우저에 보관하기 위해 브라우저 저장소
        (localStorage)만 사용합니다.
      </p>

      <H>8. 만 14세 미만 아동</H>
      <p className="mt-2">서비스는 청년 지원사업 안내를 위한 것으로, 만 14세 미만 아동을 대상으로 하지 않습니다.</p>

      <H>9. AI 결과의 한계</H>
      <p className="mt-2">
        서비스의 결과는 신청 전 사전 점검입니다. AI가 틀릴 수 있으며, 최종 자격과 서류 적합 여부는 접수 기관이 판정합니다.
      </p>

      <H>10. 개인정보 보호책임자</H>
      <p className="mt-2">
        {CONTACT.name} · 문의:{" "}
        <a href={CONTACT.href} className="text-brand-700 underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
          {CONTACT.label}
        </a>
      </p>

      <H>11. 권익침해 구제 방법</H>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>개인정보분쟁조정위원회: 1833-6972 (www.kopico.go.kr)</li>
        <li>개인정보침해신고센터: 118 (privacy.kisa.or.kr)</li>
        <li>대검찰청: 1301 (www.spo.go.kr)</li>
        <li>경찰청: 182 (ecrm.police.go.kr)</li>
      </ul>

      <H>12. 시행일과 변경</H>
      <p className="mt-2">
        이 방침은 {EFFECTIVE}부터 적용합니다. 내용이 바뀌면 이 페이지에 바뀐 내용과 시행일을 알립니다.
      </p>
    </main>
  );
}
