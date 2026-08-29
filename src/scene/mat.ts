// 배치 계산에 필요한 만큼의 행렬·상자 계산.
// JSCAD 에도 같은 함수가 있지만, 배치 계산은 형상 없이 매 프레임 돌아야 해서 따로 둔다.
import type { Box, Mat4, Vec3 } from './types'

export const DEG = Math.PI / 180

export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** a 를 적용한 뒤 b 를 적용하는 행렬 (= b · a) */
export const multiply = (b: Mat4, a: Mat4): Mat4 => {
  const out = new Array<number>(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0
      for (let k = 0; k < 4; k += 1) sum += b[k * 4 + row] * a[column * 4 + k]
      out[column * 4 + row] = sum
    }
  }
  return out
}

export const fromTranslation = ([x, y, z]: Vec3): Mat4 =>
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]

export const fromScaling = ([x, y, z]: Vec3): Mat4 =>
  [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]

/** JSCAD transforms.rotate 와 같은 순서(X → Y → Z, 도 단위) */
export const fromRotation = ([rx, ry, rz]: Vec3): Mat4 => {
  const [sx, cx] = [Math.sin(rx * DEG), Math.cos(rx * DEG)]
  const [sy, cy] = [Math.sin(ry * DEG), Math.cos(ry * DEG)]
  const [sz, cz] = [Math.sin(rz * DEG), Math.cos(rz * DEG)]
  // Rz · Ry · Rx 를 직접 펼친 것
  return [
    cy * cz, cy * sz, -sy, 0,
    sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, 0,
    cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy, 0,
    0, 0, 0, 1,
  ]
}

export const transformPoint = (matrix: Mat4, [x, y, z]: Vec3): Vec3 => [
  matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
  matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
  matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
]

/** 회전·확대만 적용한다 (평행이동 제외) */
export const transformDirection = (matrix: Mat4, [x, y, z]: Vec3): Vec3 => [
  matrix[0] * x + matrix[4] * y + matrix[8] * z,
  matrix[1] * x + matrix[5] * y + matrix[9] * z,
  matrix[2] * x + matrix[6] * y + matrix[10] * z,
]

export const translateMatrix = (matrix: Mat4, [x, y, z]: Vec3): Mat4 => {
  const out = [...matrix]
  out[12] += x
  out[13] += y
  out[14] += z
  return out
}

export const boxOf = (points: Vec3[]): Box | null => {
  if (!points.length) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < min[axis]) min[axis] = point[axis]
      if (point[axis] > max[axis]) max[axis] = point[axis]
    }
  }
  return { min, max }
}

export const cornersOf = ({ min, max }: Box): Vec3[] => [
  [min[0], min[1], min[2]], [max[0], min[1], min[2]], [min[0], max[1], min[2]], [max[0], max[1], min[2]],
  [min[0], min[1], max[2]], [max[0], min[1], max[2]], [min[0], max[1], max[2]], [max[0], max[1], max[2]],
]

/** 상자를 행렬로 옮긴 뒤 다시 축 정렬 상자로 감싼다 */
export const transformBox = (matrix: Mat4, box: Box | null): Box | null =>
  (box ? boxOf(cornersOf(box).map((point) => transformPoint(matrix, point))) : null)

export const translateBox = (box: Box | null, [x, y, z]: Vec3): Box | null => (box ? {
  min: [box.min[0] + x, box.min[1] + y, box.min[2] + z],
  max: [box.max[0] + x, box.max[1] + y, box.max[2] + z],
} : null)

export const mergeBoxes = (boxes: (Box | null)[]): Box | null => {
  const points: Vec3[] = []
  for (const box of boxes) {
    if (box) points.push(box.min, box.max)
  }
  return boxOf(points)
}

export const intersectBoxes = (boxes: (Box | null)[]): Box | null => {
  const list = boxes.filter(Boolean) as Box[]
  if (!list.length) return null
  const min: Vec3 = [-Infinity, -Infinity, -Infinity]
  const max: Vec3 = [Infinity, Infinity, Infinity]
  for (const box of list) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.max(min[axis], box.min[axis])
      max[axis] = Math.min(max[axis], box.max[axis])
    }
  }
  return min.every((value, axis) => value <= max[axis]) ? { min, max } : null
}

export const boxSize = (box: Box | null): Vec3 =>
  (box ? [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]] : [0, 0, 0])

export const boxCenter = (box: Box | null): Vec3 =>
  (box ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2] : [0, 0, 0])

/** 화면에 보여 줄 때 -0 과 부동소수 찌꺼기를 없앤다 */
export const round = (value: number, digits = 3) => {
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}
