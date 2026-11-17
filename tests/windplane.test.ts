import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWindPlane, mapToWorld, normalize, cross, dot } from '../src/core/windPlane';
import { solveCatenary2D } from '../src/core/catenary2d';

test('无风：eU 竖直向上，eT 沿水平档距，映射退化为竖直平面悬链线', () => {
  const chord = { x: 300, y: 15, z: 0 };
  const basis = makeWindPlane(chord, 0);
  assert.ok(Math.abs(basis.eU.y - 1) < 1e-15);
  assert.ok(Math.abs(basis.eT.x - 1) < 1e-15);
  assert.ok(Math.abs(basis.L2d - 300) < 1e-12);
  assert.ok(Math.abs(basis.h2d - 15) < 1e-12);
});

test('有风等高档：曲线整体偏向风去向，两端仍精确落在挂点上', () => {
  const L = 300;
  const swing = 0.35; // rad ≈ 20°
  const chord = { x: L, y: 0, z: 0 };
  const basis = makeWindPlane(chord, swing);
  const cat = solveCatenary2D({ L: basis.L2d, h: basis.h2d, c: 1000 });

  const anchor = { x: 0, y: 50, z: 0 };
  const p0 = mapToWorld(anchor, basis, cat.pointAt(0).xi, cat.pointAt(0).eta);
  const p1 = mapToWorld(anchor, basis, cat.pointAt(L).xi, cat.pointAt(L).eta);
  assert.ok(Math.hypot(p0.x - anchor.x, p0.y - anchor.y, p0.z - anchor.z) < 1e-12);
  assert.ok(Math.hypot(p1.x - (anchor.x + L), p1.y - anchor.y, p1.z) < 1e-12);

  // 中点应向风去向偏移（默认风向 cross(up,eT)=-Z）
  const mid = mapToWorld(anchor, basis, L / 2, cat.pointAt(L / 2).eta);
  assert.ok(mid.z < 0);
  assert.ok(mid.y < anchor.y); // 仍然下垂
});

test('eT 与 eU 正交单位向量，弦分解可还原', () => {
  const chord = { x: 350, y: -22, z: 40 };
  const basis = makeWindPlane(chord, 0.28, normalize({ x: 0, y: 0, z: 1 }));
  assert.ok(Math.abs(dot(basis.eT, basis.eU)) < 1e-12);
  assert.ok(Math.abs(Math.hypot(basis.eT.x, basis.eT.y, basis.eT.z) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(basis.eU.x, basis.eU.y, basis.eU.z) - 1) < 1e-12);
  const recon = {
    x: basis.L2d * basis.eT.x + basis.h2d * basis.eU.x,
    y: basis.L2d * basis.eT.y + basis.h2d * basis.eU.y,
    z: basis.L2d * basis.eT.z + basis.h2d * basis.eU.z,
  };
  assert.ok(Math.hypot(recon.x - chord.x, recon.y - chord.y, recon.z - chord.z) < 1e-10);
});

test('指定风向 +Z 时，导线向 +Z 侧偏；风偏角等于输入角', () => {
  const chord = { x: 280, y: 0, z: 0 };
  const swing = 0.4;
  const basis = makeWindPlane(chord, swing, { x: 0, y: 0, z: 1 });
  assert.ok(Math.abs(basis.swingRad - swing) < 1e-15);
  const cat = solveCatenary2D({ L: basis.L2d, h: basis.h2d, c: 800 });
  const mid = mapToWorld({ x: 0, y: 40, z: 0 }, basis, 140, cat.pointAt(140).eta);
  assert.ok(mid.z > 0);
});

test('默认风向为横线路方向（up×eSpan），与档距方向垂直', () => {
  const chord = { x: 0, y: 10, z: 300 }; // 档距沿 +Z
  const basis = makeWindPlane(chord, 0.2);
  const eSpan = normalize({ x: 0, y: 0, z: 1 });
  const expected = cross({ x: 0, y: 1, z: 0 }, eSpan);
  assert.ok(Math.hypot(basis.windDir.x - expected.x, basis.windDir.z - expected.z) < 1e-12);
  assert.ok(Math.abs(dot(basis.windDir, eSpan)) < 1e-12);
});
