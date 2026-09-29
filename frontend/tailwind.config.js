/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: { oil: { 900: "#0c1e3c", 700: "#16345f", 500: "#1f5aa6", accent: "#f2a900" } },
    },
  },
  plugins: [],
};
