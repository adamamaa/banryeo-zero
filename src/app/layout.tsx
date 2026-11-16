import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "공고패스 (GongGoPass) | 청년 지원금 사전 모의심사 & 서류 완주 에이전트",
  description:
    "2026 대한민국 청년 CAREER FAIR AI 해커톤 - 30페이지 공고문 별표 해독부터 제출 전 AI 공무원 서류 반려 0% 사전 검수까지",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
