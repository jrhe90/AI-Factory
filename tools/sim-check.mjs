// Headless checks for the Megafactory simulation: determinism, forking and calibration.
// Run: node tools/sim-check.mjs [days]
import { createSim, step, kpis, utilisation, fork, status } from '../src/megafactory/sim.js';
import { NODES, N } from '../src/megafactory/plant.js';

const DAYS = Number(process.argv[2] || 14);
const WARM = 3 * 1440;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// 1. determinism: the same seed gives the same plant
{
  const a = createSim({ seed: 7, warmup: WARM }), b = createSim({ seed: 7, warmup: WARM });
  step(a, WARM + 2 * 1440); step(b, WARM + 2 * 1440);
  check(JSON.stringify(a) === JSON.stringify(b), 'same seed → identical state after 2 days');
}

// 2. forking: a fork runs exactly like its parent
{
  const a = createSim({ seed: 11, warmup: WARM });
  step(a, WARM + 600);
  const b = fork(a);
  step(a, WARM + 3000); step(b, WARM + 3000);
  check(JSON.stringify(a) === JSON.stringify(b), 'fork → same future as the parent');
}

// 3. calibration over several seeds
const takts = [], perDay = [];
const util = {};
for (const seed of [1, 2, 3, 4, 5]) {
  const s = createSim({ seed, warmup: WARM });
  const t0 = performance.now();
  step(s, WARM + DAYS * 1440);
  const ms = performance.now() - t0;
  const k = kpis(s);
  const takt = (DAYS * 1440) / k.built;
  takts.push(takt); perDay.push(k.built / DAYS);
  NODES.forEach((d, n) => {
    if (d.kind !== 'station' && d.kind !== 'conveyor') return;
    const u = utilisation(s, n);
    (util[d.key] ??= []).push(u);
  });
  console.log(`seed ${seed}: built ${k.built} · shipped ${k.shipped} · takt ${takt.toFixed(1)} min · lot ${k.lot} · rack ${k.rack} · ` +
    `paint WIP ${k.paintWip} · paint FPY ${(k.paintFpy * 100).toFixed(1)}% · EOL FPY ${(k.eolFpy * 100).toFixed(1)}% · ` +
    `recoats ${k.recoats} · ${DAYS} d in ${ms.toFixed(0)} ms`);
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const takt = mean(takts);
console.log(`\nmean takt ${takt.toFixed(1)} min/pack · ${mean(perDay).toFixed(1)} packs/day · ${(525600 / takt * 3.9 / 1000).toFixed(1)} GWh/yr\n`);

console.log('station            busy  block starv  down');
for (const [key, us] of Object.entries(util)) {
  const m = (f) => (mean(us.map(f)) * 100).toFixed(0).padStart(5);
  console.log(`${key.padEnd(17)}${m(u => u.busy)}${m(u => u.blocked)}${m(u => u.starved)}${m(u => u.down)}`);
}
const busiest = Object.entries(util).filter(([k]) => NODES[N[k]].line === 'pack')
  .map(([k, us]) => [k, mean(us.map(u => u.busy + u.down))]).sort((a, b) => b[1] - a[1])[0];

check(takt > 64 && takt < 72, `takt ${takt.toFixed(1)} min is within 64–72 (target ~68)`);
check(busiest[0] === 'EOL', `pack line constraint is ${busiest[0]} (expect EOL)`);
process.exit(failed ? 1 : 0);
