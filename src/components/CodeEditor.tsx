import { useEffect, useRef, type RefObject } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { indentWithTab } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import { applySnippet, jscadSupport, type InsertableSnippet } from '../jscadEditorSupport'

export interface CodeEditorHandle {
  /** coords 를 주면 그 위치에, 없으면 커서 자리에 넣는다 */
  insertSnippet: (snippet: InsertableSnippet, coords?: { x: number; y: number }) => void
  /** 끌어다 놓는 동안 놓일 자리를 캐럿으로 보여 준다 */
  showDropTarget: (coords: { x: number; y: number } | null) => void
}

interface Props {
  value: string
  fontSize: number
  onChange: (value: string) => void
  apiRef?: RefObject<CodeEditorHandle | null>
}

export function CodeEditor({ value, fontSize, onChange, apiRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        // 편집기를 아직 한 번도 만지지 않은 상태에서 팔레트를 탭하면 맨 앞이 아니라 끝에 붙도록
        selection: { anchor: value.length },
        extensions: [
          basicSetup,
          javascript(),
          ...jscadSupport(),
          oneDark,
          keymap.of([indentWithTab]),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': { height: '100%', fontSize: `${fontSize}px`, backgroundColor: '#111317' },
            '.cm-scroller': { fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace", lineHeight: '1.65' },
            '.cm-content': { padding: '14px 0' },
            '.cm-gutters': { backgroundColor: '#111317', borderRight: '1px solid #252932' },
            '&.cm-focused': { outline: 'none' },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    if (apiRef) {
      apiRef.current = {
        insertSnippet: (snippet, coords) => {
          const at = coords ? view.posAtCoords(coords) : null
          applySnippet(view, snippet, at === null ? undefined : { from: at, to: at })
        },
        showDropTarget: (coords) => {
          if (!coords) {
            hostRef.current?.classList.remove('is-drop-target')
            return
          }
          const at = view.posAtCoords(coords)
          if (at === null) return
          hostRef.current?.classList.add('is-drop-target')
          view.dispatch({ selection: { anchor: at } })
        },
      }
    }
    return () => {
      if (apiRef) apiRef.current = null
      view.destroy()
    }
    // Editor instance is deliberately recreated only when font size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  return <div className="code-editor" ref={hostRef} />
}

