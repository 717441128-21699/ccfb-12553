// 手写 GPU 蒙皮着色器（WebGL2 GLSL ES 3.00）。
// 骨骼矩阵通过 Uniform Buffer Object 传入，顶点带 2 骨权重，
// 在顶点着色器中做线性混合蒙皮（LBS），不走 Three.js 等框架。

export const SKIN_VERT = `#version 300 es
precision highp float;

layout(std140) uniform BoneBlock {
  mat4 uBone[80];
};
uniform mat4 uViewProj;

layout(location = 0) in vec3 aPos;       // 绑定姿态位置（模型空间）
layout(location = 1) in vec3 aNormal;    // 绑定姿态法线
layout(location = 2) in vec2 aWeight;    // x: 近端骨权重 y: 远端骨权重
layout(location = 3) in ivec2 aBoneIdx;  // 两个骨索引
layout(location = 4) in vec3 aColor;

out vec3 vNormal;
out vec3 vWorldPos;
out vec3 vColor;

void main() {
  mat4 skin = aWeight.x * uBone[aBoneIdx.x] + aWeight.y * uBone[aBoneIdx.y];
  vec4 pos = skin * vec4(aPos, 1.0);
  vec4 nrm = skin * vec4(aNormal, 0.0);
  vWorldPos = pos.xyz;
  vNormal = normalize(nrm.xyz);
  vColor = aColor;
  gl_Position = uViewProj * pos;
}`;

export const SKIN_FRAG = `#version 300 es
precision highp float;

uniform vec3 uLightDir;     // 平行光方向（指向光源）
uniform vec3 uAmbient;
uniform float uAlpha;

in vec3 vNormal;
in vec3 vWorldPos;
in vec3 vColor;
out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  // 简单的轮廓补光，避免背光面全黑
  float rim = 0.15 * (1.0 - max(dot(n, normalize(-uLightDir)), 0.0));
  vec3 lit = vColor * (uAmbient + vec3(0.75 * diff)) + vec3(rim);
  fragColor = vec4(lit, uAlpha);
}`;

// 地面网格：世界坐标固定，直接走 viewProj
export const GRID_VERT = `#version 300 es
precision highp float;
uniform mat4 uViewProj;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const GRID_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }`;

// 关节球 / 骨架线：实例化按骨矩阵变换的简单程序几何
export const RIG_VERT = `#version 300 es
precision highp float;
layout(std140) uniform BoneBlock { mat4 uBone[80]; };
uniform mat4 uViewProj;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in int aBoneIdx;
layout(location = 3) in vec3 aColor;
out vec3 vNormal;
out vec3 vColor;
void main() {
  vec4 world = uBone[aBoneIdx] * vec4(aPos, 1.0);
  vNormal = normalize((uBone[aBoneIdx] * vec4(aNormal, 0.0)).xyz);
  vColor = aColor;
  gl_Position = uViewProj * world;
}`;

export const RIG_FRAG = SKIN_FRAG;
