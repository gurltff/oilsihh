import colors from "tailwindcss/colors";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // warm neutrals everywhere the app used cool slate
        slate: colors.stone,
        // "oil" = ink: dark pill buttons, links, selection
        oil: { 900: "#1f1c19", 700: "#3a3530", 500: "#2f2b28", accent: "#d9b867" },
        cream: { 50: "#fbf8f3", 100: "#f4efe7", 200: "#ebe3d6" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        serif: ['"Libre Caslon Text"', "Georgia", "serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(60,45,30,.04), 0 8px 24px -8px rgba(60,45,30,.12)",
        lift: "0 2px 4px rgba(60,45,30,.05), 0 18px 40px -12px rgba(60,45,30,.22)",
      },
    },
  },
  plugins: [],
};
