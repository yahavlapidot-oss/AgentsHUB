import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      // Short and eased out: things arrive quickly and settle softly.
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "sheet-up": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "drawer-in": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "pop-in": { from: { opacity: "0", transform: "translateY(8px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        "toast-in": { from: { opacity: "0", transform: "translateY(12px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "sheet-up": "sheet-up 220ms cubic-bezier(0.32, 0.72, 0, 1)",
        "drawer-in": "drawer-in 220ms cubic-bezier(0.32, 0.72, 0, 1)",
        "pop-in": "pop-in 160ms ease-out",
        "toast-in": "toast-in 180ms ease-out",
        // Waits a moment so a page that loads quickly never flashes a skeleton.
        "fade-in-late": "fade-in 200ms ease-out 150ms both",
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
