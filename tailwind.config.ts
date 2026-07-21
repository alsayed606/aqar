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
        // Arabic-first stack; a proper webfont (Cairo/Tajawal) is added in a later polish step.
        sans: ['"Segoe UI"', "Tahoma", "Arial", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          DEFAULT: "#0f766e", // teal-700
          fg: "#0b5c56",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
