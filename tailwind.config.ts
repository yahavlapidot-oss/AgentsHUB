import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        ink: { DEFAULT: "#1f2433", soft: "#5b6275", faint: "#8a90a2" },
        canvas: "#f4f5f8",
        line: "#e3e6ee",
        nav: "#14182b",
        brand: { DEFAULT: "#4b5cf0", soft: "#eceefe" },
        st: {
          backlog: "#c4c4c4",
          ready: "#579bfc",
          progress: "#fdab3d",
          waiting: "#e2445c",
          review: "#a25ddc",
          done: "#00c875",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
