import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/page.tsx"],
    rules: {
      // POLY FIGHTER deliberately uses labels such as "CPU // SERA" and
      // "PRESSURE // SCORE" as part of its HUD language. They are text, not
      // JSX comments, so keep the lint rule enabled elsewhere and exempt only
      // the game shell that owns those labels.
      "react/jsx-no-comment-textnodes": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
