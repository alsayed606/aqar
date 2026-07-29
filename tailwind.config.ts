import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Tajawal (self-hosted via next/font) with a system fallback stack.
        sans: ["var(--font-tajawal)", '"Segoe UI"', "Tahoma", "Arial", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          DEFAULT: "#0f766e", // teal-700
          fg: "#0b5c56",
        },
      },
      keyframes: {
        "fade-in": { "0%": { opacity: "0", transform: "translateY(4px)" }, "100%": { opacity: "1", transform: "none" } },
        "fade-in-plain": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "slide-in-right": { "0%": { transform: "translateX(100%)" }, "100%": { transform: "translateX(0)" } },
        "slide-in-up": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in .15s ease-out",
        "fade-in-plain": "fade-in-plain .15s ease-out",
        "slide-in-right": "slide-in-right .2s ease-out",
        "slide-in-up": "slide-in-up .2s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
