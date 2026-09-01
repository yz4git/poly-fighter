from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing target: {label}")
    p.write_text(text.replace(old, new, 1))


r = "src/game/motion-expansion-runtime.ts"
rep(r, '''function impactPairAccent(runtime: ExpansionRuntime, fighter: FighterRuntime, opponent: FighterRuntime): "ATTACKER" | "VICTIM" | null {
  const attacker = fighter.state === "ATTACK" && Boolean(fighter.currentMove) && opponent.state === "HIT" && (fighter.hitStop > 0 || opponent.hitStop > 0);
  const victim = fighter.state === "HIT" && opponent.state === "ATTACK" && Boolean(opponent.currentMove) && (fighter.hitStop > 0 || opponent.hitStop > 0);
  if (!attacker && !victim) return null;''', '''const IMPACT_PAIR_REACTION_STATES = new Set<FighterRuntime["state"]>(["HIT", "KNOCKDOWN", "THROW", "KO", "RING_OUT"]);

function impactPairAccent(runtime: ExpansionRuntime, fighter: FighterRuntime, opponent: FighterRuntime): "ATTACKER" | "VICTIM" | null {
  const frozenImpact = fighter.hitStop > 0 || opponent.hitStop > 0;
  const attacker = fighter.state === "ATTACK" && Boolean(fighter.currentMove) && IMPACT_PAIR_REACTION_STATES.has(opponent.state) && frozenImpact;
  const victim = IMPACT_PAIR_REACTION_STATES.has(fighter.state) && opponent.state === "ATTACK" && Boolean(opponent.currentMove) && frozenImpact;
  if (!attacker && !victim) return null;''', "impact pair states")

a = "scripts/capture-motion-readability-audit.mjs"
rep(a, "if (game.p2.state === 'HIT' && (game.p1.hitStop > 0 || game.p2.hitStop > 0)) {", "if (['HIT', 'KNOCKDOWN', 'THROW', 'KO', 'RING_OUT'].includes(game.p2.state) && (game.p1.hitStop > 0 || game.p2.hitStop > 0)) {", "impact pair audit state")
rep(a, '''      attackerDna: game.p1.visual.root.userData.motionExpansionMotionDna ?? null,
      victimHealth: game.p2.health,''', '''      attackerDna: game.p1.visual.root.userData.motionExpansionMotionDna ?? null,
      victimHealth: game.p2.health,
      victimState: game.p2.state,''', "impact diagnostics state")

t = "tests/motion-expansion.test.ts"
rep(t, '  assert.match(source, /impactPairAccent/);', '  assert.match(source, /impactPairAccent/);\n  assert.match(source, /IMPACT_PAIR_REACTION_STATES/);\n  assert.match(source, /"KNOCKDOWN", "THROW", "KO", "RING_OUT"/);', "impact pair state test")

print("V3 impact-pair strong-hit states fixed")
