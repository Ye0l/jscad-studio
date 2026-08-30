// 객체를 코드 객체로 바꾸는 변환.
// 코드 생성기가 이미 장면을 읽을 수 있는 JSCAD 로 옮겨 주므로, 그 결과를 코드 객체에 담기만 하면 된다.
import { sceneToCode } from './codegen'
import { solveScene } from './layout'
import { addNode, defaultTransform, descendantsOf, makeCodeNode, patchNode, removeNode } from './model'
import type { Scene, SceneNode } from './types'

export interface ConvertResult {
  scene: Scene
  /** 새로 만들어진 코드 객체. 바꿀 수 없는 대상이면 null */
  id: string | null
  /** 코드에 담기지 못한 숨긴 하위 객체 수 */
  hiddenSkipped: number
}

/**
 * 객체 하나(와 그 아래 전부)를 같은 형상을 만드는 코드 객체로 바꾼다.
 * 자기 변환·색·상대 배치는 코드에 넣지 않고 새 코드 객체가 그대로 물려받는다.
 */
export const toCodeNode = (scene: Scene, id: string): ConvertResult => {
  const node = scene.nodes[id]
  if (!node || node.type === 'code') return { scene, id: null, hiddenSkipped: 0 }

  const family = [id, ...descendantsOf(scene, id)]
  const nodes: Record<string, SceneNode> = {}
  for (const key of family) nodes[key] = structuredClone(scene.nodes[key])
  const root = nodes[id]
  root.transform = defaultTransform()
  root.parent = null
  root.anchor = null
  root.visible = true
  root.color = null

  const sub: Scene = { version: 1, nodes, rootIds: [id], workplane: { ...scene.workplane } }
  const code = sceneToCode(sub, solveScene(sub))
  const hiddenSkipped = family.filter((key) => key !== id && !scene.nodes[key].visible).length

  const created = makeCodeNode(scene, code, `${node.name} 코드`)
  created.transform = structuredClone(node.transform)
  created.color = node.color
  created.anchor = node.anchor ? structuredClone(node.anchor) : null
  created.visible = node.visible

  const parentId = node.parent ?? null
  const siblings = parentId ? scene.nodes[parentId].children : scene.rootIds
  let next = addNode(scene, created, parentId, siblings.indexOf(id))

  // 이 객체를 기준으로 삼던 배치는 새 코드 객체를 가리키게 옮긴다 (안 그러면 지울 때 함께 끊긴다)
  for (const other of Object.values(next.nodes)) {
    if (other.anchor?.target === id) {
      next = patchNode(next, other.id, { anchor: { ...other.anchor, target: created.id } })
    }
  }

  next = removeNode(next, id)
  // 원본이 사라진 뒤라야 같은 이름을 그대로 쓸 수 있다
  return { scene: patchNode(next, created.id, { name: node.name }), id: created.id, hiddenSkipped }
}
