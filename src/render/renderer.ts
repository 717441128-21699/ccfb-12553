// WebGL2 场景渲染器：UBO 蒙皮、地面网格、骨盆跟随镜头、轨道交互、
// 双骨骼半透明叠加、离屏截图。不依赖任何 3D 框架。
import type { BvhData, Pose } from '../core/types';
import {
  perspective, lookAt, identity, type Mat4, type Vec3,
  lerp, clamp,
} from '../core/math';
import { buildSkinMesh, type SkinMesh } from './mesh';
import { mapJoints } from '../bvh/angles';
import { SKIN_VERT, SKIN_FRAG, GRID_VERT, GRID_FRAG, RIG_VERT, RIG_FRAG } from './shaders';

const MAX_BONES = 80;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export interface ActorOptions {
  alpha: number;
  showRig: boolean;
}

interface Actor {
  bvh: BvhData;
  mesh: SkinMesh;
  vao: WebGLVertexArrayObject;
  ibo: WebGLBuffer;
  opts: ActorOptions;
  pelvis: number;
}

export class GaitRenderer {
  private gl: WebGL2RenderingContext;
  private skinProg: WebGLProgram;
  private gridProg: WebGLProgram;
  private rigProg: WebGLProgram;
  private boneUbo: WebGLBuffer;
  private gridVao!: WebGLVertexArrayObject;
  private gridVertexCount = 0;
  private actors: Actor[] = [];
  private rigSphereVao!: WebGLVertexArrayObject;
  private rigSphereCount = 0;

  // 镜头轨道参数（球坐标，围绕跟随目标）
  private yaw = 0.6;
  private pitch = 0.25;
  private distance = 220;
  private followTarget: Vec3 = [0, 90, 0];
  private followEnabled = true;
  private gridHalf = 400;

  // 视图矩阵缓存（供截图/叠加对齐）
  private viewProj: Mat4 = identity();
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.skinProg = program(gl, SKIN_VERT, SKIN_FRAG);
    this.gridProg = program(gl, GRID_VERT, GRID_FRAG);
    this.rigProg = program(gl, RIG_VERT, RIG_FRAG);

    // UBO：80 个 mat4，std140 下每个 mat4 占 64 字节
    this.boneUbo = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.boneUbo);
    gl.bufferData(gl.UNIFORM_BUFFER, MAX_BONES * 64, gl.DYNAMIC_DRAW);
    const blockIdx = gl.getUniformBlockIndex(this.skinProg, 'BoneBlock');
    gl.uniformBlockBinding(this.skinProg, blockIdx, 0);
    const rigBlock = gl.getUniformBlockIndex(this.rigProg, 'BoneBlock');
    gl.uniformBlockBinding(this.rigProg, rigBlock, 0);

    this.buildGrid();
    this.buildJointSphere();
    this.bindControls();
  }

  addActor(bvh: BvhData, restPose: Pose, opts: ActorOptions): number {
    const gl = this.gl;
    const mesh = buildSkinMesh(bvh, restPose.positions);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const attrib = (loc: number, data: Float32Array | Int32Array, size: number, type: number) => {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, false, 0, 0);
    };
    attrib(0, mesh.positions, 3, gl.FLOAT);
    attrib(1, mesh.normals, 3, gl.FLOAT);
    attrib(2, mesh.weights, 2, gl.FLOAT);
    // ivec2 用整数属性
    {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.boneIdx, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribIPointer(3, 2, gl.INT, 0, 0);
    }
    attrib(4, mesh.colors, 3, gl.FLOAT);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const actor: Actor = {
      bvh, mesh, vao, ibo, opts,
      pelvis: mapJoints(bvh).pelvis,
    };
    this.actors.push(actor);
    this.fitDistance();
    return this.actors.length - 1;
  }

  clearActors() {
    this.actors = [];
  }

  setActorAlpha(idx: number, alpha: number) {
    if (this.actors[idx]) this.actors[idx].opts.alpha = alpha;
  }
  setActorRig(idx: number, show: boolean) {
    if (this.actors[idx]) this.actors[idx].opts.showRig = show;
  }
  setFollow(on: boolean) { this.followEnabled = on; }

  private fitDistance() {
    // 按第一个演员骨架尺寸调整镜头距离
    const a = this.actors[0];
    if (!a) return;
    const pos = a.mesh.positions;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      minY = Math.min(minY, pos[i]);
      maxY = Math.max(maxY, pos[i]);
    }
    this.distance = (maxY - minY) * 2.2;
    this.followTarget = [0, (maxY + minY) / 2, 0];
  }

  private buildGrid() {
    const gl = this.gl;
    const verts: number[] = [];
    const h = this.gridHalf;
    const step = 25;
    const major = 100;
    const push = (x1: number, z1: number, x2: number, z2: number, c: Vec3) => {
      verts.push(x1, 0, z1, ...c, x2, 0, z2, ...c);
    };
    for (let i = -h; i <= h; i += step) {
      const isMajor = i % major === 0;
      const c: Vec3 = isMajor ? [0.45, 0.5, 0.55] : [0.22, 0.25, 0.28];
      push(i, -h, i, h, c);
      push(-h, i, h, i, c);
    }
    // 中线（行进方向参照）高亮
    push(0, -h, 0, h, [0.6, 0.35, 0.35]);

    this.gridVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.gridVao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(verts), gl.STATIC_DRAW);
    this.gridVertexCount = verts.length / 6; // 每顶点 3 位置 + 3 颜色
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
  }

  /** 关节球几何（单位球，渲染时由骨矩阵定位） */
  private buildJointSphere() {
    const gl = this.gl;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const lat = 8, lon = 10;
    for (let la = 0; la <= lat; la++) {
      const phi = (la / lat) * Math.PI;
      for (let lo = 0; lo <= lon; lo++) {
        const theta = (lo / lon) * Math.PI * 2;
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(theta);
        positions.push(x * 3, y * 3, z * 3);
        normals.push(x, y, z);
      }
    }
    const per = lon + 1;
    for (let la = 0; la < lat; la++) {
      for (let lo = 0; lo < lon; lo++) {
        const a = la * per + lo;
        indices.push(a, a + per, a + 1, a + 1, a + per, a + per + 1);
      }
    }
    this.rigSphereVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.rigSphereVao);
    const pbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, nbuf);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(normals), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    // location 2 (aBoneIdx, int) 与 location 3 (aColor) 为常量属性，绘制时逐球设置
    const ibuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint16Array.from(indices), gl.STATIC_DRAW);
    this.rigSphereCount = indices.length;
    gl.bindVertexArray(null);
  }

  private bindControls() {
    const c = this.canvas;
    let dragging = false;
    let lastX = 0, lastY = 0;
    c.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.yaw -= (e.clientX - lastX) * 0.008;
      this.pitch = clamp(this.pitch + (e.clientY - lastY) * 0.008, -1.2, 1.2);
      lastX = e.clientX; lastY = e.clientY;
    });
    c.addEventListener('pointerup', () => { dragging = false; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = clamp(this.distance * (1 + e.deltaY * 0.001), 30, 2000);
    }, { passive: false });
  }

  private uploadBones(pose: Pose) {
    const gl = this.gl;
    const data = new Float32Array(MAX_BONES * 16);
    const n = Math.min(pose.world.length, MAX_BONES);
    for (let i = 0; i < n; i++) data.set(pose.world[i], i * 16);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.boneUbo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.boneUbo);
  }

  /** 每帧渲染：poses 与 actors 等长 */
  render(poses: Pose[]) {
    const gl = this.gl;
    // 离屏截图时画布未挂载、clientWidth 为 0，此时保留已显式设置的画布尺寸
    if (this.canvas.clientWidth > 0) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.floor(this.canvas.clientWidth * dpr);
      const ch = Math.floor(this.canvas.clientHeight * dpr);
      if (this.canvas.width !== cw || this.canvas.height !== ch) {
        this.canvas.width = cw;
        this.canvas.height = ch;
      }
    }
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.08, 0.09, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    // 镜头跟随：取第一个演员的骨盆位置（叠加对比时以主患者为准）
    if (this.followEnabled && poses[0] && this.actors[0]) {
      const p = poses[0].positions[this.actors[0].pelvis];
      this.followTarget = [
        lerp(this.followTarget[0], p[0], 0.15),
        lerp(this.followTarget[1], p[1], 0.15),
        lerp(this.followTarget[2], p[2], 0.15),
      ];
    }
    const target = this.followTarget;
    const cp = Math.cos(this.pitch);
    const eye: Vec3 = [
      target[0] + this.distance * cp * Math.sin(this.yaw),
      target[1] + this.distance * Math.sin(this.pitch),
      target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
    const view = lookAt(eye, target, [0, 1, 0]);
    const proj = perspective(45, w / h, 1, 6000);
    this.viewProj = matMul(proj, view);

    // 地面网格
    gl.useProgram(this.gridProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.gridProg, 'uViewProj'), false, this.viewProj);
    gl.bindVertexArray(this.gridVao);
    gl.drawArrays(gl.LINES, 0, this.gridVertexCount);
    gl.bindVertexArray(null);

    // 演员（先画不透明主体，再开混合画半透明叠加者）
    const order = this.actors
      .map((a, i) => ({ a, i }))
      .sort((x, y) => y.a.opts.alpha - x.a.opts.alpha);
    for (const { a, i } of order) {
      const pose = poses[i];
      if (!pose) continue;
      this.uploadBones(pose);
      gl.useProgram(this.skinProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.skinProg, 'uViewProj'), false, this.viewProj);
      gl.uniform3f(gl.getUniformLocation(this.skinProg, 'uLightDir'), 0.4, 0.9, 0.3);
      gl.uniform3f(gl.getUniformLocation(this.skinProg, 'uAmbient'), 0.35, 0.37, 0.4);
      gl.uniform1f(gl.getUniformLocation(this.skinProg, 'uAlpha'), a.opts.alpha);
      if (a.opts.alpha < 0.999) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      }
      gl.bindVertexArray(a.vao);
      gl.drawElements(gl.TRIANGLES, a.mesh.indexCount, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.BLEND);

      if (a.opts.showRig) this.drawRig(pose, a);
    }
  }

  /** 骨架球叠加层（关节位置可视化） */
  private drawRig(_pose: Pose, a: Actor) {
    const gl = this.gl;
    gl.useProgram(this.rigProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.rigProg, 'uViewProj'), false, this.viewProj);
    gl.uniform3f(gl.getUniformLocation(this.rigProg, 'uLightDir'), 0.4, 0.9, 0.3);
    gl.uniform3f(gl.getUniformLocation(this.rigProg, 'uAmbient'), 0.4, 0.4, 0.4);
    gl.uniform1f(gl.getUniformLocation(this.rigProg, 'uAlpha'), 1);
    gl.bindVertexArray(this.rigSphereVao);
    for (const bone of a.mesh.jointBones) {
      gl.vertexAttribI4i(2, bone, 0, 0, 0);
      gl.vertexAttrib3f(3, 1, 0.9, 0.3);
      gl.drawElements(gl.TRIANGLES, this.rigSphereCount, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }

  /** 截图（PNG dataURL），供对比报告插图 */
  snapshot(): string {
    return this.canvas.toDataURL('image/png');
  }

  get cameraInfo() {
    return { yaw: this.yaw, pitch: this.pitch, distance: this.distance, target: this.followTarget };
  }
}

/** 4x4 矩阵乘法（渲染器内部使用，避免 math 模块命名冲突） */
function matMul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = s;
    }
  }
  return out;
}
