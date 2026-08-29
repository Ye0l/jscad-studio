// 시각 모드 한 번 계산하기: 코드 객체 실행 → 배치 → 형상 → 코드 생성.
// 앱은 이 함수 하나만 부르면 되고, 나온 layout 을 Inspector·기즈모가 함께 쓴다.
import { runJscadSync } from '../jscadRunner'
import { buildScene, measureLocalBounds, type BuildError, type BuildItem } from './build'
import { sceneToCode } from './codegen'
import { solveScene } from './layout'
import type { Box, Layout, Scene } from './types'

export interface SceneEvaluation {
  layout: Layout
  items: BuildItem[]
  geometries: unknown[]
  errors: BuildError[]
  code: string
  durationMs: number
  /** 코드 객체의 로컬 상자. 배치만 다시 풀 때 그대로 재사용한다 */
  localBounds: Record<string, Box | null>
}

export const evaluateScene = (scene: Scene): SceneEvaluation => {
  const started = performance.now()
  const errors: BuildError[] = []
  const codeGeometries: Record<string, unknown[]> = {}
  const localBounds: Record<string, Box | null> = {}

  for (const node of Object.values(scene.nodes)) {
    if (node.type !== 'code') continue
    try {
      const parts = runJscadSync(node.code)
      codeGeometries[node.id] = parts
      localBounds[node.id] = measureLocalBounds(parts)
    } catch (error) {
      codeGeometries[node.id] = []
      localBounds[node.id] = null
      errors.push({ id: node.id, name: node.name, message: error instanceof Error ? error.message : String(error) })
    }
  }

  const layout = solveScene(scene, localBounds)
  const built = buildScene(scene, layout, { codeGeometries })
  return {
    layout,
    items: built.items,
    geometries: built.items.map((item) => item.geometry),
    errors: [...errors, ...built.errors],
    code: sceneToCode(scene, layout),
    durationMs: performance.now() - started,
    localBounds,
  }
}

/** 형상은 만들지 않고 배치만 다시 푼다 (드래그 중 미리보기, Inspector 표시용) */
export const previewLayout = (scene: Scene, localBounds?: Record<string, Box | null>): Layout =>
  solveScene(scene, localBounds)
