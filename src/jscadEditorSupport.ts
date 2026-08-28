import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { javascriptLanguage } from '@codemirror/lang-javascript'
import { syntaxTree } from '@codemirror/language'
import { ChangeSet, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, hoverTooltip, showTooltip, type Tooltip } from '@codemirror/view'
import { API, API_BY_NAME, planRequires, type ApiEntry, type PaletteItem } from './jscadApi'

export interface InsertableSnippet {
  code: string
  requires: PaletteItem['requires']
}

const docNode = (api: ApiEntry) => {
  const root = document.createElement('div')
  root.className = 'jscad-doc'

  const signature = document.createElement('code')
  signature.textContent = api.signature
  const summary = document.createElement('p')
  summary.textContent = api.summary
  root.append(signature, summary)

  if (api.params.length) {
    const list = document.createElement('ul')
    for (const param of api.params) {
      const row = document.createElement('li')
      row.textContent = param
      list.append(row)
    }
    root.append(list)
  }

  const origin = document.createElement('small')
  origin.textContent = `@jscad/modeling.${api.module}`
  root.append(origin)
  return root
}

/** 스니펫을 넣고, 필요한 require 를 같은 트랜잭션에서 함께 채운다. */
export const applySnippet = (view: EditorView, snippet: InsertableSnippet, target?: { from: number; to: number }) => {
  const from = target?.from ?? view.state.selection.main.from
  const to = target?.to ?? view.state.selection.main.to
  const indent = /^[\t ]*/.exec(view.state.doc.lineAt(from).text)?.[0] ?? ''
  const text = indent ? snippet.code.split('\n').join(`\n${indent}`) : snippet.code
  const changes = [...planRequires(view.state.doc.toString(), snippet.requires), { from, to, insert: text }]
  const set = ChangeSet.of(changes, view.state.doc.length)
  view.dispatch({ changes: set, selection: { anchor: set.mapPos(to, 1) }, scrollIntoView: true })
  view.focus()
}

const completionSource = (context: CompletionContext): CompletionResult | null => {
  const word = context.matchBefore(/[\w$]+/)
  if (!word || (word.from === word.to && !context.explicit)) return null
  return {
    from: word.from,
    options: API.map((api) => ({
      label: api.name,
      type: 'function',
      detail: api.module,
      info: () => docNode(api),
      apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
        // 이미 괄호를 열어 둔 자리라면 이름만 채운다
        const opened = view.state.sliceDoc(to, to + 1) === '('
        applySnippet(view, {
          code: opened ? api.name : api.snippet,
          requires: [{ module: api.module, names: [api.name] }],
        }, { from, to })
      },
    })),
  }
}

const wordAt = (state: EditorState, pos: number) => {
  const line = state.doc.lineAt(pos)
  const offset = pos - line.from
  let start = offset
  let end = offset
  while (start > 0 && /[\w$]/.test(line.text[start - 1])) start -= 1
  while (end < line.text.length && /[\w$]/.test(line.text[end])) end += 1
  if (start === end) return null
  return { name: line.text.slice(start, end), from: line.from + start, to: line.from + end }
}

const hover = hoverTooltip((view, pos) => {
  const word = wordAt(view.state, pos)
  const api = word && API_BY_NAME.get(word.name)
  if (!word || !api) return null
  return { pos: word.from, end: word.to, above: true, create: () => ({ dom: docNode(api) }) }
})

// 커서가 아는 함수의 괄호 안에 있으면 매개변수 설명을 띄운다
const signatureAt = (state: EditorState): readonly Tooltip[] => {
  const cursor = state.selection.main
  if (!cursor.empty) return []
  let node = syntaxTree(state).resolveInner(cursor.head, -1) as { name: string; from: number; to: number; firstChild: typeof node; parent: typeof node } | null
  while (node) {
    if (node.name === 'CallExpression' && node.firstChild) {
      const callee = node.firstChild
      const api = callee.name === 'VariableName' ? API_BY_NAME.get(state.sliceDoc(callee.from, callee.to)) : undefined
      if (api && cursor.head > callee.to && cursor.head <= node.to) {
        return [{ pos: callee.from, above: true, arrow: true, create: () => ({ dom: docNode(api) }) }]
      }
    }
    node = node.parent
  }
  return []
}

const signatureHelp = StateField.define<readonly Tooltip[]>({
  create: signatureAt,
  update: (value, transaction) => (transaction.docChanged || transaction.selection ? signatureAt(transaction.state) : value),
  provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
})

// basicSetup 이 이미 autocompletion 을 켜 두므로 여기서는 목록만 보탠다
export const jscadSupport = (): Extension[] => [
  javascriptLanguage.data.of({ autocomplete: completionSource }),
  hover,
  signatureHelp,
]
