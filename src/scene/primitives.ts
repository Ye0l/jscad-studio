// 시각 모드가 다루는 기본 도형. 한 곳에서 매개변수·상자·형상·코드를 모두 정의해
// Inspector, 배치 계산, JSCAD 실행, 코드 생성이 서로 어긋나지 않게 한다.
import type { Box, PrimitiveKind, Vec3 } from './types'

export interface ParamSpec {
  key: string
  label: string
  min?: number
  max?: number
  step: number
  integer?: boolean
  /** 크기에 직접 관여하는 값과 매끄러움 같은 부가 값을 나눠 보여 준다 */
  group: 'size' | 'detail'
}

export interface PrimitiveSpec {
  kind: PrimitiveKind
  label: string
  defaults: Record<string, number>
  params: ParamSpec[]
  /** 변환 전 로컬 상자 */
  box: (params: Record<string, number>) => Box
  /** JSCAD primitives 모듈에서 쓸 함수 이름 */
  fn: string
  /** JSCAD 호출 인자 객체 */
  args: (params: Record<string, number>) => Record<string, unknown>
}

const size = (key: string, label: string): ParamSpec => ({ key, label, min: 0.01, step: 1, group: 'size' })
const detail = (key: string, label: string, min: number): ParamSpec =>
  ({ key, label, min, step: 1, integer: true, group: 'detail' })

const halfBox = ([x, y, z]: Vec3): Box => ({ min: [-x / 2, -y / 2, -z / 2], max: [x / 2, y / 2, z / 2] })

export const PRIMITIVES: Record<PrimitiveKind, PrimitiveSpec> = {
  cuboid: {
    kind: 'cuboid',
    label: '상자',
    defaults: { width: 20, depth: 20, height: 10 },
    params: [size('width', '가로 X'), size('depth', '세로 Y'), size('height', '높이 Z')],
    box: (p) => halfBox([p.width, p.depth, p.height]),
    fn: 'cuboid',
    args: (p) => ({ size: [p.width, p.depth, p.height] }),
  },
  roundedCuboid: {
    kind: 'roundedCuboid',
    label: '둥근 상자',
    defaults: { width: 20, depth: 20, height: 10, roundRadius: 1.5, segments: 24 },
    params: [
      size('width', '가로 X'), size('depth', '세로 Y'), size('height', '높이 Z'),
      { key: 'roundRadius', label: '모서리 반지름', min: 0.01, step: 0.5, group: 'size' },
      detail('segments', '분할 수', 4),
    ],
    box: (p) => halfBox([p.width, p.depth, p.height]),
    fn: 'roundedCuboid',
    args: (p) => ({
      size: [p.width, p.depth, p.height],
      // 반지름이 가장 얇은 축의 절반을 넘으면 JSCAD 가 형상을 만들지 못한다
      roundRadius: Math.min(p.roundRadius, Math.min(p.width, p.depth, p.height) / 2 - 0.001),
      segments: p.segments,
    }),
  },
  cylinder: {
    kind: 'cylinder',
    label: '원기둥',
    defaults: { radius: 8, height: 16, segments: 48 },
    params: [size('radius', '반지름'), size('height', '높이 Z'), detail('segments', '분할 수', 3)],
    box: (p) => halfBox([p.radius * 2, p.radius * 2, p.height]),
    fn: 'cylinder',
    args: (p) => ({ radius: p.radius, height: p.height, segments: p.segments }),
  },
  sphere: {
    kind: 'sphere',
    label: '구',
    defaults: { radius: 10, segments: 48 },
    params: [size('radius', '반지름'), detail('segments', '분할 수', 4)],
    box: (p) => halfBox([p.radius * 2, p.radius * 2, p.radius * 2]),
    fn: 'sphere',
    args: (p) => ({ radius: p.radius, segments: p.segments }),
  },
}

export const PRIMITIVE_KINDS = Object.keys(PRIMITIVES) as PrimitiveKind[]

/** 저장본이 오래됐거나 값이 비어도 형상이 만들어지도록 기본값으로 메운다 */
export const withDefaults = (kind: PrimitiveKind, params: Record<string, number>) => {
  const spec = PRIMITIVES[kind]
  const merged: Record<string, number> = { ...spec.defaults }
  for (const [key, value] of Object.entries(params)) {
    if (Number.isFinite(value)) merged[key] = value
  }
  for (const param of spec.params) {
    if (param.min !== undefined && merged[param.key] < param.min) merged[param.key] = param.min
    if (param.integer) merged[param.key] = Math.round(merged[param.key])
  }
  return merged
}
