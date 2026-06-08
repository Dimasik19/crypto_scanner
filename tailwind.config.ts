import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        panel2: "rgb(var(--color-panel2) / <alpha-value>)",
        grid: "rgb(var(--color-grid) / <alpha-value>)",
        cyan: "#35d5df",
        lime: "#9df16b",
        amber: "#f0b94d",
        danger: "#ff6b6b"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Consolas", "monospace"]
      },
      boxShadow: {
        terminal: "var(--shadow-terminal)"
      }
    }
  },
  plugins: []
};

export default config;
