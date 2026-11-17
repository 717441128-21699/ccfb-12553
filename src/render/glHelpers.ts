/** WebGL2 底层封装：着色器编译、程序链接、网格构建 */

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('无法创建 WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader 编译失败：${log}\n${source}`);
  }
  return shader;
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error('无法创建 WebGL program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program 链接失败：${log}`);
  }
  return program;
}

export interface Mesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  vertexCount: number;
  /** 线段索引计数（LINES 模式用），0 表示纯三角形/点 */
  lineCount?: number;
}

/** 由交错顶点数组（pos.xyz + normal.xyz + color.rgb = 8 float/顶点）建网格 */
export function buildMesh(
  gl: WebGL2RenderingContext,
  vertices: Float32Array,
  mode: 'triangles' | 'lines' | 'points',
): Mesh {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('无法创建 VAO');
  const vbo = gl.createBuffer();
  if (!vbo) throw new Error('无法创建 VBO');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const stride = 8 * 4;
  // position location 0
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  // normal location 1
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  // color location 2
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
  gl.bindVertexArray(null);
  const vertexCount = vertices.length / 8;
  return { vao, vbo, vertexCount, lineCount: mode === 'lines' ? vertexCount : undefined };
}

export const SCENE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorldPos;
void main() {
  vNormal = aNormal;
  vColor = aColor;
  vWorldPos = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const SCENE_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorldPos;
uniform vec3 uLightDir;
uniform vec3 uEye;
uniform float uAlpha;
out vec4 frag;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  float ambient = 0.45;
  // 简单距离雾，弱化远景
  float dist = length(uEye - vWorldPos);
  float fog = clamp((dist - 1500.0) / 4000.0, 0.0, 0.75);
  vec3 lit = vColor * (ambient + 0.65 * diff);
  vec3 fogColor = vec3(0.78, 0.82, 0.86);
  frag = vec4(mix(lit, fogColor, fog), uAlpha);
}`;

export const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const LINE_FS = `#version 300 es
precision highp float;
in vec3 vColor;
uniform float uAlpha;
out vec4 frag;
void main() { frag = vec4(vColor, uAlpha); }`;
