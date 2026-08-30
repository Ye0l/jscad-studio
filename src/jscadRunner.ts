import * as modeling from '@jscad/modeling'
import type { RunResult } from './types'

const jscadModeling = ((modeling as unknown as { default?: typeof modeling }).default ?? modeling) as typeof modeling

const normalizeModuleSyntax = (code: string) => code
  .replace(/export\s+default\s+function\s+main/g, 'function main')
  .replace(/export\s+function\s+main/g, 'function main')
  .replace(/export\s*\{\s*main\s*\}\s*;?/g, '')

/** 코드에서 main 함수를 꺼낸다. 시각 모드의 코드 객체도 같은 규칙을 쓴다 */
export const compileMain = (source: string): ((params?: Record<string, unknown>) => unknown) => {
  const module = { exports: {} as Record<string, unknown> }
  const localRequire = (name: string) => {
    if (name === '@jscad/modeling' || name === 'jscad') return jscadModeling
    throw new Error(`지원하지 않는 모듈입니다: ${name}`)
  }

  const factory = new Function(
    'require',
    'module',
    'exports',
    'modeling',
    `"use strict";\n${normalizeModuleSyntax(source)}\n` +
      `return typeof main === "function" ? main : ` +
      `(module.exports && typeof module.exports.main === "function" ? module.exports.main : null);`,
  )

  const main = factory(localRequire, module, module.exports, jscadModeling) as ((params?: Record<string, unknown>) => unknown) | null
  if (!main) throw new Error('main 함수를 찾을 수 없습니다. module.exports = { main }을 확인하세요.')
  return main
}

export const toGeometries = (result: unknown): unknown[] =>
  (Array.isArray(result) ? result.flat(Infinity) : [result]).filter(Boolean)

export const runJscad = async (source: string): Promise<RunResult> => {
  const started = performance.now()
  const result = await Promise.resolve(compileMain(source)({}))
  const geometries = toGeometries(result)
  if (!geometries.length) throw new Error('main 함수가 표시할 geometry를 반환하지 않았습니다.')
  return { geometries, durationMs: performance.now() - started }
}

/** 시각 모드는 배치 계산과 같은 흐름에서 형상을 만들어야 해서 동기 실행이 필요하다 */
export const runJscadSync = (source: string): unknown[] => {
  const result = compileMain(source)({})
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    throw new Error('코드 객체에서는 비동기 main 을 쓸 수 없습니다.')
  }
  return toGeometries(result)
}
