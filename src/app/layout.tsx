import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "공고패스 | 청년 지원금 제출 전 사전 점검",
  description: "공고문 조건으로 자격을 계산하고, 준비한 서류를 접수 기준에 맞춰 제출 전에 검수합니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
        />
        <link
          rel="stylesheet"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
