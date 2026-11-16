import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Pretendard Variable", "Pretendard", "-apple-system", "system-ui", "Noto Sans KR", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        brand: { 50: "#EEF3FE", 100: "#DCE6FD", 600: "#2558D9", 700: "#1D47B3" },
      },
    },
  },
  plugins: [],
};
export default config;
