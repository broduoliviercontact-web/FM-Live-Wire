// UI runtime defaults (scaffolding — values confirmed 2026-07-06, AD-11).
// Consumed by the listener scheduler in Epic 5; here only the constants exist.
export const LOOKAHEAD_MS = 40;
export const MAX_LATE_MS = 200;
export const BUFFER_CAP = 256;
// Hotfix fidélité musicale — deferred playback buffer (ms). The listener anchors
// the first received event's performer `ts` to `performance.now() + delay`, then
// plays each event at `anchorLocalMs + (event.ts - anchorPerformerTs)` so the
// RELATIVE musical timing of the performer is preserved despite network jitter.
// The delay is the size of the jitter-absorption buffer: ~1.5 s trades a small
// constant restitution latency for stable inter-event spacing. Always-on for the
// MVP (a constant suffices); later configurable 500/1000/1500/2000 if needed.
export const PLAYBACK_DELAY_MS = 1500;
// CC rate-limiter / coalescer — plafond musical / synth-friendly pour le mode
// Smooth. 60 Hz est un choix de sécurité pour éviter de saturer les synthés /
// plugins par un déluge de CC (ex. CC74 filter cutoff à ~194 CC/s, pics 416) ;
// ce n'est PAS le plafond du câble MIDI DIN. Le coalescer garde la dernière
// valeur par (channel, ccNumber) et forward au maximum à ce taux.
export const CC_RATE_HZ_NORMAL = 60;
// CC rate-limiter — plafond du mode Safe. 30 Hz pour liens instables / synths
// lents ; le coalescer garde la dernière valeur.
export const CC_RATE_HZ_SAFE = 30;