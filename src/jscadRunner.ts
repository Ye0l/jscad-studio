import * as modeling from '@jscad/modeling'
import type { RunResult } from './types'

const jscadModeling = ((modeling as unknown as { default?: typeof modeling }).default ?? modeling) as typeof modeling

const normalizeModuleSyntax = (code: string) => code
  .replace(/export\s+default\s+function\s+main/g, 'function main')
  .replace(/export\s+function\s+main/g, 'function main')
  .replace(/export\s*\{\s*main\s*\}\s*;?/g, '')

export const runJscad = async (source: string): Promise<RunResult> => {
  const started = performance.now()
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

  const result = await Promise.resolve(main({}))
  const geometries = (Array.isArray(result) ? result.flat(Infinity) : [result]).filter(Boolean)
  if (!geometries.length) throw new Error('main 함수가 표시할 geometry를 반환하지 않았습니다.')

  return { geometries, durationMs: performance.now() - started }
}
