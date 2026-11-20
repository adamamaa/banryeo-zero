# 반려제로

<img src="public/brand/banryeozero-logo.png" alt="반려제로" width="320">

청년 지원사업을 찾고, 공고 조건과 내 정보를 대조하고, 제출 서류를 미리 점검하는 AI 에이전트.

2026 대한민국 청년 CAREER FAIR AI 해커톤 출품작 (1인 개발 MVP).

## 실행

```bash
npm install
npm run dev
```

http://localhost:3000 (Windows는 `실행하기.bat` 더블클릭)

`.env.local`에 다음 키를 넣는다.

- `GEMINI_API_KEY`: 질문 답변, 자격 확인, 서류 판독
- `PUBLIC_DATA_API_KEY`: 보조금24, 복지로
- `YOUTHCENTER_API_KEY`: 온통청년

## 무엇이 동작하나

- **추천 공고**: 온통청년·복지로·보조금24에서 지역, 상황, 관심 분야와 관련 있는 공고만 보여 준다.
- **자격 확인**: 공고에서 확인한 조건과 내 정보를 서버가 대조한다. 기준 숫자를 코드에 고정하지 않는다.
- **금액 대조**: 답변의 정책 금액을 가장 최근 수정된 공식 원문과 비교한다.
- **서류 검수**: 고른 공고 기준으로 첨부 서류를 AI가 판독한다. 공고를 고르지 않으면 서류 자체의 문제만 점검한다.
- **파일 만들기**: 엑셀, CSV, 워드, 텍스트, 캘린더 파일을 만든다.

`public/sample-docs`에는 업로드 테스트용 가상 서류가 들어 있다.

## 구조

- `src/app/page.tsx` 화면
- `src/app/api/agent/run` 공고 조회, 서류 검수, 에이전트 답변
- `src/lib/agent.ts` 에이전트 도구 실행
- `src/lib/relevance.ts` 추천 공고 관련성 판단
- `src/lib/eligibility.ts` 공고 조건과 내 정보 대조
- `src/lib/officialFacts.ts` 공식 원문 금액 대조
- `src/lib/standards.ts` 2026년 기준 중위소득

## 한계

- 사전 점검 결과일 뿐 최종 판정은 접수 기관이 한다.
- 이미지·PDF 서류는 판독을 위해 원본이 Gemini로 전송된다. 텍스트 서류만 마스킹 후 전송된다. 이미지·PDF도 전송 전에 가리도록 개선할 예정이다.
- 질문할 때 내 정보(지역·나이·소득 등 조건)가 Gemini로 전송된다. 이름·연락처는 받지 않고, 내 정보는 브라우저에만 저장한다.

## 제출 문서

해커톤 제출 문서 초안은 [`docs/`](docs/README.md)에 있다.

## Credits / Licenses

| 구분 | 이름 | 라이선스 |
| :--- | :--- | :--- |
| 오픈소스 | Next.js, React, React DOM, Tailwind CSS, PostCSS, Autoprefixer | MIT |
| 오픈소스 | TypeScript | Apache-2.0 |
| 오픈소스 | lucide-react | ISC |
| 폰트 | Pretendard (길형진), Inter (Rasmus Andersson) | SIL OFL 1.1 |
| 데이터 | 온통청년 청년정책 API, 공공데이터포털 대한민국 공공서비스(혜택) 정보, 지자체복지서비스 | 각 제공기관 이용 조건 |
| AI | Google Gemini API (서비스), Claude·Claude Code·Google Antigravity·Google Stitch·Google Nano Banana·Google Neon (개발) | 각 서비스 약관 |
| 로고 | 반려제로 로고·심볼: AI 생성 (Google Nano Banana, SVG 변환 Google Neon) | – |
| 시연 자료 | `public/sample-docs`의 가상 서류·가상 공고문 | 팀 제작, 실제 인물 아님 |

자세한 링크와 기준일은 [docs/04_별첨_활용한_외부자원_출처.md](docs/04_별첨_활용한_외부자원_출처.md)에 있다.
