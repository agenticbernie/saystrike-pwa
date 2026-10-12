# SayStrike Stitch handoff

The existing MCP Stitch project was retrieved and used as the frontend reference before implementation.

- Project: **SayStrike Mobile Game UI/UX** (`17186360191149533744`), private mobile project, updated 2026-10-12.
- Visual system: **Cyber Synth Arcade**, Space Grotesk and Plus Jakarta Sans, midnight purple surfaces, cyan and magenta accents, mint success states, restrained glow, a 440 px mobile canvas, and thumb-zone bottom navigation.
- Retrieved screens: Arena Hub (`3572473664ca4b9aa291c8a181efd7e7`), Vocal Practice (`5880a9e0459d490a909f352aeb8504af`), Instant Review (`3b100cf139d74faa99003a7c8469ee0a`), Boss Battle (`97809d5c645840f1860d1a2fafbbf710`), weak/strong hit, Guard Break, Critical Failure, Victory (`05e970b38d964d9eb5f37fe8fa1a55c7`), Defeat (`1228d9e1dfa64bc28951853f92039f47`), Progress Review (`7e70d911ed484d938678624c1f9624eb`), Sound Lab (`28c123f88547459aad09faf99a04e2ad`), and Engineering Handoff (`b1b64ecb2ebc4ea3a6a5551da686b816`). Screen renderings and specifications were inspected via Stitch MCP during implementation.
- The supplied Stitch mark and Synth Titan artwork were downloaded as `apps/web/public/images/saystrike-mark.png` and `apps/web/public/images/synth-titan.jpg`. PWA icon sizes are derived from the retrieved mark with safe padding.

Implementation follows the Stitch hierarchy: compact fixed header, centered mobile shell, segmented progress strip, focused battle/practice calls to action, boss HUD, sentence target, capture/feedback panel, and persistent five-item bottom navigation. Design tokens live in `apps/web/src/styles.css`; local font packages avoid runtime font requests.

The Stitch handoff also contains illustrative scores, a phoneme-oriented concept, combo effects, and some per-tier damage examples. Those examples conflict with or go beyond `docs/product-brief.md`; the brief remains canonical. This implementation uses the brief's base damage formula, does not claim phoneme-level accuracy, and does not invent combo damage. Missing states such as permission denial, processing errors, insufficient evidence, offline operation, and missing soundtrack are extended within the same visual system.
