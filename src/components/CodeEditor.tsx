import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { indentWithTab } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'

interface Props {
  value: string
  fontSize: number
  onChange: (value: string) => void
}

export function CodeEditor({ value, fontSize, onChange }: Props) {
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
        extensions: [
          basicSetup,
          javascript(),
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
    return () => view.destroy()
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

