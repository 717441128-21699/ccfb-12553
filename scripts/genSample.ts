/**
 * CLI：生成示例工程 JSON 到 sample/。
 * 纯数据构造见 src/sample/sampleProject.ts（浏览器共用）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildSampleProject } from '../src/sample/sampleProject';

const project = buildSampleProject();
const plain = JSON.stringify(
  project,
  (_key, value) => (value instanceof Float64Array ? Array.from(value) : value),
  2,
);
const outPath = resolve(process.cwd(), 'sample/sample-project.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, plain, 'utf-8');
console.log(`示例工程已写入 ${outPath}（${project.towers.length} 基塔，${project.obstacles.length} 个障碍）`);
