// Flat config used ONLY by scripts/verify-boundaries.mjs to lint the
// boundary fixtures. It reuses the exact same directional rules as the
// main config but declares NO ignores, so the __fixtures__ files (excluded
// from `pnpm lint`) get linted here for the positive/negative test.
//
// The TS parser is included so `.ts`/`.tsx` fixtures parse correctly.
import tseslintParser from "@typescript-eslint/parser";
import { boundaryRulesConfig } from "./eslint.config.js";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tseslintParser },
  },
  boundaryRulesConfig(),
];