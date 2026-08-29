// 프로젝트 파일은 지금까지처럼 .jscad 텍스트 하나다.
// 시각 모드 정보는 파일 끝 주석 블록에 담아, 앱 밖의 JSCAD 나 GitHub 동기화가 그대로 동작하게 한다.
import { sanitizeScene } from './model'
import type { Scene } from './types'

const OPEN = '/* jscad-studio:scene v1'
const CLOSE = '*/'
const NOTE = '앱이 관리하는 블록입니다. 시각 편집기를 쓰지 않는다면 지워도 됩니다.'

export interface ProjectDocument {
  /** JSCAD 로 실행할 코드 */
  code: string
  /** 시각 모드 정보. 없으면 코드 전용 프로젝트 */
  scene: Scene | null
}

// 주석 블록을 일찍 닫아 버리지 않도록 JSON 안의 별-슬래시를 이스케이프한다 (JSON.parse 가 되돌린다)
const escapeBlock = (json: string) => json.replace(/\*\//g, '*\\/')

export const splitDocument = (text: string): ProjectDocument => {
  const start = text.lastIndexOf(OPEN)
  if (start < 0) return { code: text, scene: null }
  const end = text.indexOf(CLOSE, start)
  if (end < 0) return { code: text, scene: null }
  const block = text.slice(start + OPEN.length, end)
  const brace = block.indexOf('{')
  const code = (text.slice(0, start) + text.slice(end + CLOSE.length)).replace(/\s+$/, '') + '\n'
  if (brace < 0) return { code, scene: null }
  try {
    return { code, scene: sanitizeScene(JSON.parse(block.slice(brace))) }
  } catch {
    return { code, scene: null }
  }
}

export const composeDocument = (code: string, scene: Scene | null): string => {
  const body = code.replace(/\s+$/, '')
  if (!scene) return `${body}\n`
  const json = escapeBlock(JSON.stringify(scene))
  return `${body}\n\n${OPEN} — ${NOTE}\n${json}\n${CLOSE}\n`
}

export const hasScene = (text: string) => text.includes(OPEN)
