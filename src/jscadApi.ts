// JSCAD API 한 곳 정리. 도형 팔레트, 자동완성, 매개변수 툴팁이 모두 이 표를 본다.
export type JscadModule =
  | 'primitives' | 'booleans' | 'transforms' | 'extrusions'
  | 'expansions' | 'hulls' | 'colors' | 'utils' | 'measurements'

export interface ApiEntry {
  name: string
  module: JscadModule
  signature: string
  summary: string
  params: string[]
  snippet: string
}

export interface SnippetGroup {
  id: string
  label: string
  items: PaletteItem[]
}

export interface PaletteItem {
  id: string
  label: string
  signature: string
  summary: string
  code: string
  requires: { module: JscadModule; names: string[] }[]
}

const entry = (
  name: string,
  module: JscadModule,
  signature: string,
  summary: string,
  params: string[],
  snippet: string,
): ApiEntry => ({ name, module, signature, summary, params, snippet })

export const API: ApiEntry[] = [
  // 3D 기본 도형
  entry('cuboid', 'primitives', 'cuboid({ size, center })', '직육면체를 만든다.',
    ['size: [x, y, z] — 각 축 길이 (기본 [2, 2, 2])', 'center: [x, y, z] — 중심 위치 (기본 [0, 0, 0])'],
    'cuboid({ size: [20, 20, 10] })'),
  entry('roundedCuboid', 'primitives', 'roundedCuboid({ size, roundRadius, segments, center })', '모서리가 둥근 직육면체를 만든다.',
    ['size: [x, y, z] — 각 축 길이', 'roundRadius: 숫자 — 모서리 반지름 (기본 0.2)', 'segments: 숫자 — 둥근 면 분할 수 (기본 32)', 'center: [x, y, z] — 중심 위치'],
    'roundedCuboid({ size: [20, 20, 10], roundRadius: 1.5, segments: 32 })'),
  entry('sphere', 'primitives', 'sphere({ radius, segments, center })', '구를 만든다.',
    ['radius: 숫자 — 반지름 (기본 1)', 'segments: 숫자 — 분할 수, 클수록 매끄럽다 (기본 32)', 'center: [x, y, z] — 중심 위치'],
    'sphere({ radius: 10, segments: 48 })'),
  entry('cylinder', 'primitives', 'cylinder({ radius, height, segments, center })', '원기둥을 만든다.',
    ['radius: 숫자 — 반지름 (기본 1)', 'height: 숫자 — 높이 (기본 2)', 'segments: 숫자 — 옆면 분할 수 (기본 32)', 'center: [x, y, z] — 중심 위치'],
    'cylinder({ radius: 6, height: 20, segments: 48 })'),
  entry('roundedCylinder', 'primitives', 'roundedCylinder({ radius, height, roundRadius, segments })', '위아래 모서리가 둥근 원기둥을 만든다.',
    ['radius: 숫자 — 반지름', 'height: 숫자 — 높이', 'roundRadius: 숫자 — 모서리 반지름 (반지름보다 작아야 한다)', 'segments: 숫자 — 분할 수'],
    'roundedCylinder({ radius: 6, height: 20, roundRadius: 1, segments: 48 })'),
  entry('cylinderElliptic', 'primitives', 'cylinderElliptic({ startRadius, endRadius, height, segments })', '위아래 반지름이 다른 원뿔·원기둥을 만든다.',
    ['startRadius: [x, y] — 아래쪽 반지름', 'endRadius: [x, y] — 위쪽 반지름, [0, 0]이면 원뿔', 'height: 숫자 — 높이', 'segments: 숫자 — 분할 수'],
    'cylinderElliptic({ startRadius: [8, 8], endRadius: [0, 0], height: 16, segments: 48 })'),
  entry('torus', 'primitives', 'torus({ innerRadius, outerRadius, innerSegments, outerSegments })', '도넛 모양을 만든다.',
    ['innerRadius: 숫자 — 관 굵기 반지름 (기본 1)', 'outerRadius: 숫자 — 중심에서 관까지 거리 (기본 4)', 'innerSegments: 숫자 — 관 단면 분할 수', 'outerSegments: 숫자 — 둘레 분할 수'],
    'torus({ innerRadius: 2, outerRadius: 10, innerSegments: 24, outerSegments: 48 })'),
  entry('ellipsoid', 'primitives', 'ellipsoid({ radius, segments, center })', '축마다 반지름이 다른 타원체를 만든다.',
    ['radius: [x, y, z] — 축별 반지름', 'segments: 숫자 — 분할 수', 'center: [x, y, z] — 중심 위치'],
    'ellipsoid({ radius: [12, 8, 5], segments: 48 })'),
  entry('geodesicSphere', 'primitives', 'geodesicSphere({ radius, frequency })', '삼각형으로 균일하게 나눈 구를 만든다.',
    ['radius: 숫자 — 반지름', 'frequency: 숫자 — 분할 빈도, 6의 배수를 쓴다 (기본 6)'],
    'geodesicSphere({ radius: 10, frequency: 12 })'),

  // 2D 도형
  entry('rectangle', 'primitives', 'rectangle({ size, center })', '2D 직사각형을 만든다.',
    ['size: [x, y] — 가로·세로 길이', 'center: [x, y] — 중심 위치'],
    'rectangle({ size: [20, 12] })'),
  entry('roundedRectangle', 'primitives', 'roundedRectangle({ size, roundRadius, segments })', '모서리가 둥근 2D 사각형을 만든다.',
    ['size: [x, y] — 가로·세로 길이', 'roundRadius: 숫자 — 모서리 반지름', 'segments: 숫자 — 분할 수'],
    'roundedRectangle({ size: [20, 12], roundRadius: 2, segments: 32 })'),
  entry('circle', 'primitives', 'circle({ radius, segments, center })', '2D 원을 만든다.',
    ['radius: 숫자 — 반지름', 'segments: 숫자 — 분할 수', 'center: [x, y] — 중심 위치'],
    'circle({ radius: 8, segments: 48 })'),
  entry('ellipse', 'primitives', 'ellipse({ radius, segments })', '2D 타원을 만든다.',
    ['radius: [x, y] — 축별 반지름', 'segments: 숫자 — 분할 수'],
    'ellipse({ radius: [12, 6], segments: 48 })'),
  entry('polygon', 'primitives', 'polygon({ points })', '점을 이어 2D 다각형을 만든다.',
    ['points: [[x, y], ...] — 반시계 방향 좌표 목록'],
    'polygon({ points: [[0, 0], [20, 0], [20, 10], [8, 16]] })'),
  entry('star', 'primitives', 'star({ vertices, outerRadius, innerRadius })', '2D 별을 만든다.',
    ['vertices: 숫자 — 꼭짓점 개수 (기본 5)', 'outerRadius: 숫자 — 바깥 반지름', 'innerRadius: 숫자 — 안쪽 반지름'],
    'star({ vertices: 5, outerRadius: 12, innerRadius: 5 })'),

  // 합치고 빼기
  entry('union', 'booleans', 'union(...geometries)', '여러 도형을 하나로 합친다.',
    ['...geometries — 합칠 도형들 (2개 이상)'],
    'union(shapeA, shapeB)'),
  entry('subtract', 'booleans', 'subtract(base, ...tools)', '첫 도형에서 나머지 도형을 깎아낸다.',
    ['base — 기준이 되는 도형', '...tools — 깎아낼 도형들'],
    'subtract(body, hole)'),
  entry('intersect', 'booleans', 'intersect(...geometries)', '도형들이 겹치는 부분만 남긴다.',
    ['...geometries — 겹칠 도형들'],
    'intersect(shapeA, shapeB)'),

  // 옮기고 돌리기
  entry('translate', 'transforms', 'translate([x, y, z], ...geometries)', '도형을 옮긴다.',
    ['[x, y, z] — 축별 이동 거리', '...geometries — 옮길 도형들'],
    'translate([0, 0, 10], shape)'),
  entry('translateZ', 'transforms', 'translateZ(offset, ...geometries)', '도형을 Z축으로만 옮긴다.',
    ['offset: 숫자 — 이동 거리', '...geometries — 옮길 도형들'],
    'translateZ(10, shape)'),
  entry('rotate', 'transforms', 'rotate([rx, ry, rz], ...geometries)', '도형을 돌린다. 각도는 라디안이라 degToRad를 함께 쓴다.',
    ['[rx, ry, rz] — 축별 회전 각도(라디안)', '...geometries — 돌릴 도형들'],
    'rotate([0, 0, degToRad(45)], shape)'),
  entry('rotateZ', 'transforms', 'rotateZ(angle, ...geometries)', 'Z축으로만 돌린다. 각도는 라디안이다.',
    ['angle: 숫자 — 회전 각도(라디안)', '...geometries — 돌릴 도형들'],
    'rotateZ(degToRad(45), shape)'),
  entry('scale', 'transforms', 'scale([x, y, z], ...geometries)', '도형 크기를 배율로 키우거나 줄인다.',
    ['[x, y, z] — 축별 배율, 1이 원래 크기', '...geometries — 크기를 바꿀 도형들'],
    'scale([2, 1, 1], shape)'),
  entry('mirrorX', 'transforms', 'mirrorX(...geometries)', 'YZ 평면 기준으로 좌우를 뒤집는다.',
    ['...geometries — 뒤집을 도형들'],
    'mirrorX(shape)'),
  entry('center', 'transforms', 'center({ axes, relativeTo }, ...geometries)', '도형을 원점 기준으로 가운데 정렬한다.',
    ['axes: [bool, bool, bool] — 정렬할 축 (기본 모두 true)', 'relativeTo: [x, y, z] — 기준 위치', '...geometries — 정렬할 도형들'],
    'center({ relativeTo: [0, 0, 0] }, shape)'),
  entry('align', 'transforms', 'align({ modes, relativeTo }, ...geometries)', '도형을 축마다 min·center·max로 맞춘다.',
    ["modes: ['center', 'center', 'min'] — 축별 정렬 방식", 'relativeTo: [x, y, z] — 기준 위치', '...geometries — 정렬할 도형들'],
    "align({ modes: ['center', 'center', 'min'] }, shape)"),

  // 2D를 3D로
  entry('extrudeLinear', 'extrusions', 'extrudeLinear({ height, twistAngle, twistSteps }, geometry)', '2D 도형을 위로 뽑아 3D로 만든다.',
    ['height: 숫자 — 뽑아 올릴 높이', 'twistAngle: 숫자 — 올라가며 비트는 각도(라디안)', 'twistSteps: 숫자 — 비틀림 단계 수', 'geometry — 2D 도형'],
    'extrudeLinear({ height: 10 }, circle({ radius: 8, segments: 48 }))'),
  entry('extrudeRotate', 'extrusions', 'extrudeRotate({ angle, segments }, geometry)', '2D 단면을 Z축으로 돌려 회전체를 만든다.',
    ['angle: 숫자 — 회전 각도(라디안), 생략하면 한 바퀴', 'segments: 숫자 — 분할 수', 'geometry — X > 0 영역에 놓인 2D 도형'],
    'extrudeRotate({ segments: 64 }, translate([10, 0], circle({ radius: 3, segments: 32 })))'),
  entry('project', 'extrusions', 'project({ axis, origin }, geometry)', '3D 도형을 평면에 눌러 2D 단면을 얻는다.',
    ['axis: [x, y, z] — 투영 평면의 법선 (기본 [0, 0, 1])', 'origin: [x, y, z] — 평면 위치', 'geometry — 3D 도형'],
    'project({ axis: [0, 0, 1] }, shape)'),

  // 다듬기
  entry('expand', 'expansions', 'expand({ delta, corners, segments }, geometry)', '도형을 바깥으로 부풀리거나 안으로 줄인다.',
    ['delta: 숫자 — 늘릴 두께, 음수면 줄어든다', "corners: 'round' | 'chamfer' | 'edge' — 모서리 처리", 'segments: 숫자 — 분할 수', 'geometry — 대상 도형'],
    "expand({ delta: 1, corners: 'round', segments: 24 }, shape)"),
  entry('offset', 'expansions', 'offset({ delta, corners, segments }, geometry)', '2D 도형의 외곽선을 안팎으로 밀어낸다.',
    ['delta: 숫자 — 밀어낼 거리, 음수면 안쪽', "corners: 'round' | 'chamfer' | 'edge' — 모서리 처리", 'segments: 숫자 — 분할 수', 'geometry — 2D 도형'],
    "offset({ delta: 2, corners: 'round' }, outline)"),
  entry('hull', 'hulls', 'hull(...geometries)', '도형들을 감싸는 가장 바깥 껍질을 만든다.',
    ['...geometries — 감쌀 도형들'],
    'hull(shapeA, shapeB)'),
  entry('hullChain', 'hulls', 'hullChain(...geometries)', '이웃한 도형끼리 차례로 이어 붙인다.',
    ['...geometries — 순서대로 이을 도형들 (3개 이상)'],
    'hullChain(a, b, c)'),

  // 색과 계산
  entry('colorize', 'colors', 'colorize([r, g, b, a], ...geometries)', '도형에 색을 입힌다.',
    ['[r, g, b, a] — 0~1 범위 색상값, a는 생략 가능', '...geometries — 색을 입힐 도형들'],
    'colorize([0.35, 0.76, 0.68, 1], shape)'),
  entry('hexToRgb', 'colors', 'hexToRgb(hex)', "'#ff8800' 같은 색 코드를 JSCAD 색상값으로 바꾼다.",
    ["hex: 문자열 — '#rrggbb' 형식"],
    "colorize(hexToRgb('#52cbb5'), shape)"),
  entry('degToRad', 'utils', 'degToRad(degrees)', '도(°)를 라디안으로 바꾼다. 회전 함수에 넣을 때 쓴다.',
    ['degrees: 숫자 — 각도(도)'],
    'degToRad(45)'),
  entry('measureBoundingBox', 'measurements', 'measureBoundingBox(geometry)', '도형을 감싸는 상자의 최소·최대 좌표를 잰다.',
    ['geometry — 잴 도형'],
    'measureBoundingBox(shape)'),
  entry('measureDimensions', 'measurements', 'measureDimensions(geometry)', '도형의 가로·세로·높이를 잰다.',
    ['geometry — 잴 도형'],
    'measureDimensions(shape)'),
]

export const API_BY_NAME = new Map(API.map((item) => [item.name, item]))

export interface TextChange { from: number; to: number; insert: string }

const requireLine = (module: JscadModule, names: string[]) =>
  `const { ${names.join(', ')} } = require('@jscad/modeling').${module}\n`

// 스니펫이 쓰는 함수가 아직 require 되어 있지 않으면 위쪽 구조 분해에 이름을 채워 넣는다.
// 해당 모듈 줄 자체가 없으면 파일 맨 위에 새 줄을 만든다.
export const planRequires = (doc: string, requires: PaletteItem['requires']): TextChange[] => {
  const changes: TextChange[] = []
  const fresh: string[] = []
  for (const need of requires) {
    const line = new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*require\\(\\s*['"]@jscad/modeling['"]\\s*\\)\\s*\\.\\s*${need.module}\\b`)
    const match = line.exec(doc)
    if (!match) {
      fresh.push(requireLine(need.module, need.names))
      continue
    }
    const current = match[1].split(',').map((name) => name.trim()).filter(Boolean)
    const missing = need.names.filter((name) => !current.includes(name))
    if (!missing.length) continue
    changes.push({
      from: match.index + match[0].indexOf('{') + 1,
      to: match.index + match[0].indexOf('}'),
      insert: ` ${[...current, ...missing].join(', ')} `,
    })
  }
  if (fresh.length) changes.push({ from: 0, to: 0, insert: fresh.join('') })
  return changes.sort((a, b) => a.from - b.from)
}

const item = (name: string, label: string): PaletteItem => {
  const found = API_BY_NAME.get(name)
  if (!found) throw new Error(`알 수 없는 API: ${name}`)
  return {
    id: name,
    label,
    signature: found.signature,
    summary: found.summary,
    code: found.snippet,
    requires: [{ module: found.module, names: requiredNames(found) }],
  }
}

// 스니펫 안에서 실제로 부르는 API 이름을 모은다 (rotate 예시의 degToRad 처럼 딸려 오는 것 포함)
const requiredNames = (found: ApiEntry) => {
  const names = new Set([found.name])
  for (const candidate of API) {
    if (candidate.module === found.module && new RegExp(`\\b${candidate.name}\\s*\\(`).test(found.snippet)) {
      names.add(candidate.name)
    }
  }
  return [...names]
}

const pattern = (
  id: string,
  label: string,
  summary: string,
  code: string,
  requires: { module: JscadModule; names: string[] }[],
): PaletteItem => ({ id, label, signature: '패턴', summary, code, requires })

export const PALETTE_GROUPS: SnippetGroup[] = [
  {
    id: 'solids',
    label: '3D 기본 도형',
    items: [
      item('cuboid', '직육면체'),
      item('roundedCuboid', '둥근 직육면체'),
      item('sphere', '구'),
      item('cylinder', '원기둥'),
      item('roundedCylinder', '둥근 원기둥'),
      item('cylinderElliptic', '원뿔'),
      item('torus', '도넛'),
      item('ellipsoid', '타원체'),
      item('geodesicSphere', '측지구'),
    ],
  },
  {
    id: 'shapes2d',
    label: '2D 도형',
    items: [
      item('rectangle', '사각형'),
      item('roundedRectangle', '둥근 사각형'),
      item('circle', '원'),
      item('ellipse', '타원'),
      item('polygon', '다각형'),
      item('star', '별'),
    ],
  },
  {
    id: 'booleans',
    label: '합치고 빼기',
    items: [item('union', '합치기'), item('subtract', '빼기'), item('intersect', '겹친 부분만')],
  },
  {
    id: 'transforms',
    label: '옮기고 돌리기',
    items: [
      item('translate', '옮기기'),
      item('translateZ', 'Z축으로 옮기기'),
      item('rotate', '돌리기'),
      item('rotateZ', 'Z축으로 돌리기'),
      item('scale', '크기 바꾸기'),
      item('mirrorX', '좌우 뒤집기'),
      item('center', '가운데 정렬'),
      item('align', '축 맞추기'),
    ],
  },
  {
    id: 'extrusions',
    label: '2D를 3D로',
    items: [item('extrudeLinear', '위로 뽑기'), item('extrudeRotate', '돌려 뽑기'), item('project', '평면에 투영')],
  },
  {
    id: 'finishing',
    label: '다듬기와 색',
    items: [
      item('expand', '부풀리기'),
      item('offset', '외곽선 밀기'),
      item('hull', '껍질 씌우기'),
      item('hullChain', '이어 붙이기'),
      item('colorize', '색 입히기'),
      item('hexToRgb', '색 코드 변환'),
      item('degToRad', '도를 라디안으로'),
      item('measureDimensions', '크기 재기'),
    ],
  },
  {
    id: 'patterns',
    label: '자주 쓰는 패턴',
    items: [
      pattern('skeleton', '기본 골격', '실행에 필요한 최소 구조. main 이 도형을 돌려주면 화면에 그려진다.',
        `const main = () => {
  const body = cuboid({ size: [20, 20, 10] })
  return body
}

module.exports = { main }`,
        [{ module: 'primitives', names: ['cuboid'] }]),
      pattern('hole', '구멍 뚫기', '판에 원기둥을 겹쳐 놓고 빼면 구멍이 된다. 뚫는 쪽을 더 길게 만드는 것이 요령이다.',
        `const plate = cuboid({ size: [40, 40, 6] })
const hole = cylinder({ radius: 4, height: 20, segments: 48 })
const result = subtract(plate, hole)`,
        [{ module: 'primitives', names: ['cuboid', 'cylinder'] }, { module: 'booleans', names: ['subtract'] }]),
      pattern('shell', '속 비우기', '큰 도형에서 조금 작은 도형을 빼면 벽 두께가 남는다.',
        `const wall = 1.6
const outer = roundedCuboid({ size: [30, 20, 12], roundRadius: 1.5, segments: 32 })
const inner = translate([0, 0, wall], roundedCuboid({
  size: [30 - wall * 2, 20 - wall * 2, 12], roundRadius: 1, segments: 32
}))
const shell = subtract(outer, inner)`,
        [{ module: 'primitives', names: ['roundedCuboid'] }, { module: 'transforms', names: ['translate'] }, { module: 'booleans', names: ['subtract'] }]),
      pattern('grid', '격자로 반복 배치', '같은 도형을 좌표만 바꿔 여러 개 만든다. 키보드 배열처럼 규칙적인 배치에 쓴다.',
        `const cols = 4
const rows = 3
const pitch = 19.05
const cells = []
for (let x = 0; x < cols; x++) {
  for (let y = 0; y < rows; y++) {
    cells.push(translate([x * pitch, y * pitch, 0], cuboid({ size: [14, 14, 4] })))
  }
}
const grid = union(...cells)`,
        [{ module: 'primitives', names: ['cuboid'] }, { module: 'transforms', names: ['translate'] }, { module: 'booleans', names: ['union'] }]),
    ],
  },
]
