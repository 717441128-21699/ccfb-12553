import { buildSampleProject } from '../src/sample/sampleProject';
import { solveProject } from '../src/core/engine';
import { checkClearances } from '../src/core/clearance';

const project = buildSampleProject();
const t0 = performance.now();
const result = solveProject(project, { tessTolerance: 0.005 });
const violations = checkClearances(project, result);
const elapsed = performance.now() - t0;

console.log(`总耗时 ${elapsed.toFixed(1)}ms`);
for (const cr of result.cases) {
  const wc = project.weatherCases.find((w) => w.id === cr.caseId)!;
  const kinds = new Map<string, number>();
  for (const v of cr.violations) kinds.set(v.kind, (kinds.get(v.kind) ?? 0) + 1);
  const c0 = cr.curves.find((c) => c.spanIndex === 14 && c.phaseIndex === 1)!;
  console.log(
    `${wc.name}: 违规 ${cr.violations.length} 处`,
    `(地 ${kinds.get('ground') ?? 0}/树 ${kinds.get('tree') ?? 0}/房 ${kinds.get('house') ?? 0})`,
    `| 代表档应力 ${c0.horizontalStress.toFixed(2)}MPa`,
    `| 中点弧垂 ${c0.midSpanSag.toFixed(3)}m`,
    `| 风偏 ${c0.swingAngleDeg.toFixed(1)}°`,
    `| 侧偏 ${c0.maxLateralOffset.toFixed(2)}m`,
  );
}
console.log('\n最严重的 5 处：');
for (const v of violations.slice(0, 5)) {
  console.log(
    `  [${v.caseId}] ${v.kind} 档${v.spanIndex + 1}相${v.phaseIndex + 1}`,
    `距离 ${v.distance.toFixed(2)}m < 限值 ${v.limit}m，超标 ${v.excess.toFixed(2)}m`,
    v.obstacleId ?? '',
  );
}
