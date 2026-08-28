import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Box, Braces, Camera, ChevronRight, Cloud, Code2, Download, Eye, FolderOpen, Grid3X3, LayoutGrid,
  Play, Plus, Ruler, Save, Settings, Terminal, Trash2, X,
} from 'lucide-react'
import { CodeEditor, type CodeEditorHandle } from './components/CodeEditor'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { DockView, type TabInfo } from './components/DockView'
import { GitPanel } from './components/GitPanel'
import { Licenses } from './components/Licenses'
import { Modal } from './components/Modal'
import { ProjectList } from './components/ProjectList'
import { RenderPanel } from './components/RenderPanel'
import { SnippetPalette, type DropPoint } from './components/SnippetPalette'
import { Toggle } from './components/Toggle'
import { Viewer, type ViewerHandle } from './components/Viewer'
import {
  allTabs, defaultLayout, isDockNode, makeTab, openTab, openTabAtRoot,
  pruneTabs, readTab, removeTab, reserveIds,
} from './dock/layout'
import type { DockNode, TabId, ViewKind } from './dock/types'
import { EXPORT_FORMATS, exportGeometries, measureModel, type ExportFormat } from './exporter'
import type { GitSettings } from './git'
import { runJscad } from './jscadRunner'
import { storage } from './storage'
import type { PaletteItem } from './jscadApi'
import { TEMPLATE_LABELS } from './templates'
import type { AppSettings, DialogState, Project, ProjectIndex, ProjectTemplate } from './types'

interface ToastState { id: number; message: string; tone: 'success' | 'error' | 'info' }

type RunState = 'idle' | 'running' | 'success' | 'error'

/** 열려 있는 프로젝트 하나의 상태. 편집기·미리보기·출력이 모두 여기를 본다 */
interface OpenDoc {
  project: Project
  dirty: boolean
  geometries: unknown[]
  runState: RunState
  runMessage: string
}

const DIALOG_TITLES: Record<NonNullable<DialogState>['kind'], string> = {
  new: '새 프로젝트',
  rename: '프로젝트 관리',
  delete: '프로젝트 삭제',
  settings: '설정',
  shortcuts: '키보드 단축키',
  licenses: '오픈소스 라이선스',
  export: '내보내기',
  git: 'GitHub 연동',
  render: '이미지로 렌더',
}

const VIEW_LABELS: Record<Exclude<ViewKind, 'editor' | 'preview'>, string> = {
  projects: '프로젝트',
  shapes: '도형',
  console: '출력',
}

export function App() {
  const [index, setIndex] = useState<ProjectIndex | null>(null)
  const [docs, setDocs] = useState<Record<string, OpenDoc>>({})
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [dock, setDock] = useState<DockNode | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dialogClosing, setDialogClosing] = useState(false)
  const [newName, setNewName] = useState('새 프로젝트')
  const [newTemplate, setNewTemplate] = useState<ProjectTemplate>('blank')
  const [renameValue, setRenameValue] = useState('')
  const [query, setQuery] = useState('')
  const [showGrid, setShowGrid] = useState(true)
  const [showDimensions, setShowDimensions] = useState(false)
  const [toasts, setToasts] = useState<ToastState[]>([])
  const [menu, setMenu] = useState<{ point: { x: number; y: number }; items: MenuItem[] } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const saveTimerRef = useRef<number | null>(null)
  const loadingRef = useRef(new Set<string>())
  const editorApis = useRef(new Map<string, { current: CodeEditorHandle | null }>())
  const viewerApis = useRef(new Map<string, { current: ViewerHandle | null }>())
  const indexRef = useRef<ProjectIndex | null>(null)
  const docsRef = useRef<Record<string, OpenDoc>>({})

  const settings = index?.settings
  const motion = settings?.motion ?? true
  const doc = focusedId ? docs[focusedId] ?? null : null
  indexRef.current = index
  docsRef.current = docs

  const toast = useCallback((message: string, tone: ToastState['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((items) => [...items, { id, message, tone }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3100)
  }, [])

  const patchDoc = useCallback((id: string, changes: Partial<OpenDoc>) => {
    setDocs((current) => (current[id] ? { ...current, [id]: { ...current[id], ...changes } } : current))
  }, [])

  const execute = useCallback(async (id: string, source?: string) => {
    const code = source ?? docs[id]?.project.code
    if (!code) return
    patchDoc(id, { runState: 'running', runMessage: '모델 계산 중…' })
    try {
      const result = await runJscad(code)
      patchDoc(id, {
        geometries: result.geometries,
        runState: 'success',
        runMessage: `${result.geometries.length}개 형상 · ${result.durationMs.toFixed(1)}ms`,
      })
    } catch (error) {
      patchDoc(id, { runState: 'error', runMessage: error instanceof Error ? error.message : String(error) })
    }
  }, [docs, patchDoc])

  /** 아직 안 열린 프로젝트면 저장소에서 읽어 온 뒤 한 번 실행한다 */
  const ensureDoc = useCallback(async (id: string, source?: ProjectIndex) => {
    const from = source ?? index
    if (!from || docs[id] || loadingRef.current.has(id)) return
    const meta = from.projects.find((item) => item.id === id)
    if (!meta) return
    loadingRef.current.add(id)
    try {
      const project = await storage.loadProject(meta)
      setDocs((current) => ({
        ...current,
        [id]: { project, dirty: false, geometries: [], runState: 'idle', runMessage: '준비 중…' },
      }))
      void execute(id, project.code)
    } catch (error) {
      toast(`프로젝트 열기 실패: ${String(error)}`, 'error')
    } finally {
      loadingRef.current.delete(id)
    }
  }, [index, docs, execute, toast])

  useEffect(() => {
    storage.initialize()
      .then(({ index: loaded, active }) => {
        setIndex(loaded)
        setDocs({ [active.id]: { project: active, dirty: false, geometries: [], runState: 'idle', runMessage: '준비 중…' } })
        setFocusedId(active.id)

        const known = new Set(loaded.projects.map((item) => item.id))
        const stored = loaded.settings.dock
        let restored: DockNode | null = null
        if (isDockNode(stored)) {
          reserveIds(stored)
          restored = pruneTabs(stored, (tab) => {
            const { projectId } = readTab(tab)
            return !projectId || known.has(projectId)
          })
        }
        const layout = restored ?? defaultLayout(active.id)
        setDock(layout)
        void execute(active.id, active.code)
        // 저장된 레이아웃이 다른 프로젝트도 열어 두었다면 함께 불러온다
        for (const tab of allTabs(layout)) {
          const { projectId } = readTab(tab)
          if (projectId && projectId !== active.id) void ensureDoc(projectId, loaded)
        }
      })
      .catch((error) => toast(`저장소 초기화 실패: ${String(error)}`, 'error'))
    // 최초 1회만 실행한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('motion-off', !motion)
  }, [motion])

  const updateSettings = useCallback((changes: Partial<AppSettings>) => {
    setIndex((current) => {
      if (!current) return current
      const next = { ...current, settings: { ...current.settings, ...changes } }
      void storage.saveIndex(next).catch((error) => toast(`설정 저장 실패: ${String(error)}`, 'error'))
      return next
    })
  }, [toast])

  const applyDock = useCallback((next: DockNode | null, persist = false) => {
    setDock(next)
    if (persist) updateSettings({ dock: next })
  }, [updateSettings])

  const openView = useCallback((kind: ViewKind, projectId?: string) => {
    const tab = makeTab(kind, projectId)
    if (projectId) {
      void ensureDoc(projectId)
      setFocusedId(projectId)
    }
    // 출력은 전체 폭을 차지하도록 트리 맨 아래에 붙인다
    applyDock(kind === 'console' ? openTabAtRoot(dock, tab, 'bottom') : openTab(dock, tab), true)
  }, [dock, ensureDoc, applyDock])

  const toggleView = useCallback((kind: ViewKind, projectId?: string) => {
    const tab = makeTab(kind, projectId)
    if (dock && allTabs(dock).includes(tab)) {
      applyDock(removeTab(dock, tab), true)
      return
    }
    openView(kind, projectId)
  }, [dock, applyDock, openView])

  // ---- 저장 ----

  const buildSavedState = useCallback((target: Project, sourceIndex: ProjectIndex) => {
    const saved = { ...target, updatedAt: new Date().toISOString() }
    const meta = { id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt }
    const nextIndex = {
      ...sourceIndex,
      activeProjectId: saved.id,
      projects: sourceIndex.projects.map((item) => (item.id === saved.id ? meta : item)),
    }
    if (!nextIndex.projects.some((item) => item.id === saved.id)) nextIndex.projects.unshift(meta)
    return { saved, nextIndex }
  }, [])

  const saveDocs = useCallback(async (ids: string[], announce: boolean) => {
    if (!index) return
    let nextIndex = index
    for (const id of ids) {
      const target = docs[id]
      if (!target) continue
      const { saved, nextIndex: updated } = buildSavedState(target.project, nextIndex)
      try {
        await storage.saveProject(saved, updated)
        nextIndex = updated
        patchDoc(id, { project: saved, dirty: false })
      } catch (error) {
        toast(`저장 실패: ${String(error)}`, 'error')
        return
      }
    }
    setIndex(nextIndex)
    if (announce) toast('프로젝트를 저장했습니다.', 'success')
  }, [index, docs, buildSavedState, patchDoc, toast])

  const dirtyIds = useMemo(() => Object.values(docs).filter((item) => item.dirty).map((item) => item.project.id), [docs])
  const dirtySignature = dirtyIds.join(',') + Object.values(docs).map((item) => item.project.code.length).join(',')

  useEffect(() => {
    if (!settings?.autoSave || !dirtyIds.length) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void saveDocs(dirtyIds, false), 850)
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }
    // 코드 길이까지 서명에 넣어 편집이 이어지는 동안 타이머를 미룬다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtySignature, settings?.autoSave])

  const focusedCode = doc?.project.code
  useEffect(() => {
    if (!settings?.autoRun || !focusedId || !doc?.dirty || !focusedCode) return
    const timer = window.setTimeout(() => void execute(focusedId, focusedCode), 480)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, focusedCode, doc?.dirty, settings?.autoRun])

  // ---- 프로젝트 관리 ----

  const closeDialog = useCallback((after?: () => void) => {
    if (!dialog) return
    if (!motion) { setDialog(null); after?.(); return }
    setDialogClosing(true)
    window.setTimeout(() => { setDialog(null); setDialogClosing(false); after?.() }, 170)
  }, [dialog, motion])

  const openNewDialog = useCallback(() => {
    setNewName('새 프로젝트')
    setNewTemplate('blank')
    setDialog({ kind: 'new' })
  }, [])

  const createProject = useCallback(async () => {
    if (!index || !newName.trim()) return
    const created = storage.create(newName.trim(), newTemplate)
    const nextIndex: ProjectIndex = {
      ...index,
      activeProjectId: created.id,
      projects: [{ id: created.id, name: created.name, createdAt: created.createdAt, updatedAt: created.updatedAt }, ...index.projects],
    }
    await storage.saveProject(created, nextIndex)
    setIndex(nextIndex)
    setDocs((current) => ({
      ...current,
      [created.id]: { project: created, dirty: false, geometries: [], runState: 'idle', runMessage: '준비 중…' },
    }))
    setFocusedId(created.id)
    applyDock(openTab(dock, makeTab('editor', created.id)), true)
    void execute(created.id, created.code)
    toast(`${created.name} 프로젝트를 만들었습니다.`, 'success')
  }, [index, dock, newName, newTemplate, execute, applyDock, toast])

  const renameProject = useCallback(async (id: string) => {
    if (!index || !renameValue.trim()) return
    const meta = index.projects.find((item) => item.id === id)
    if (!meta) return
    try {
      // 열려 있지 않은 프로젝트도 코드를 지우지 않도록 원본을 먼저 읽는다
      const current = docs[id]?.project ?? await storage.loadProject(meta)
      const { saved, nextIndex } = buildSavedState({ ...current, name: renameValue.trim() }, index)
      await storage.saveProject(saved, nextIndex)
      patchDoc(saved.id, { project: saved, dirty: false })
      setIndex(nextIndex)
      toast('프로젝트 이름을 바꿨습니다.', 'success')
    } catch (error) {
      toast(`이름 변경 실패: ${String(error)}`, 'error')
    }
  }, [index, docs, renameValue, buildSavedState, patchDoc, toast])

  const deleteProject = useCallback(async (target: Project) => {
    if (!index) return
    if (index.projects.length === 1) {
      toast('마지막 프로젝트는 삭제할 수 없습니다.', 'error')
      return
    }
    const remaining = index.projects.filter((item) => item.id !== target.id)
    const nextIndex = { ...index, activeProjectId: remaining[0].id, projects: remaining }
    await storage.deleteProject(target.id, nextIndex)
    setIndex(nextIndex)
    setDocs((current) => {
      const next = { ...current }
      delete next[target.id]
      return next
    })
    applyDock(pruneTabs(dock, (tab) => readTab(tab).projectId !== target.id), true)
    if (focusedId === target.id) setFocusedId(remaining[0].id)
    toast('프로젝트를 삭제했습니다.', 'success')
  }, [index, dock, focusedId, applyDock, toast])

  // 연동 창은 오래 열려 있으므로 최신 상태를 ref 로 읽는다 (닫힌 채로 굳은 목록을 올리지 않도록)
  const loadAllProjects = useCallback(async () => {
    const current = indexRef.current
    if (!current) return []
    const list: Project[] = []
    for (const meta of current.projects) {
      list.push(docsRef.current[meta.id]?.project ?? await storage.loadProject(meta))
    }
    return list
  }, [])

  /** 저장소에서 받아온 내용을 로컬 프로젝트로 반영한다 */
  const applyPulled = useCallback(async (files: { id: string; name: string; code: string }[]) => {
    let nextIndex = indexRef.current
    if (!nextIndex) return
    for (const file of files) {
      const now = new Date().toISOString()
      const existing = nextIndex.projects.find((item) => item.id === file.id)
      const project: Project = {
        id: file.id,
        name: file.name,
        code: file.code,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      const { saved, nextIndex: updated } = buildSavedState(project, nextIndex)
      await storage.saveProject(saved, updated)
      nextIndex = updated
      setDocs((current) => (current[file.id]
        ? { ...current, [file.id]: { ...current[file.id], project: saved, dirty: false } }
        : current))
      if (docsRef.current[file.id]) void execute(file.id, file.code)
    }
    setIndex(nextIndex)
    indexRef.current = nextIndex
  }, [buildSavedState, execute])

  const exportModel = useCallback((format: ExportFormat) => {
    if (!doc) return
    // 브라우저 내려받기는 사용자 조작과 같은 흐름에서 시작해야 막히지 않는다
    exportGeometries(doc.project.name, format, doc.geometries)
      .then((target) => { if (target) toast(`${target} 로 내보냈습니다.`, 'success') })
      .catch((error) => toast(`내보내기 실패: ${String(error)}`, 'error'))
  }, [doc, toast])

  // ---- 도형 팔레트가 코드에 넣기 ----

  const apiRefFor = useCallback((id: string) => {
    const existing = editorApis.current.get(id)
    if (existing) return existing
    const created = { current: null as CodeEditorHandle | null }
    editorApis.current.set(id, created)
    return created
  }, [])

  const viewerRefFor = useCallback((id: string) => {
    const existing = viewerApis.current.get(id)
    if (existing) return existing
    const created = { current: null as ViewerHandle | null }
    viewerApis.current.set(id, created)
    return created
  }, [])

  const editorAt = (point: DropPoint | null) => {
    if (!point) return null
    const stack = document.elementsFromPoint(point.x, point.y)
    const host = stack.find((element) => element instanceof HTMLElement && element.dataset.editorProject) as HTMLElement | undefined
    return host?.dataset.editorProject ?? null
  }

  const overEditor = (point: DropPoint | null) => {
    const id = editorAt(point)
    editorApis.current.forEach((ref, key) => { if (key !== id) ref.current?.showDropTarget(null) })
    if (!id || !point) return false
    const api = editorApis.current.get(id)?.current
    api?.showDropTarget(point)
    return !!api
  }

  const insertSnippet = (item: PaletteItem, point?: DropPoint) => {
    const id = (point ? editorAt(point) : null) ?? focusedId
    const api = id ? editorApis.current.get(id)?.current : null
    if (!api) {
      toast('먼저 편집기 탭을 여세요.', 'error')
      return
    }
    api.insertSnippet({ code: item.code, requires: item.requires }, point)
    api.showDropTarget(null)
  }

  // ---- 단축키 ----

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (event.key === 'Escape' && dialog) { event.preventDefault(); closeDialog(); return }
      if (event.key === 'F1') { event.preventDefault(); setDialog({ kind: 'shortcuts' }); return }
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 's') { event.preventDefault(); void saveDocs(focusedId ? [focusedId] : [], true) }
      if (key === 'enter') { event.preventDefault(); if (focusedId) void execute(focusedId) }
      if (key === 'n') { event.preventDefault(); openNewDialog() }
      if (key === 'p') { event.preventDefault(); openView('projects'); window.setTimeout(() => searchRef.current?.focus(), 80) }
      if (key === 'e') { event.preventDefault(); setDialog({ kind: 'export' }) }
      if (key === 'r') { event.preventDefault(); setDialog({ kind: 'render' }) }
      if (key === ',') { event.preventDefault(); setDialog({ kind: 'settings' }) }
      if (key === 'b') { event.preventDefault(); toggleView('projects') }
      if (key === 'j') { event.preventDefault(); toggleView('console') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, closeDialog, saveDocs, execute, focusedId, openNewDialog, openView, toggleView])

  const filteredProjects = useMemo(
    () => index?.projects.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())) ?? [],
    [index?.projects, query],
  )

  if (!index || !settings) {
    return <div className="boot-screen"><Box size={32} /><span>JSCAD Studio 여는 중…</span></div>
  }

  const stats = dialog?.kind === 'export' && doc ? measureModel(doc.geometries) : null
  const openProjectIds = [...new Set((dock ? allTabs(dock) : []).map((tab) => readTab(tab).projectId).filter(Boolean))] as string[]

  /** 렌더 이미지가 화면과 같은 비율로 나오도록 열려 있는 미리보기 크기를 잰다 */
  const previewSize = () => {
    if (!focusedId) return null
    const element = document.querySelector(`[data-preview-project="${focusedId}"]`)
    const box = element?.getBoundingClientRect()
    return box && box.width > 40 ? { width: box.width, height: box.height } : null
  }

  const openViewMenu = (anchor: HTMLElement) => {
    const box = anchor.getBoundingClientRect()
    const open = dock ? allTabs(dock) : []
    const entry = (kind: ViewKind, label: string, icon: ReactNode, projectId?: string): MenuItem => {
      const tab = makeTab(kind, projectId)
      return {
        id: tab,
        label: `${label} ${open.includes(tab) ? '닫기' : '열기'}`,
        icon,
        onSelect: () => toggleView(kind, projectId),
      }
    }
    setMenu({
      point: { x: Math.max(8, box.right - 210), y: box.bottom + 6 },
      items: [
        entry('projects', '프로젝트', <FolderOpen size={15} />),
        entry('shapes', '도형', <Box size={15} />),
        entry('console', '출력', <Terminal size={15} />),
        ...(focusedId ? [
          entry('editor', '코드', <Code2 size={15} />, focusedId),
          entry('preview', '미리보기', <Eye size={15} />, focusedId),
        ] : []),
        {
          id: 'reset',
          label: '기본 배치로 되돌리기',
          icon: <LayoutGrid size={15} />,
          onSelect: () => applyDock(defaultLayout(focusedId ?? index.projects[0].id), true),
        },
      ],
    })
  }

  const projectMenu = (id: string, point: { x: number; y: number }) => {
    const meta = index.projects.find((item) => item.id === id)
    if (!meta) return
    setMenu({
      point,
      items: [
        { id: 'code', label: '코드 열기', icon: <Code2 size={15} />, onSelect: () => openView('editor', id) },
        { id: 'preview', label: '미리보기 열기', icon: <Eye size={15} />, onSelect: () => openView('preview', id) },
        { id: 'both', label: '코드와 미리보기 함께 열기', icon: <LayoutGrid size={15} />, onSelect: () => { openView('editor', id); openView('preview', id) } },
        {
          id: 'rename',
          label: '이름 바꾸기',
          icon: <Braces size={15} />,
          onSelect: () => { setRenameValue(meta.name); setDialog({ kind: 'rename', project: { ...meta, code: '' } }) },
        },
        {
          id: 'delete',
          label: '삭제',
          icon: <Trash2 size={15} />,
          danger: true,
          onSelect: () => setDialog({ kind: 'delete', project: { ...meta, code: '' } }),
        },
      ],
    })
  }

  const describeTab = (tab: TabId): TabInfo => {
    const { kind, projectId } = readTab(tab)
    if (kind === 'projects') return { label: VIEW_LABELS.projects, icon: <FolderOpen size={14} /> }
    if (kind === 'shapes') return { label: VIEW_LABELS.shapes, icon: <Box size={14} /> }
    if (kind === 'console') return { label: VIEW_LABELS.console, icon: <Terminal size={14} /> }
    const target = projectId ? docs[projectId] : null
    const name = target?.project.name ?? index.projects.find((item) => item.id === projectId)?.name ?? '프로젝트'
    return kind === 'editor'
      ? { label: name, icon: <Code2 size={14} />, dirty: target?.dirty }
      : { label: `${name} 미리보기`, icon: <Eye size={14} /> }
  }

  const renderView = (tab: TabId) => {
    const { kind, projectId } = readTab(tab)
    if (kind === 'projects') {
      return (
        <ProjectList
          projects={filteredProjects}
          openIds={openProjectIds}
          focusedId={focusedId}
          query={query}
          onQuery={setQuery}
          searchRef={searchRef}
          onOpen={(id) => openView('editor', id)}
          onMenu={projectMenu}
          onNew={openNewDialog}
        />
      )
    }
    if (kind === 'shapes') {
      return (
        <SnippetPalette
          onInsert={(item) => insertSnippet(item)}
          onDrop={(item, point) => insertSnippet(item, point)}
          onDragOver={overEditor}
        />
      )
    }
    if (kind === 'console') {
      return <pre className={`console-output${doc?.runState === 'error' ? ' error-text' : ''}`}>{doc?.runMessage ?? '준비 중…'}</pre>
    }
    const target = projectId ? docs[projectId] : null
    if (!projectId || !target) return <div className="dock-empty">불러오는 중…</div>
    if (kind === 'editor') {
      return (
        <div className="editor-host" data-editor-project={projectId} onPointerDown={() => setFocusedId(projectId)}>
          <CodeEditor
            value={target.project.code}
            fontSize={settings.fontSize}
            apiRef={apiRefFor(projectId)}
            onChange={(code) => patchDoc(projectId, { project: { ...target.project, code }, dirty: true })}
          />
        </div>
      )
    }
    return (
      <div className="viewer-wrap" data-preview-project={projectId} onPointerDown={() => setFocusedId(projectId)}>
        <Viewer
          geometries={target.geometries}
          showGrid={showGrid}
          showDimensions={showDimensions}
          rotateSensitivity={settings.rotateSensitivity}
          zoomSensitivity={settings.zoomSensitivity}
          apiRef={viewerRefFor(projectId)}
        />
        <div className="viewer-hint">드래그: 회전 · Shift+드래그: 이동 · 휠/핀치: 확대</div>
        {target.runState === 'error' && <div className="error-overlay"><X size={18} /><span>{target.runMessage}</span></div>}
      </div>
    )
  }

  const renderActions = (tab: TabId) => {
    const { kind } = readTab(tab)
    if (kind === 'projects') {
      return <button className="icon-button tiny" onClick={openNewDialog} aria-label="새 프로젝트"><Plus size={16} /></button>
    }
    if (kind === 'preview') {
      return (
        <>
          <button className={`icon-button tiny${showDimensions ? ' selected' : ''}`} onClick={() => setShowDimensions((value) => !value)} aria-label="치수 표시" title="치수 표시">
            <Ruler size={16} />
          </button>
          <button className={`icon-button tiny${showGrid ? ' selected' : ''}`} onClick={() => setShowGrid((value) => !value)} aria-label="그리드 토글" title="격자와 축">
            <Grid3X3 size={16} />
          </button>
        </>
      )
    }
    return null
  }

  const runState = doc?.runState ?? 'idle'
  const runMessage = doc?.runMessage ?? '프로젝트를 열어 주세요.'

  return (
    <div
      className="app-shell"
      style={{
        width: `${100 / settings.uiScale}%`,
        height: `${100 / settings.uiScale}%`,
        transform: `scale(${settings.uiScale})`,
        transformOrigin: 'top left',
      } as CSSProperties}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Braces size={20} /></div>
          <span>JSCAD Studio</span>
          <ChevronRight size={15} className="muted" />
          <strong>{doc?.project.name ?? '열린 프로젝트 없음'}</strong>
          {doc?.dirty && <span className="dirty-dot" title="저장되지 않은 변경" />}
        </div>
        <div className="top-actions">
          <button className="button ghost" onClick={() => void saveDocs(focusedId ? [focusedId] : [], true)} disabled={!doc}><Save size={17} /><span>저장</span><kbd>Ctrl S</kbd></button>
          <button className="button primary" onClick={() => focusedId && void execute(focusedId)} disabled={!doc || runState === 'running'}><Play size={17} fill="currentColor" /><span>실행</span><kbd>Ctrl ↵</kbd></button>
          <button className="icon-button" onClick={() => setDialog({ kind: 'render' })} aria-label="이미지로 렌더" title="이미지로 렌더 (Ctrl R)"><Camera size={19} /></button>
          <button className="icon-button" onClick={() => setDialog({ kind: 'export' })} aria-label="내보내기" title="STL·3MF 내보내기 (Ctrl E)"><Download size={19} /></button>
          <button className="icon-button" onClick={(event) => openViewMenu(event.currentTarget)} aria-label="보기" title="패널 열고 닫기"><LayoutGrid size={19} /></button>
          <button className={`icon-button${settings.git ? ' selected' : ''}`} onClick={() => setDialog({ kind: 'git' })} aria-label="GitHub 연동" title={settings.git ? `${settings.git.repo} 와 동기화` : 'GitHub 연동'}><Cloud size={19} /></button>
          <button className="icon-button" onClick={() => setDialog({ kind: 'settings' })} aria-label="설정"><Settings size={19} /></button>
        </div>
      </header>

      <main className="workspace">
        {dock ? (
          <DockView
            root={dock}
            describeTab={describeTab}
            renderView={renderView}
            renderActions={renderActions}
            onChange={applyDock}
            onFocus={(tab) => {
              const { projectId } = readTab(tab)
              if (projectId) setFocusedId(projectId)
            }}
          />
        ) : (
          <div className="dock-blank">
            <p>열린 패널이 없습니다.</p>
            <div>
              <button className="button ghost" onClick={() => openView('projects')}><FolderOpen size={16} />프로젝트</button>
              <button className="button ghost" onClick={() => openView('shapes')}><Box size={16} />도형</button>
              {focusedId && <button className="button ghost" onClick={() => openView('editor', focusedId)}><Code2 size={16} />코드</button>}
              {focusedId && <button className="button ghost" onClick={() => openView('preview', focusedId)}><Eye size={16} />미리보기</button>}
              <button className="button ghost" onClick={() => applyDock(defaultLayout(focusedId ?? index.projects[0].id), true)}><LayoutGrid size={16} />기본 배치</button>
            </div>
          </div>
        )}
      </main>

      <footer className="statusbar">
        <button onClick={() => toggleView('console')} className={`run-status ${runState}`}><span />{runState === 'error' ? '오류' : runState === 'running' ? '실행 중' : '준비됨'}</button>
        <span>{runMessage}</span>
        <span className="status-spacer" />
        <button onClick={() => toggleView('projects')} title="프로젝트 패널 (Ctrl B)"><FolderOpen size={13} />프로젝트</button>
        <button onClick={() => toggleView('shapes')} title="도형 팔레트"><Box size={13} />도형</button>
        <span>{dirtyIds.length ? (settings.autoSave ? '자동 저장 대기' : `저장 필요 ${dirtyIds.length}`) : '저장됨'}</span>
        <button onClick={() => setDialog({ kind: 'shortcuts' })}>F1 단축키</button>
      </footer>

      {menu && <ContextMenu point={menu.point} items={menu.items} onClose={() => setMenu(null)} />}

      {dialog && (
        <Modal
          title={DIALOG_TITLES[dialog.kind]}
          closing={dialogClosing}
          onClose={() => closeDialog()}
          footer={dialog.kind === 'new' ? <><button className="button ghost" onClick={() => closeDialog()}>취소</button><button className="button primary" disabled={!newName.trim()} onClick={() => closeDialog(() => void createProject())}>만들기</button></>
            : dialog.kind === 'rename' ? <><button className="button danger" onClick={() => closeDialog(() => setDialog({ kind: 'delete', project: dialog.project }))}><Trash2 size={16} />삭제</button><span className="footer-spacer" /><button className="button ghost" onClick={() => closeDialog()}>취소</button><button className="button primary" disabled={!renameValue.trim()} onClick={() => closeDialog(() => void renameProject(dialog.project.id))}>저장</button></>
              : dialog.kind === 'delete' ? <><button className="button ghost" onClick={() => closeDialog()}>취소</button><button className="button danger" onClick={() => closeDialog(() => void deleteProject(dialog.project))}>삭제</button></>
                : undefined}
        >
          {dialog.kind === 'new' && <div className="form-stack">
            <label className="field"><span>프로젝트 이름</span><input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newName.trim() && closeDialog(() => void createProject())} /></label>
            <div className="field"><span>시작 템플릿</span><div className="template-grid">{(Object.keys(TEMPLATE_LABELS) as ProjectTemplate[]).map((key) => <button key={key} className={newTemplate === key ? 'selected' : ''} onClick={() => setNewTemplate(key)}><span className="template-icon">{key === 'keycap' ? <Box /> : key === 'plate' ? <Grid3X3 /> : <Code2 />}</span><strong>{TEMPLATE_LABELS[key]}</strong></button>)}</div></div>
          </div>}
          {dialog.kind === 'rename' && <div className="form-stack"><label className="field"><span>프로젝트 이름</span><input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} /></label><p className="muted-copy">코드와 프로젝트 생성일은 그대로 유지됩니다.</p></div>}
          {dialog.kind === 'delete' && <div className="confirm-copy"><span className="danger-icon"><Trash2 /></span><div><strong>“{dialog.project.name}”을 삭제할까요?</strong><p>앱 내부 저장소의 JSCAD 파일도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p></div></div>}
          {dialog.kind === 'settings' && <div className="settings-list">
            <Toggle checked={settings.motion} onChange={(motion) => updateSettings({ motion })} label="모션과 전환" description="패널, 모달, 토스트가 짧게 이어지도록 표시" />
            <Toggle checked={settings.autoRun} onChange={(autoRun) => updateSettings({ autoRun })} label="코드 자동 실행" description="입력이 멈춘 뒤 0.5초 후 미리보기 갱신" />
            <Toggle checked={settings.autoSave} onChange={(autoSave) => updateSettings({ autoSave })} label="프로젝트 자동 저장" description="변경 내용을 앱 내부 저장소에 자동 보관" />
            <label className="font-setting"><span><strong>UI 배율</strong><small>버튼과 패널을 화면에 맞게 확대·축소</small></span><div><input type="range" min="0.85" max="1.3" step="0.05" value={settings.uiScale} onChange={(e) => updateSettings({ uiScale: Number(e.target.value) })} /><output>{Math.round(settings.uiScale * 100)}%</output></div></label>
            <label className="font-setting"><span><strong>편집기 글자 크기</strong><small>물리 키보드 사용 시 가독성 조절</small></span><div><input type="range" min="12" max="22" value={settings.fontSize} onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })} /><output>{settings.fontSize}px</output></div></label>
            <label className="font-setting"><span><strong>3D 회전 감도</strong><small>마우스와 한 손가락 드래그의 회전 속도</small></span><div><input type="range" min="0.1" max="1.2" step="0.05" value={settings.rotateSensitivity} onChange={(e) => updateSettings({ rotateSensitivity: Number(e.target.value) })} /><output>{Math.round(settings.rotateSensitivity * 100)}%</output></div></label>
            <label className="font-setting"><span><strong>확대·축소 감도</strong><small>휠과 두 손가락 핀치의 줌 속도</small></span><div><input type="range" min="0.15" max="1.2" step="0.05" value={settings.zoomSensitivity} onChange={(e) => updateSettings({ zoomSensitivity: Number(e.target.value) })} /><output>{Math.round(settings.zoomSensitivity * 100)}%</output></div></label>
            <button className="settings-link" onClick={() => setDialog({ kind: 'git' })}><span><strong>GitHub 연동</strong><small>{settings.git ? `${settings.git.repo} · ${settings.git.branch}` : '저장소 한 곳에 프로젝트를 보관하고 다른 기기와 이어 쓰기'}</small></span><ChevronRight size={17} /></button>
            <button className="settings-link" onClick={() => { applyDock(defaultLayout(focusedId ?? index.projects[0].id), true); toast('레이아웃을 기본값으로 되돌렸습니다.', 'success') }}><span><strong>레이아웃 초기화</strong><small>패널 배치와 크기를 처음 상태로</small></span><ChevronRight size={17} /></button>
            <button className="settings-link" onClick={() => setDialog({ kind: 'licenses' })}><span><strong>오픈소스 라이선스</strong><small>이 앱이 포함한 소프트웨어의 저작권과 라이선스 원문</small></span><ChevronRight size={17} /></button>
          </div>}
          {dialog.kind === 'export' && <div className="export-view">
            {stats ? (
              <dl className="model-facts">
                <div><dt>크기</dt><dd>{stats.size.map((value) => value.toFixed(1)).join(' × ')} mm</dd></div>
                <div><dt>부피</dt><dd>{(stats.volume / 1000).toFixed(2)} cm³</dd></div>
              </dl>
            ) : (
              <p className="muted-copy">내보낼 형상이 없습니다. 먼저 코드를 실행해 주세요.</p>
            )}
            {EXPORT_FORMATS.map((format) => (
              <button key={format.id} className="export-option" disabled={!stats} onClick={() => { exportModel(format.id); closeDialog() }}>
                <span><strong>{format.label}</strong><small>{format.note}</small></span>
                <Download size={17} />
              </button>
            ))}
            <p className="muted-copy">슬라이서에서 단위는 밀리미터로 열립니다.</p>
          </div>}
          {dialog.kind === 'git' && (
            <GitPanel
              settings={settings.git}
              loadProjects={loadAllProjects}
              onSaveSettings={(next: GitSettings | null) => updateSettings({ git: next })}
              onPulled={applyPulled}
              toast={toast}
            />
          )}
          {dialog.kind === 'render' && (
            <RenderPanel
              geometries={doc?.geometries ?? []}
              camera={focusedId ? viewerApis.current.get(focusedId)?.current?.getCamera() ?? null : null}
              viewport={previewSize()}
              projectName={doc?.project.name ?? 'render'}
              toast={toast}
            />
          )}
          {dialog.kind === 'licenses' && <Licenses />}
          {dialog.kind === 'shortcuts' && <div className="shortcut-grid">
            <span>실행</span><kbd>Ctrl Enter</kbd><span>저장</span><kbd>Ctrl S</kbd><span>새 프로젝트</span><kbd>Ctrl N</kbd><span>프로젝트 검색</span><kbd>Ctrl P</kbd><span>프로젝트 패널</span><kbd>Ctrl B</kbd><span>출력 패널</span><kbd>Ctrl J</kbd><span>내보내기</span><kbd>Ctrl E</kbd><span>이미지로 렌더</span><kbd>Ctrl R</kbd><span>설정</span><kbd>Ctrl ,</kbd><span>자동완성</span><kbd>Ctrl Space</kbd><span>창 닫기</span><kbd>Esc</kbd>
          </div>}
        </Modal>
      )}

      <div className="toast-stack" aria-live="polite">{toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}><span />{item.message}</div>)}</div>
    </div>
  )
}
