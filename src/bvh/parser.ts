// BVH (Biovision Hierarchy) 解析器。
// 支持任意关节层级、任意通道顺序（决定每关节欧拉序）、多空白/换行。
import type { BvhData, BvhJoint, Channel } from '../core/types';

class Tokenizer {
  private tokens: string[];
  private pos = 0;
  constructor(text: string) {
    this.tokens = text.split(/[\s,]+/).filter((t) => t.length > 0);
  }
  next(): string {
    if (this.pos >= this.tokens.length) throw new Error('BVH 解析意外结束');
    return this.tokens[this.pos++];
  }
  peek(): string {
    return this.tokens[this.pos];
  }
  expect(word: string): void {
    const t = this.next();
    if (t.toUpperCase() !== word.toUpperCase()) {
      throw new Error(`BVH 解析错误：期望 "${word}"，实际 "${t}"`);
    }
  }
  number(): number {
    const t = this.next();
    const n = Number(t);
    if (Number.isNaN(n)) throw new Error(`BVH 解析错误：期望数字，实际 "${t}"`);
    return n;
  }
  get eof(): boolean {
    return this.pos >= this.tokens.length;
  }
}

const VALID_CHANNELS: ReadonlySet<Channel> = new Set([
  'Xposition', 'Yposition', 'Zposition',
  'Xrotation', 'Yrotation', 'Zrotation',
]);

export function parseBvh(text: string, fileName = 'captured.bvh'): BvhData {
  const tk = new Tokenizer(text);
  const joints: BvhJoint[] = [];
  const nameToIndex = new Map<string, number>();
  let channelCursor = 0;

  // 进入时 ROOT/JOINT 关键字已被消费（根节点除外），统一在此解析节点体
  function parseNode(name: string, parent: number): number {
    tk.expect('{');
    tk.expect('OFFSET');
    const offset: [number, number, number] = [tk.number(), tk.number(), tk.number()];
    const channels: Channel[] = [];
    if (tk.peek() === 'CHANNELS') {
      tk.next();
      const count = tk.number();
      for (let i = 0; i < count; i++) {
        const ch = tk.next() as Channel;
        if (!VALID_CHANNELS.has(ch)) throw new Error(`BVH 未知通道 ${ch}`);
        channels.push(ch);
      }
    }
    const index = joints.length;
    joints.push({
      name, index, parent, offset, children: [], channels,
      channelOffset: channelCursor,
    });
    nameToIndex.set(name, index);
    channelCursor += channels.length;
    if (parent >= 0) joints[parent].children.push(index);

    while (true) {
      const word = tk.next();
      const w = word.toUpperCase();
      if (w === 'JOINT') {
        parseNode(tk.next(), index);
      } else if (w === 'END') {
        tk.expect('SITE');
        tk.expect('{');
        tk.expect('OFFSET');
        tk.number(); tk.number(); tk.number();
        tk.expect('}');
      } else if (w === '}') {
        break;
      } else {
        throw new Error(`BVH 层级中出现意外 token "${word}"`);
      }
    }
    return index;
  }

  tk.expect('HIERARCHY');
  tk.expect('ROOT');
  parseNode(tk.next(), -1);

  tk.expect('MOTION');
  tk.expect('Frames:');
  const frameCount = tk.number();
  tk.expect('Frame'); // "Frame Time:" 拆成两个 token
  tk.expect('Time:');  const frameTime = tk.number();

  const channelCount = channelCursor;
  const frames: Float32Array[] = [];
  for (let f = 0; f < frameCount; f++) {
    const row = new Float32Array(channelCount);
    for (let c = 0; c < channelCount; c++) row[c] = tk.number();
    frames.push(row);
  }

  return {
    joints, nameToIndex, frameTime, frames, frameCount,
    channelCount, rawText: text, fileName,
  };
}
