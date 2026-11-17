import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Pretendard Variable", "Pretendard", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Noto Sans KR", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        brand: {
          50: "#faf5ff",
          100: "#f3e8ff",
          200: "#e9d5ff",
          300: "#d8b4fe",
          400: "#c084fc",
          500: "#a855f7",
          600: "#9333ea",
          700: "#7e22ce",
        },
        surface: {
          sidebar: "#fbfbfb",
          main: "#ffffff",
        },
      },
      boxShadow: {
        app: "0 25px 60px -15px rgba(99, 70, 130, 0.15), 0 0 1px 1px rgba(0, 0, 0, 0.03)",
        input: "0 4px 20px -2px rgba(140, 120, 180, 0.06)",
        orb: "0 0 60px 20px rgba(192, 132, 252, 0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
