// Scene → 사람이 읽을 수 있는 JSCAD 코드.
// 만들어진 코드는 앱 밖의 JSCAD 에서도 그대로 돌아가야 하므로 표준 모듈 문법만 쓴다.
import { PRIMITIVES } from './primitives'
import { round } from './mat'
import type { Layout, Scene, SceneNode, Vec3 } from './types'
import { hexToRgb } from './build'

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'let', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'main', 'module', 'exports', 'require', 'deg',
])

const number = (value: number) => String(round(value, 4))
const vec = (value: Vec3) => `[${value.map(number).join(', ')}]`
const isZero = (value: Vec3) => value.every((item) => Math.abs(item) < 1e-9)
const isOne = (value: Vec3) => value.every((item) => Math.abs(item - 1) < 1e-9)

/** 이름에서 쓸 수 있는 글자만 골라 변수 이름을 만든다. 한글 이름이면 part1 처럼 붙인다 */
const identifierOf = (name: string, used: Set<string>) => {
  const words = name.replace(/[^A-Za-z0-9 _-]/g, ' ').split(/[\s_-]+/).filter(Boolean)
  let base = words
    .map((word, index) => (index === 0 ? word[0].toLowerCase() + word.slice(1) : word[0].toUpperCase() + word.slice(1)))
    .join('')
  if (!base || /^[0-9]/.test(base) || RESERVED.has(base)) base = base ? `part${base[0].toUpperCase()}${base.slice(1)}` : 'part'
  let candidate = base
  let index = 2
  while (used.has(candidate)) {
    candidate = `${base}${index}`
    index += 1
  }
  used.add(candidate)
  return candidate
}

const args = (values: Record<string, unknown>) => {
  const parts = Object.entries(values).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: [${value.map((item) => number(Number(item))).join(', ')}]`
    return `${key}: ${typeof value === 'number' ? number(value) : JSON.stringify(value)}`
  })
  return `{ ${parts.join(', ')} }`
}

const indent = (text: string, depth: number) =>
  text.split('\n').map((line) => (line ? `${'  '.repeat(depth)}${line}` : line)).join('\n')

interface Used {
  primitives: Set<string>
  booleans: Set<string>
  transforms: Set<string>
  colors: boolean
  degrees: boolean
}

/** 배치 결과에서 이 객체가 부모 안에서 실제로 놓인 위치를 뽑아 낸다 (anchor·적층도 숫자로 굳는다) */
const solvedPosition = (scene: Scene, layout: Layout, node: SceneNode): Vec3 => {
  const own = layout[node.id]?.matrix
  if (!own) return node.transform.position
  const parent = node.parent ? layout[node.parent]?.matrix : null
  const delta: Vec3 = [
    own[12] - (parent?.[12] ?? 0),
    own[13] - (parent?.[13] ?? 0),
    own[14] - (parent?.[14] ?? 0),
  ]
  if (!parent) return delta
  // 부모의 회전·확대를 되돌려 부모 좌표계 값으로 적는다
  const [a, b, c, , d, e, f, , g, h, i] = parent
  const determinant = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e)
  if (!determinant) return delta
  const inv = 1 / determinant
  return [
    ((e * i - f * h) * delta[0] + (g * f - d * i) * delta[1] + (d * h - g * e) * delta[2]) * inv,
    ((h * c - b * i) * delta[0] + (a * i - g * c) * delta[1] + (g * b - a * h) * delta[2]) * inv,
    ((b * f - e * c) * delta[0] + (d * c - a * f) * delta[1] + (a * e - d * b) * delta[2]) * inv,
  ]
}

export const sceneToCode = (scene: Scene, layout: Layout): string => {
  const used: Used = {
    primitives: new Set(), booleans: new Set(), transforms: new Set(), colors: false, degrees: false,
  }
  const names = new Set<string>()
  const lines: string[] = []
  const roots: string[] = []

  const wrap = (node: SceneNode, expression: string, list: boolean): string => {
    let out = expression
    const { rotation, scale } = node.transform
    const position = solvedPosition(scene, layout, node)
    if (!isOne(scale)) {
      used.transforms.add('scale')
      out = `scale(${vec(scale)}, ${out})`
    }
    if (!isZero(rotation)) {
      used.transforms.add('rotate')
      used.degrees = true
      out = `rotate([${rotation.map((value) => `deg(${number(value)})`).join(', ')}], ${out})`
    }
    if (!isZero(position)) {
      used.transforms.add('translate')
      out = `translate(${vec(position)}, ${out})`
    }
    const rgb = node.color ? hexToRgb(node.color) : null
    if (rgb) {
      used.colors = true
      out = `colorize([${rgb.map((value) => number(value)).join(', ')}], ${out})`
    }
    // JSCAD 변환 함수는 배열을 받으면 배열을 돌려주므로 목록도 그대로 감쌀 수 있다
    void list
    return out
  }

  /** 객체 하나를 식으로 만든다. list 가 true 면 여러 형상의 배열이다 */
  const emit = (id: string): { expression: string; list: boolean } | null => {
    const node = scene.nodes[id]
    if (!node || !node.visible) return null

    if (node.type === 'primitive') {
      const spec = PRIMITIVES[node.primitive]
      used.primitives.add(spec.fn)
      return { expression: wrap(node, `${spec.fn}(${args(spec.args(node.params))})`, false), list: false }
    }

    if (node.type === 'code') {
      // 직접 쓴 코드는 그대로 두고 감싸기만 한다 (module.exports 를 건드리지 않도록 지역 변수로 가린다)
      const body = [
        'const module = { exports: {} }',
        'const exports = module.exports',
        node.code.trim(),
        'const build = typeof main === \'function\' ? main : module.exports.main',
        'return build ? build({}) : []',
      ].join('\n')
      return { expression: wrap(node, `(() => {\n${indent(body, 1)}\n})()`, true), list: true }
    }

    const parts = node.children.map(emit).filter(Boolean) as { expression: string; list: boolean }[]
    if (!parts.length) return null

    if (node.type === 'boolean') {
      if (parts.length === 1) return { expression: wrap(node, parts[0].expression, parts[0].list), list: parts[0].list }
      used.booleans.add(node.op)
      const operands = parts.map((part) => (part.list ? unionOf(part.expression, used) : part.expression))
      const inner = `${node.op}(\n${indent(operands.join(',\n'), 1)},\n)`
      return { expression: wrap(node, inner, false), list: false }
    }

    if (parts.length === 1 && !parts[0].list) {
      return { expression: wrap(node, parts[0].expression, false), list: false }
    }
    const items = parts.map((part) => part.expression).join(',\n')
    return { expression: wrap(node, `[\n${indent(items, 1)},\n].flat()`, true), list: true }
  }

  for (const id of scene.rootIds) {
    const node = scene.nodes[id]
    const result = emit(id)
    if (!node || !result) continue
    const name = identifierOf(node.name, names)
    lines.push(`  // ${node.name}`)
    lines.push(`  const ${name} = ${indent(result.expression, 1).trimStart()}`)
    lines.push('')
    roots.push(name)
  }

  const header: string[] = ['// JSCAD Studio 시각 편집기가 만든 코드입니다.']
  header.push('// 객체 트리·Inspector 에서 바꾸면 이 코드가 다시 만들어집니다.')
  if (used.primitives.size) header.push(`const { ${[...used.primitives].sort().join(', ')} } = require('@jscad/modeling').primitives`)
  if (used.booleans.size) header.push(`const { ${[...used.booleans].sort().join(', ')} } = require('@jscad/modeling').booleans`)
  if (used.transforms.size) header.push(`const { ${[...used.transforms].sort().join(', ')} } = require('@jscad/modeling').transforms`)
  if (used.colors) header.push('const { colorize } = require(\'@jscad/modeling\').colors')
  if (used.degrees) {
    header.push('')
    header.push('// 회전값은 보기 쉽게 도 단위로 적었습니다')
    header.push('const deg = (value) => (value * Math.PI) / 180')
  }

  const body = lines.length ? lines.join('\n') : '  // 아직 객체가 없습니다. 객체 트리에서 도형을 추가하세요.\n'
  return [
    header.join('\n'),
    '',
    'const main = () => {',
    body.replace(/\n+$/, ''),
    '',
    `  return [${roots.join(', ')}].flat()`,
    '}',
    '',
    'module.exports = { main }',
    '',
  ].join('\n')
}

/**
 * 시각 모드를 끌 때, 숨겨 둔 코드 객체의 원본을 잃지 않도록 주석으로 남긴다.
 * (숨긴 객체는 생성 코드에 들어가지 않는다)
 */
export const hiddenCodeNotes = (scene: Scene): string => {
  const hidden = Object.values(scene.nodes).filter((node) => node.type === 'code' && !node.visible)
  if (!hidden.length) return ''
  const blocks = hidden.map((node) => {
    const body = (node as { code: string }).code.replace(/\*\//g, '*\\/')
    return `/* 꺼 둔 코드 객체 "${node.name}" 의 원본입니다. 필요하면 이 주석을 풀어 쓰세요.\n${body}\n*/`
  })
  return `\n\n${blocks.join('\n\n')}\n`
}

const unionOf = (expression: string, used: Used) => {
  used.booleans.add('union')
  return `union(${expression})`
}
