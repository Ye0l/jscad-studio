import * as modeling from '@jscad/modeling'
import { emptyScene, type Scene } from '../src/scene/types'
import { addNode, makeBoolean, makeGroup, makePrimitive, makeStack, setGap, setTransform, patchNode } from '../src/scene/model'
import { evaluateScene } from '../src/scene/evaluate'
import { compileMain, toGeometries } from '../src/jscadRunner'

let failures = 0

const jscad: any = (modeling as any).default ?? modeling

const bbox = (geoms: unknown[]) => {
  const [min, max] = jscad.measurements.measureAggregateBoundingBox(...geoms)
  return [min.map((v: number) => +v.toFixed(4)), max.map((v: number) => +v.toFixed(4))]
}

const roundBox = (box: any) => (box ? {
  min: box.min.map((v: number) => +v.toFixed(6)),
  max: box.max.map((v: number) => +v.toFixed(6)),
} : null)

const check = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) failures += 1
  console.log(a === b ? `ok   ${label}` : `FAIL ${label}\n  got      ${a}\n  expected ${b}`)
}

// --- 1. 기본 배치: 상자 하나 위치 이동 ---
let scene: Scene = emptyScene()
const box = makePrimitive(scene, 'cuboid', { width: 20, depth: 10, height: 4 })
scene = addNode(scene, box)
scene = setTransform(scene, box.id, { position: [5, 0, 2] })
let evalResult = evaluateScene(scene)
check('cuboid bounds', evalResult.layout[box.id].bounds, { min: [-5, -5, 0], max: [15, 5, 4] })
check('cuboid geometry bounds', bbox(evalResult.geometries), [[-5, -5, 0], [15, 5, 4]])

// 생성 코드가 같은 형상을 만드는가
let fromCode = toGeometries(compileMain(evalResult.code)({}))
check('codegen matches', bbox(fromCode), bbox(evalResult.geometries))

// --- 2. 회전 ---
scene = setTransform(scene, box.id, { position: [0, 0, 0], rotation: [0, 0, 90] })
evalResult = evaluateScene(scene)
check('rotated bounds', roundBox(evalResult.layout[box.id].bounds), { min: [-5, -10, -2], max: [5, 10, 2] })
fromCode = toGeometries(compileMain(evalResult.code)({}))
check('codegen rotation matches', bbox(fromCode), bbox(evalResult.geometries))

// --- 3. 그룹 안 상대 좌표 ---
scene = emptyScene()
const group = makeGroup(scene, 'Keyboard')
scene = addNode(scene, group)
scene = setTransform(scene, group.id, { position: [100, 0, 0] })
const child = makePrimitive(scene, 'cuboid', { width: 10, depth: 10, height: 10 })
scene = addNode(scene, child, group.id)
scene = setTransform(scene, child.id, { position: [0, 0, 5] })
evalResult = evaluateScene(scene)
check('nested world bounds', evalResult.layout[child.id].bounds, { min: [95, -5, 0], max: [105, 5, 10] })
fromCode = toGeometries(compileMain(evalResult.code)({}))
check('codegen nested matches', bbox(fromCode), bbox(evalResult.geometries))

// 회전한 그룹 안의 자식
scene = setTransform(scene, group.id, { rotation: [0, 0, 90] })
evalResult = evaluateScene(scene)
fromCode = toGeometries(compileMain(evalResult.code)({}))
check('codegen rotated group matches', bbox(fromCode), bbox(evalResult.geometries))
// 회전은 그 객체 자신의 원점을 중심으로 돈다 (위치는 회전 뒤에 적용)
check('rotated group child bounds', roundBox(evalResult.layout[child.id].bounds), { min: [95, -5, 0], max: [105, 5, 10] })

// --- 4. 적층 ---
scene = emptyScene()
const stack = makeStack(scene, '케이스')
scene = addNode(scene, stack)
const bottom = makePrimitive(scene, 'cuboid', { width: 50, depth: 30, height: 3 })
const spacer = makePrimitive(scene, 'cuboid', { width: 50, depth: 30, height: 8 })
const top = makePrimitive(scene, 'cuboid', { width: 50, depth: 30, height: 1.5 })
scene = addNode(scene, bottom, stack.id)
scene = addNode(scene, spacer, stack.id)
scene = addNode(scene, top, stack.id)
scene = setGap(scene, stack.id, top.id, 2)
evalResult = evaluateScene(scene)
check('stack z1', evalResult.layout[bottom.id].bounds!.min[2], 0)
check('stack z2', evalResult.layout[spacer.id].bounds!.min[2], 3)
check('stack z3', evalResult.layout[top.id].bounds!.min[2], 13)
check('stack total height', evalResult.layout[stack.id].bounds!.max[2], 14.5)
fromCode = toGeometries(compileMain(evalResult.code)({}))
check('codegen stack matches', bbox(fromCode), bbox(evalResult.geometries))

// 층을 숨기면 그 위가 내려온다
scene = patchNode(scene, spacer.id, { visible: false })
evalResult = evaluateScene(scene)
check('stack hidden layer', evalResult.layout[top.id].bounds!.min[2], 5)
scene = patchNode(scene, spacer.id, { visible: true })

// --- 5. 불리언 ---
scene = emptyScene()
const cut = makeBoolean(scene, 'subtract', 'Case')
scene = addNode(scene, cut)
const body = makePrimitive(scene, 'cuboid', { width: 40, depth: 40, height: 12 })
const hole = makePrimitive(scene, 'cylinder', { radius: 6, height: 20, segments: 32 })
scene = addNode(scene, body, cut.id)
scene = addNode(scene, hole, cut.id)
evalResult = evaluateScene(scene)
check('subtract bounds', evalResult.layout[cut.id].bounds, { min: [-20, -20, -6], max: [20, 20, 6] })
check('subtract errors', evalResult.errors.length, 0)
fromCode = toGeometries(compileMain(evalResult.code)({}))
check('codegen subtract matches', bbox(fromCode), bbox(evalResult.geometries))

// --- 6. anchor ---
scene = emptyScene()
const caseBody = makePrimitive(scene, 'cuboid', { width: 100, depth: 40, height: 20 })
scene = addNode(scene, caseBody)
const usb = makePrimitive(scene, 'cuboid', { width: 9, depth: 4, height: 3 })
scene = addNode(scene, usb)
scene = patchNode(scene, usb.id, {
  anchor: {
    target: caseBody.id,
    axes: { x: { target: 'max', self: 'center' }, y: null, z: { target: 'max', self: 'min' } },
    offset: [-12, 0, 0],
  },
})
evalResult = evaluateScene(scene)
check('anchor x center', evalResult.layout[usb.id].bounds!.min[0] + 4.5, 38)
check('anchor z on top', evalResult.layout[usb.id].bounds!.min[2], 10)
fromCode = toGeometries(compileMain(evalResult.code)({}))
check('codegen anchor matches', bbox(fromCode), bbox(evalResult.geometries))

// 기준 객체가 커지면 따라 움직인다
scene = patchNode(scene, caseBody.id, { params: { width: 200, depth: 40, height: 20 } } as never)
evalResult = evaluateScene(scene)
check('anchor follows resize', evalResult.layout[usb.id].bounds!.min[0] + 4.5, 88)

// 사슬 anchor
const knob = makePrimitive(scene, 'cylinder', { radius: 5, height: 6, segments: 16 })
scene = addNode(scene, knob)
scene = patchNode(scene, knob.id, {
  anchor: { target: usb.id, axes: { x: { target: 'center', self: 'center' }, y: null, z: { target: 'max', self: 'min' } }, offset: [0, 0, 1] },
})
evalResult = evaluateScene(scene)
check('chained anchor x', evalResult.layout[knob.id].bounds!.min[0] + 5, 88)
check('chained anchor z', evalResult.layout[knob.id].bounds!.min[2], 14)

console.log('\n--- generated code sample ---\n')
console.log(evalResult.code)

if (failures) {
  console.error(`\n${failures}개 검사가 실패했습니다.`)
  process.exit(1)
}
console.log('\n모든 검사를 통과했습니다.')
