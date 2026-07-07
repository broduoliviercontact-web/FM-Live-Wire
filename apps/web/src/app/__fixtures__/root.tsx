// TSX fixture (positive): app -> performer is ALLOWED. Proves .tsx parsing
// (JSX syntax) + boundary rule on a TypeScript file.
import { feat } from "../../features/performer/__fixtures__/feat";

export function Root(): null {
  // Trivial JSX use to exercise the TSX parser; returns null to avoid React types.
  void (
    <div>
      <span>{feat.pitch}</span>
    </div>
  );
  return null;
}