/**
 * 场景渲染器：管理 WebGL2 状态、相机交互、图层显隐与离屏拾取。
 * 拾取用独立低分辨率离屏 framebuffer，把图元 id 编码进颜色。
 */
import {
  buildMesh,
  linkProgram,
  LINE_FS,
  LINE_VS,
  SCENE_FS,
  SCENE_VS,
  type Mesh,
} from './glHelpers';
import { clamp, mat4Multiply, mat4Perspective, orbitEye, orbitView, type OrbitState } from './mat4';
import type { ProjectInput, ProjectResult } from '../core/types';
import {
  buildObstacleMeshes,
  buildTerrainGridLines,
  buildTerrainMesh,
  buildTowerLines,
  buildViolationMarkers,
  buildWireLines,
  COLORS,
} from './geometry';

export interface LayerVisibility {
  terrain: boolean;
  towers: boolean;
  wires: boolean;
  obstacles: boolean;
  violations: boolean;
}

export class SceneRenderer {
  private gl: WebGL2RenderingContext;
  private sceneProg: WebGLProgram;
  private lineProg: WebGLProgram;
  private orbit: OrbitState;
  private meshes: Array<{ mesh: Mesh; kind: 'triangles' | 'lines' | 'points'; layer: keyof LayerVisibility }> = [];
  private canvas: HTMLCanvasElement;
  visibility: LayerVisibility = { terrain: true, towers: true, wires: true, obstacles: true, violations: true };
  private activeCaseId: string | null = null;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.sceneProg = linkProgram(gl, SCENE_VS, SCENE_FS);
    this.lineProg = linkProgram(gl, LINE_VS, LINE_FS);
    this.orbit = { target: { x: 0, y: 100, z: 0 }, distance: 2000, yaw: 0.6, pitch: 0.5 };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.bindControls();
  }

  private bindControls(): void {
    const c = this.canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    c.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.orbit.yaw -= dx * 0.005;
      this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.005, -1.2, 1.35);
      this.invalidate();
    });
    c.addEventListener('pointerup', () => {
      dragging = false;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.distance = clamp(this.orbit.distance * Math.exp(e.deltaY * 0.001), 80, 12000);
      this.invalidate();
    }, { passive: false });
  }

  setActiveCase(id: string | null): void {
    this.activeCaseId = id;
    this.invalidate();
  }

  /** 载入工程与解算结果，重建全部静态几何 */
  setScene(input: ProjectInput, result: ProjectResult): void {
    const gl = this.gl;
    this.disposeMeshes();

    if (input.terrain) {
      this.addMesh(buildTerrainMesh(input.terrain), 'triangles', 'terrain');
      this.addMesh(buildTerrainGridLines(input.terrain), 'lines', 'terrain');
    }
    this.addMesh(buildTowerLines(input), 'lines', 'towers');
    this.addMesh(buildObstacleMeshes(input.obstacles), 'triangles', 'obstacles');

    // 每工况导线分别建网格，按 activeCaseId 过滤绘制
    for (const caseResult of result.cases) {
      const wc = input.weatherCases.find((w) => w.id === caseResult.caseId);
      const color =
        wc?.id === 'high-temp' || (wc && wc.windSpeed === 0 && wc.temperature >= 35)
          ? COLORS.wireHot
          : wc && wc.ice > 0
            ? COLORS.wireIce
            : COLORS.wireWind;
      const mesh = buildMesh(gl, buildWireLines(caseResult.curves, color), 'lines');
      this.meshes.push({ mesh, kind: 'lines', layer: 'wires' });
      (mesh as Mesh & { caseId?: string }).caseId = caseResult.caseId;
    }

    // 违规标记（合并所有工况，拾取可点）
    const allVio = result.cases.flatMap((c) => c.violations);
    const markers = buildViolationMarkers(allVio);
    if (markers.triangles.length) this.addMesh(markers.triangles, 'triangles', 'violations');
    if (markers.lines.length) this.addMesh(markers.lines, 'lines', 'violations');

    // 相机对准线路中心
    const xs = input.towers.map((t) => t.x);
    const zs = input.towers.map((t) => t.z);
    const ys = input.towers.map((t) => t.groundY);
    this.orbit.target = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2 + 30,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
    };
    const span = Math.max(...xs) - Math.min(...xs);
    this.orbit.distance = clamp(span * 0.9, 300, 9000);
    this.invalidate();
  }

  private addMesh(vertices: Float32Array, kind: 'triangles' | 'lines' | 'points', layer: keyof LayerVisibility): void {
    const mesh = buildMesh(this.gl, vertices, kind);
    this.meshes.push({ mesh, kind, layer });
  }

  private disposeMeshes(): void {
    for (const { mesh } of this.meshes) {
      this.gl.deleteBuffer(mesh.vbo);
      this.gl.deleteVertexArray(mesh.vao);
    }
    this.meshes = [];
  }

  invalidate(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private viewProj(): Float32Array {
    const aspect = this.canvas.width / this.canvas.height;
    const proj = mat4Perspective((50 * Math.PI) / 180, aspect, 1, 20000);
    return mat4Multiply(proj, orbitView(this.orbit));
  }

  private frame(): void {
    this.raf = 0;
    this.resize();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.78, 0.82, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const vp = this.viewProj();
    const eye = orbitEye(this.orbit);

    for (const entry of this.meshes) {
      if (!this.visibility[entry.layer]) continue;
      const caseId = (entry.mesh as Mesh & { caseId?: string }).caseId;
      if (caseId && this.activeCaseId && caseId !== this.activeCaseId) continue;
      const prog = entry.kind === 'triangles' ? this.sceneProg : this.lineProg;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uViewProj'), false, vp);
      gl.uniform1f(gl.getUniformLocation(prog, 'uAlpha'), 1);
      if (entry.kind === 'triangles') {
        gl.uniform3f(gl.getUniformLocation(prog, 'uLightDir'), 0.5, 0.9, 0.35);
        gl.uniform3f(gl.getUniformLocation(prog, 'uEye'), eye.x, eye.y, eye.z);
        gl.enable(gl.CULL_FACE);
      } else {
        gl.disable(gl.CULL_FACE);
        gl.lineWidth(1);
      }
      gl.bindVertexArray(entry.mesh.vao);
      gl.drawArrays(entry.kind === 'triangles' ? gl.TRIANGLES : gl.LINES, 0, entry.mesh.vertexCount);
    }
    gl.bindVertexArray(null);
  }

  getOrbit(): OrbitState {
    return { ...this.orbit, target: { ...this.orbit.target } };
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.disposeMeshes();
    this.gl.deleteProgram(this.sceneProg);
    this.gl.deleteProgram(this.lineProg);
  }
}
