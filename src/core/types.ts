/**
 * 输电线路弧垂三维校核 —— 核心类型定义
 *
 * 坐标约定（局部工程坐标，单位：米）：
 *   X：线路走向（水平）
 *   Y：高程（竖直向上）
 *   Z：水平横线路方向（与 X 构成水平面）
 *
 * 所有物理量采用 SI 单位；应力/弹性模量单位 MPa（=N/mm²），截面单位 mm²。
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 导线型号参数（单根子导线；分裂导线通过 bundleN 描述） */
export interface ConductorType {
  id: string;
  name: string;
  /** 总截面积 A (mm²) */
  area: number;
  /** 外径 d (mm) */
  diameter: number;
  /** 单位长度质量 q (kg/m)，单根子导线 */
  massPerLength: number;
  /** 弹性模量 E (MPa) */
  elasticModulus: number;
  /** 线膨胀系数 α (1/℃) */
  expansionCoeff: number;
  /** 额定拉断力 RTS (N)，单根子导线 */
  ratedTensileStrength: number;
  /** 分裂根数（1=单导线） */
  bundleN: number;
}

/** 塔位与挂点 */
export interface Tower {
  id: string;
  /** 塔位平面坐标（局部工程坐标） */
  x: number;
  z: number;
  /** 塔位处地面/基础顶面高程 (m) */
  groundY: number;
  /** 横担挂点相对地面的高度 (m)，三相各一；单回三相 */
  attachmentHeights: [number, number, number];
  /** 三相挂点横向偏移（相对线路中心线，m），典型 [-8,0,8] */
  attachmentOffsets: [number, number, number];
  /** 是否为耐张塔（耐张段分界） */
  isStrain: boolean;
  label?: string;
}

/** 气象工况（按 GB 50545 / 设计手册常用组合） */
export interface WeatherCase {
  id: string;
  name: string;
  /** 气温 (℃) */
  temperature: number;
  /** 覆冰厚度 b (mm)，0 表示无冰 */
  ice: number;
  /** 设计风速 v (m/s)，10m 高基准；0 表示无风 */
  windSpeed: number;
  /** 覆冰密度 (kg/m³)，标准取 900 */
  iceDensity?: number;
  /**
   * 风的水平方向（单位向量，XY 平面内 Y=0）。
   * 缺省按横线路方向（垂直本档水平走向）取 +Z 向。
   */
  windDir?: Vec3;
  /** 风荷载是否作用在覆冰后的冰线上（true=覆冰风偏校核），缺省 false */
  windOnIce?: boolean;
  /**
   * 本工况水平应力 σ (MPa) 的给定方式：
   * - 直接给定时填 explicitStress；
   * - 否则由状态方程从参考工况反推（见 ReferenceCase）。
   */
  explicitStress?: number;
}

/** 参考工况（控制工况），用于状态方程 */
export interface ReferenceCase {
  temperature: number;
  ice: number;
  windSpeed: number;
  /** 参考工况水平应力 (MPa)，一般取年平均运行应力或安装应力 */
  stress: number;
}

/** 耐张段（两耐张塔之间；若全线无耐张塔则整线一段） */
export interface TensionSection {
  fromTower: number;
  toTower: number;
  reference: ReferenceCase;
}

/** 规则地形：规则格网 DEM */
export interface TerrainGrid {
  /** 格网原点 X (m) */
  originX: number;
  /** 格网原点 Z (m) */
  originZ: number;
  /** 格网间距 dx=dz (m) */
  cell: number;
  nx: number;
  nz: number;
  /** 高程数组，行优先 heights[iz*nx+ix] (m) */
  heights: Float64Array;
}

/** 树：树干圆柱 + 树冠球（净空校核保守包络） */
export interface TreeObstacle {
  id: string;
  x: number;
  z: number;
  /** 树干基部地面高程 (m) */
  baseY: number;
  /** 总高（自基部起，m） */
  height: number;
  /** 树冠半径 (m)；树冠球心位于 baseY + height - radius */
  crownRadius: number;
  /** 树干半径 (m) */
  trunkRadius: number;
}

/** 房屋：长方体（平顶） */
export interface HouseObstacle {
  id: string;
  x: number;
  z: number;
  /** 墙基地面高程 (m) */
  baseY: number;
  /** 建筑高度（自基部起，m） */
  height: number;
  /** 半长半宽（m，局部 X/Z 向） */
  halfX: number;
  halfZ: number;
  /** 方位角（弧度，绕 Y 轴；0 时边沿 X/Z 对齐） */
  yaw: number;
}

export type ObstacleType = 'tree' | 'house';

export interface Obstacle {
  type: ObstacleType;
  tree?: TreeObstacle;
  house?: HouseObstacle;
}

/** 规定的最小净空距离（m），可在项目里整体覆盖 */
export interface ClearanceLimits {
  /** 导线到地面的最小垂直距离（居民区） */
  groundResidential: number;
  /** 导线到地面的最小垂直距离（非居民区） */
  groundNonResidential: number;
  /** 导线到地面的最小垂直距离（交通困难地区） */
  groundDifficult: number;
  /** 最大风偏时导线到树木的最小净空距离 */
  treeWind: number;
  /** 导线到房屋（建筑物）的最小垂直距离 */
  houseVertical: number;
  /** 最大风偏时导线到房屋的最小净空距离 */
  houseWind: number;
}

export type RegionType = 'residential' | 'nonResidential' | 'difficult';

export interface ProjectInput {
  name: string;
  voltageKv: number;
  region: RegionType;
  conductors: ConductorType[];
  /** 每相使用的导线型号 id（三相共用一个型号也可分别指定） */
  phaseConductorIds: [string, string, string];
  towers: Tower[];
  weatherCases: WeatherCase[];
  tensionSections: TensionSection[];
  terrain?: TerrainGrid;
  obstacles: Obstacle[];
  limits: ClearanceLimits;
}

/** 三维点（带沿线里程与弧垂信息） */
export interface CurvePoint extends Vec3 {
  /** 自本档起点挂点的弧长 (m) */
  s: number;
  /** 该点处导线张力 (N，整根子导线/分裂等效整体按输入面积计) */
  tension: number;
}

/** 单档解算结果（某相、某工况） */
export interface SpanCurve {
  spanIndex: number;
  phaseIndex: number;
  caseId: string;
  /** 起点挂点 */
  start: Vec3;
  /** 终点挂点 */
  end: Vec3;
  /** 档距（两挂点水平距离，m） */
  horizontalSpan: number;
  /** 挂点高差 (m)，终点减起点 */
  heightDifference: number;
  /** 代表档距/本档使用的水平应力 (MPa) */
  horizontalStress: number;
  /** 水平张力 H (N) = σ·A_total */
  horizontalTension: number;
  /** 中点弧垂（挂点连线中点的竖直垂度，m） */
  midSpanSag: number;
  /** 最大弧垂（m）及其距起点水平距离 (m) */
  maxSag: number;
  maxSagX: number;
  /** 悬链线总长（两挂点间弧长，m） */
  length: number;
  /** 风偏角（度）：合成荷载与竖直方向的夹角，无风为 0 */
  swingAngleDeg: number;
  /** 侧向最大偏移量（m），无风为 0 */
  maxLateralOffset: number;
  /** 自适应加密后的导线折线点（含两端挂点） */
  points: CurvePoint[];
}

export type ViolationKind = 'ground' | 'tree' | 'house';

export interface Violation {
  kind: ViolationKind;
  spanIndex: number;
  phaseIndex: number;
  caseId: string;
  /** 导线侧最近点 */
  wirePoint: Vec3;
  /** 目标侧最近点 */
  targetPoint: Vec3;
  /** 实际最小距离（地面为垂直距离，m） */
  distance: number;
  /** 规定限值 (m) */
  limit: number;
  /** 超标量 limit-distance (m) */
  excess: number;
  obstacleId?: string;
}

export interface CaseResult {
  caseId: string;
  curves: SpanCurve[];
  violations: Violation[];
  /** 解算耗时（毫秒，仅本工况） */
  elapsedMs: number;
}

export interface ProjectResult {
  cases: CaseResult[];
  totalElapsedMs: number;
}
