import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        present: "#16a34a",
        late: "#d97706",
        absent: "#dc2626",
      },
    },
  },
  plugins: [],
};

export default config;
