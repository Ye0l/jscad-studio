import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Box, Boxes, Braces, ChevronRight, Cloud, Code2, Copy, Diff, Download, Eye, FolderOpen, Grid3X3,
  Group as GroupIcon, Layers, LayoutGrid, Maximize, Move3d, Pencil, Play, Plus, RotateCw, Save,
  Scale3d, Settings, Settings2, SquareStack, Terminal, Trash2, X,
} from 'lucide-react'
import { CodeEditor, type CodeEditorHandle } from './components/CodeEditor'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { DockView, type TabInfo } from './components/DockView'
import { GitPanel } from './components/GitPanel'
import { Inspector } from './components/Inspector'
import { ObjectTree, type AddKind, type SelectMode } from './components/ObjectTree'
import { StackEditor } from './components/StackEditor'
import { Licenses } from './components/Licenses'
import { Modal } from './components/Modal'
import { ProjectList } from './components/ProjectList'
import { SnippetPalette, type DropPoint } from './components/SnippetPalette'
import { Toggle } from './components/Toggle'
import { Viewer } from './components/Viewer'
import {
  allTabs, defaultLayout, isDockNode, makeTab, openTab, openTabAtRoot,
  pruneTabs, readTab, removeTab, reserveIds,
} from './dock/layout'
import type { DockNode, TabId, ViewKind } from './dock/types'
import { EXPORT_FORMATS, exportGeometries, measureModel, type ExportFormat } from './exporter'
import type { GitSettings } from './git'
import { runJscad } from './jscadRunner'
import { evaluateScene, previewLayout } from './scene/evaluate'
import { composeDocument, splitDocument } from './scene/document'
import { hiddenCodeNotes } from './scene/codegen'
import {
  BOOLEAN_LABELS, addNode, ancestorsOf, duplicateNode, emptyScene, flattenScene, groupInto,
  makeBoolean, makeCodeNode, makeGroup, makePrimitive, makeStack, moveNode, patchNode, removeNode,
  reorderNode, setParam, setTransform,
} from './scene/model'
import { PRIMITIVES, PRIMITIVE_KINDS } from './scene/primitives'
import { rayHitsBox, worldDeltaToLocal } from './scene/layout'
import type { BuildItem } from './scene/build'
import type { Box as SceneBox, BooleanOp, Layout, PrimitiveKind, Scene, SceneNode, Vec3 } from './scene/types'
import type { GizmoMode, GizmoPayload } from './components/Viewer'
import { storage } from './storage'
import type { PaletteItem } from './jscadApi'
import { TEMPLATE_LABELS } from './templates'
import type { AppSettings, DialogState, Project, ProjectIndex, ProjectTemplate } from './types'

interface ToastState { id: number; message: string; tone: 'success' | 'error' | 'info' }

type RunState = 'idle' | 'running' | 'success' | 'error'

/** 열려 있는 프로젝트 하나의 상태. 편집기·미리보기·객체 트리가 모두 여기를 본다 */
interface OpenDoc {
  /** project.code 는 저장 형식 (코드 + scene 블록) */
  project: Project
  /** 편집기에 보여 주는 코드 */
  code: string
  /** 시각 모드 정보. null 이면 코드 전용 프로젝트 */
  scene: Scene | null
  selection: string[]
  layout: Layout
  items: BuildItem[]
  localBounds: Record<string, SceneBox | null>
  dirty: boolean
  geometries: unknown[]
  runState: RunState
  runMessage: string
  /** 편집 때마다 오르는 번호. 실행된 번호와 다르면 다시 계산할 것이 남아 있다 */
  revision: number
  runRevision: number
  revisionKind: 'code' | 'scene'
  /** 기즈모를 끄는 동안에는 무거운 재계산을 미룬다 */
  dragging: boolean
  /** 마지막 계산에 걸린 시간 (ms). 가벼우면 끌면서도 형상을 갱신한다 */
  lastEvalMs: number
}

/** 시각 모드인지 — 장면이 있으면 장면이 원본이고 코드는 거기서 만들어진다 */
const isVisual = (doc: OpenDoc | null | undefined) => !!doc?.scene

const makeDoc = (project: Project): OpenDoc => {
  const { code, scene } = splitDocument(project.code)
  return {
    project,
    code,
    scene,
    selection: [],
    layout: {},
    items: [],
    localBounds: {},
    dirty: false,
    geometries: [],
    runState: 'idle',
    runMessage: '준비 중…',
    revision: 1,
    runRevision: 0,
    revisionKind: scene ? 'scene' : 'code',
    dragging: false,
    lastEvalMs: 0,
  }
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
}

/** 코드 객체를 새로 만들 때 넣어 두는 뼈대 */
const CODE_NODE_SOURCE = `const { cuboid } = require('@jscad/modeling').primitives

const main = () => cuboid({ size: [10, 10, 10] })

module.exports = { main }
`

/** 기즈모로 끈 값을 사람이 읽기 좋은 눈금에 맞춘다 */
const snap = (value: number, step: number) => Math.round(value / step) * step

const VIEW_LABELS: Record<Exclude<ViewKind, 'editor' | 'preview'>, string> = {
  projects: '프로젝트',
  shapes: '도형',
  console: '출력',
  objects: '객체',
  inspector: '속성',
  stack: '적층',
}

export function App() {
  const [index, setIndex] = useState<ProjectIndex | null>(null)
  const [docs, setDocs] = useState<Record<string, OpenDoc>>({})
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [dock, setDock] = useState<DockNode | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dialogClosing, setDialogClosing] = useState(false)
  const [newName, setNewName] = useState('새 프로젝트')
  const [newTemplate, setNewTemplate] = useState<ProjectTemplate>('visual')
  const [renameValue, setRenameValue] = useState('')
  const [query, setQuery] = useState('')
  const [showGrid, setShowGrid] = useState(true)
  /** 값이 오를 때마다 미리보기가 모델에 화면을 맞춘다 */
  const [fitToken, setFitToken] = useState(1)
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('move')
  const [toasts, setToasts] = useState<ToastState[]>([])
  const [menu, setMenu] = useState<{ point: { x: number; y: number }; items: MenuItem[] } | null>(null)
  /** 객체 트리에서 이름을 고치는 중인 객체 */
  const [renaming, setRenaming] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const saveTimerRef = useRef<number | null>(null)
  const loadingRef = useRef(new Set<string>())
  const editorApis = useRef(new Map<string, { current: CodeEditorHandle | null }>())
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

  /** 편집기에서 코드를 고쳤을 때. 저장 형식은 코드 + 장면 블록이라 항상 함께 맞춰 둔다 */
  const updateCode = useCallback((id: string, code: string) => {
    setDocs((current) => {
      const target = current[id]
      if (!target) return current
      return {
        ...current,
        [id]: {
          ...target,
          code,
          dirty: true,
          project: { ...target.project, code: composeDocument(code, target.scene) },
          revision: target.revision + 1,
          revisionKind: 'code',
        },
      }
    })
  }, [])

  /** 객체 트리·속성·기즈모가 장면을 고쳤을 때 */
  const updateScene = useCallback((id: string, next: Scene, selection?: string[]) => {
    setDocs((current) => {
      const target = current[id]
      if (!target) return current
      // 배치는 형상보다 훨씬 싸므로 즉시 다시 풀어 숫자와 선택 상자가 바로 따라오게 한다
      const layout = previewLayout(next, target.localBounds)
      const kept = (selection ?? target.selection).filter((nodeId) => next.nodes[nodeId])
      return {
        ...current,
        [id]: {
          ...target,
          scene: next,
          layout,
          selection: kept,
          dirty: true,
          project: { ...target.project, code: composeDocument(target.code, next) },
          revision: target.revision + 1,
          revisionKind: 'scene',
        },
      }
    })
  }, [])

  const setSelection = useCallback((id: string, selection: string[]) => {
    setDocs((current) => (current[id] ? { ...current, [id]: { ...current[id], selection } } : current))
  }, [])

  const execute = useCallback(async (id: string, source?: OpenDoc) => {
    const doc = source ?? docsRef.current[id]
    if (!doc) return
    const revision = doc.revision
    patchDoc(id, { runState: 'running', runMessage: '모델 계산 중…', runRevision: revision })

    if (isVisual(doc)) {
      // 시각 모드에서는 장면이 원본이고 코드는 거기서 만들어 낸다
      try {
        const result = evaluateScene(doc.scene!)
        const code = result.code
        patchDoc(id, {
          geometries: result.geometries,
          layout: result.layout,
          items: result.items,
          localBounds: result.localBounds,
          code,
          project: { ...doc.project, code: composeDocument(code, doc.scene) },
          lastEvalMs: result.durationMs,
          runState: result.errors.length ? 'error' : 'success',
          runMessage: result.errors.length
            ? result.errors.map((item) => `${item.name}: ${item.message}`).join('\n')
            : `객체 ${Object.keys(doc.scene!.nodes).length}개 · 형상 ${result.geometries.length}개 · ${result.durationMs.toFixed(1)}ms`,
        })
      } catch (error) {
        patchDoc(id, { runState: 'error', runMessage: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    try {
      const result = await runJscad(doc.code)
      patchDoc(id, {
        geometries: result.geometries,
        items: [],
        runState: 'success',
        runMessage: `${result.geometries.length}개 형상 · ${result.durationMs.toFixed(1)}ms`,
      })
    } catch (error) {
      patchDoc(id, { runState: 'error', runMessage: error instanceof Error ? error.message : String(error) })
    }
  }, [patchDoc])

  /** 아직 안 열린 프로젝트면 저장소에서 읽어 온 뒤 한 번 실행한다 */
  const ensureDoc = useCallback(async (id: string, source?: ProjectIndex) => {
    const from = source ?? index
    if (!from || docs[id] || loadingRef.current.has(id)) return
    const meta = from.projects.find((item) => item.id === id)
    if (!meta) return
    loadingRef.current.add(id)
    try {
      const project = await storage.loadProject(meta)
      const created = makeDoc(project)
      setDocs((current) => ({ ...current, [id]: created }))
      void execute(id, created)
    } catch (error) {
      toast(`프로젝트 열기 실패: ${String(error)}`, 'error')
    } finally {
      loadingRef.current.delete(id)
    }
  }, [index, docs, execute, toast])

  useEffect(() => {
    storage.initialize()
      .then(({ index: loaded, active }) => {
        const first = makeDoc(active)
        setIndex(loaded)
        setDocs({ [active.id]: first })
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
        void execute(active.id, first)
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

  // 코드 입력은 설정에 따라, 객체 편집은 언제나 다시 계산한다 (직접 조작은 즉시 보여야 한다)
  const revision = doc?.revision ?? 0
  const runRevision = doc?.runRevision ?? 0
  const revisionKind = doc?.revisionKind ?? 'code'
  const dragging = doc?.dragging ?? false
  const heavy = (doc?.lastEvalMs ?? 0) > 90
  useEffect(() => {
    if (!focusedId || revision === runRevision) return
    if (revisionKind === 'code' && !settings?.autoRun) return
    // 무거운 모델을 끌고 있는 동안에는 선택 상자만 따라가고, 손을 떼면 형상을 다시 만든다
    if (dragging && heavy) return
    const timer = window.setTimeout(() => void execute(focusedId), revisionKind === 'scene' ? (dragging ? 60 : 200) : 480)
    return () => window.clearTimeout(timer)
  }, [focusedId, revision, runRevision, revisionKind, settings?.autoRun, dragging, heavy, execute])

  // ---- 프로젝트 관리 ----

  const closeDialog = useCallback((after?: () => void) => {
    if (!dialog) return
    if (!motion) { setDialog(null); after?.(); return }
    setDialogClosing(true)
    window.setTimeout(() => { setDialog(null); setDialogClosing(false); after?.() }, 170)
  }, [dialog, motion])

  const openNewDialog = useCallback(() => {
    setNewName('새 프로젝트')
    setNewTemplate('visual')
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
    const createdDoc = makeDoc(created)
    setDocs((current) => ({ ...current, [created.id]: createdDoc }))
    setFocusedId(created.id)
    // 새 프로젝트는 코드와 미리보기를 함께 열어 바로 만질 수 있게 한다
    applyDock(openTab(openTab(dock, makeTab('editor', created.id)), makeTab('preview', created.id)), true)
    void execute(created.id, createdDoc)
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
      // 내려받은 파일에는 시각 모드 정보가 함께 들어 있을 수 있어 문서를 다시 읽는다
      const pulled = makeDoc(saved)
      setDocs((current) => (current[file.id]
        ? { ...current, [file.id]: { ...pulled, selection: current[file.id].selection } }
        : current))
      if (docsRef.current[file.id]) void execute(file.id, pulled)
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
    if (id && isVisual(docs[id])) {
      toast('시각 모드에서는 코드가 객체에서 만들어집니다. 코드 객체를 추가하거나 코드 전용으로 전환하세요.', 'error')
      return
    }
    if (!api) {
      toast('먼저 편집기 탭을 여세요.', 'error')
      return
    }
    api.insertSnippet({ code: item.code, requires: item.requires }, point)
    api.showDropTarget(null)
  }

  // ---- 시각 모드 ----

  const createNode = useCallback((docId: string, kind: AddKind) => {
    const target = docsRef.current[docId]
    if (!target) return
    const base = target.scene ?? emptyScene()
    const offset = base.workplane.offset
    // 그룹·적층을 고른 채로 추가하면 그 안에 넣고, 그 밖에는 언제나 최상위에 놓는다.
    // (불리언 안에 몰래 들어가면 결과가 갑자기 사라져 놀라게 된다)
    const picked = target.selection.length === 1 ? base.nodes[target.selection[0]] : null
    const parentId = picked && (picked.type === 'group' || picked.type === 'stack') ? picked.id : null

    const node: SceneNode = kind === 'group' ? makeGroup(base)
      : kind === 'stack' ? makeStack(base)
        : kind === 'code' ? makeCodeNode(base, CODE_NODE_SOURCE)
          : kind === 'union' || kind === 'subtract' || kind === 'intersect' ? makeBoolean(base, kind)
            : makePrimitive(base, kind as PrimitiveKind)

    // 새 객체는 작업면 위에 바닥을 붙여 놓는다 (그룹 안에 넣을 때는 그룹의 원점 기준)
    const zBase = parentId ? 0 : offset
    node.transform.position = node.type === 'primitive'
      ? [0, 0, zBase - PRIMITIVES[node.primitive].box(node.params).min[2]]
      : [0, 0, zBase]

    // 첫 객체를 놓을 때는 화면을 한 번 맞춰 준다
    if (!base.rootIds.length) setFitToken((value) => value + 1)
    updateScene(docId, addNode(base, node, parentId), [node.id])
  }, [updateScene])

  /**
   * 코드 전용 프로젝트를 시각 모드로 옮긴다.
   * 어느 쪽을 고르든 원래 코드는 코드 객체로 남는다 — 빈 장면으로 시작할 때는 꺼 둘 뿐이다.
   */
  const startVisual = useCallback((docId: string, keepCode: boolean) => {
    const target = docsRef.current[docId]
    if (!target) return
    let scene = emptyScene()
    if (target.code.trim()) {
      const node = makeCodeNode(scene, target.code, keepCode ? '기존 코드' : '이전 코드')
      node.visible = keepCode
      scene = addNode(scene, node)
    }
    updateScene(docId, scene, [])
    setFitToken((value) => value + 1)
    toast(keepCode
      ? '기존 코드를 코드 객체로 옮겼습니다.'
      : '빈 장면으로 시작합니다. 원래 코드는 꺼 둔 “이전 코드” 객체에 남아 있습니다.', 'success')
  }, [updateScene, toast])

  /** 시각 모드를 끄고 지금까지 만들어진 코드를 그대로 넘긴다 */
  const stopVisual = useCallback((docId: string) => {
    let keptHidden = false
    setDocs((current) => {
      const target = current[docId]
      if (!target) return current
      // 숨긴 코드 객체는 생성 코드에 없으므로 주석으로 옮겨 두어야 원본이 사라지지 않는다
      const notes = target.scene ? hiddenCodeNotes(target.scene) : ''
      keptHidden = !!notes
      const code = target.code + notes
      return {
        ...current,
        [docId]: {
          ...target,
          code,
          scene: null,
          selection: [],
          items: [],
          layout: {},
          dirty: true,
          project: { ...target.project, code: composeDocument(code, null) },
          revision: target.revision + 1,
          revisionKind: 'code',
        },
      }
    })
    toast(keptHidden
      ? '코드 전용으로 바꿨습니다. 꺼 두었던 코드 객체는 파일 끝에 주석으로 남겼습니다.'
      : '코드 전용으로 바꿨습니다. 이제 편집기에서 코드를 고칠 수 있습니다.', 'success')
  }, [toast])

  /**
   * 뷰포트에서 탭한 자리의 객체를 고른다. 실제 형상 대신 배치 상자로 판정하므로 가볍고,
   * 같은 자리를 다시 누르면 한 단계 안쪽(자식)으로 들어간다.
   */
  const pickAt = useCallback((docId: string, ray: { origin: Vec3; direction: Vec3 }) => {
    const target = docsRef.current[docId]
    const scene = target?.scene
    if (!scene) return
    const visible = (id: string) => scene.nodes[id]?.visible
      && ancestorsOf(scene, id).every((parent) => scene.nodes[parent]?.visible)

    let best: { id: string; distance: number } | null = null
    for (const node of Object.values(scene.nodes)) {
      const bounds = target.layout[node.id]?.bounds
      if (!bounds || !visible(node.id)) continue
      // 그룹은 자식이 대신 잡히므로 잎만 본다
      if (node.children.length) continue
      const distance = rayHitsBox(ray.origin, ray.direction, bounds)
      if (distance === null) continue
      if (!best || distance < best.distance) best = { id: node.id, distance }
    }
    if (!best) {
      setSelection(docId, [])
      return
    }
    const chain = [...ancestorsOf(scene, best.id).reverse(), best.id]
    const at = chain.findIndex((id) => target.selection.includes(id))
    setSelection(docId, [at < 0 ? chain[0] : chain[Math.min(at + 1, chain.length - 1)]])
  }, [setSelection])

  // ---- 뷰포트 직접 조작 ----

  /** 끌기를 시작한 순간의 값. 총 변화량을 여기에 더하므로 오차가 쌓이지 않는다 */
  const gizmoBaseRef = useRef<{
    docId: string
    nodeId: string
    transform: SceneNode['transform']
    params: Record<string, number>
    half: Vec3
  } | null>(null)

  const beginGizmo = useCallback((docId: string) => {
    const target = docsRef.current[docId]
    const nodeId = target?.selection[target.selection.length - 1]
    const node = nodeId && target?.scene ? target.scene.nodes[nodeId] : null
    if (!target || !node || !nodeId) return
    const bounds = target.layout[nodeId]?.bounds
    gizmoBaseRef.current = {
      docId,
      nodeId,
      transform: structuredClone(node.transform),
      params: node.type === 'primitive' ? { ...node.params } : {},
      half: bounds
        ? [0, 1, 2].map((axis) => Math.max(0.001, (bounds.max[axis] - bounds.min[axis]) / 2)) as Vec3
        : [1, 1, 1],
    }
    setDocs((current) => (current[docId] ? { ...current, [docId]: { ...current[docId], dragging: true } } : current))
  }, [])

  const applyGizmo = useCallback((payload: GizmoPayload) => {
    const base = gizmoBaseRef.current
    if (!base) return
    const target = docsRef.current[base.docId]
    const scene = target?.scene
    const node = scene?.nodes[base.nodeId]
    if (!scene || !node) return

    if (payload.mode === 'move') {
      // 월드에서 끈 거리를 부모 좌표계 값으로 되돌린 뒤 0.5mm 로 맞춘다
      const local = worldDeltaToLocal(scene, target.layout, base.nodeId, payload.delta)
      const position = [0, 1, 2].map((axis) => snap(base.transform.position[axis] + local[axis], 0.5)) as Vec3
      updateScene(base.docId, setTransform(scene, base.nodeId, { position }))
      return
    }

    if (payload.mode === 'rotate') {
      const rotation = [...base.transform.rotation] as Vec3
      rotation[payload.axis] = snap(rotation[payload.axis] + payload.degrees, 1)
      updateScene(base.docId, setTransform(scene, base.nodeId, { rotation }))
      return
    }

    // 크기: 기본 도형은 실제 치수를, 그 밖의 객체는 배율을 바꾼다
    const grow = payload.distance
    if (node.type === 'primitive') {
      const kind = node.primitive
      const key = kind === 'sphere' ? 'radius'
        : kind === 'cylinder' ? (payload.axis === 2 ? 'height' : 'radius')
          : ['width', 'depth', 'height'][payload.axis]
      // 양쪽으로 자라는 값(가로·세로·높이)은 손잡이가 움직인 거리의 두 배가 된다
      const symmetric = key !== 'radius'
      const next = Math.max(0.1, snap((base.params[key] ?? 1) + grow * (symmetric ? 2 : 1), 0.1))
      updateScene(base.docId, setParam(scene, base.nodeId, key, next))
      return
    }
    const scale = [...base.transform.scale] as Vec3
    scale[payload.axis] = Math.max(0.01, snap(scale[payload.axis] * (1 + grow / base.half[payload.axis]), 0.01))
    updateScene(base.docId, setTransform(scene, base.nodeId, { scale }))
  }, [updateScene])

  const endGizmo = useCallback(() => {
    const base = gizmoBaseRef.current
    gizmoBaseRef.current = null
    if (!base) return
    setDocs((current) => (current[base.docId]
      ? { ...current, [base.docId]: { ...current[base.docId], dragging: false } }
      : current))
  }, [])

  const selectNode = useCallback((docId: string, nodeId: string, mode: SelectMode) => {
    const target = docsRef.current[docId]
    if (!target?.scene) return
    const current = target.selection
    if (mode === 'toggle') {
      setSelection(docId, current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId])
      return
    }
    if (mode === 'range' && current.length) {
      const order = flattenScene(target.scene).map((row) => row.id)
      const from = order.indexOf(current[current.length - 1])
      const to = order.indexOf(nodeId)
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from]
        setSelection(docId, order.slice(start, end + 1))
        return
      }
    }
    setSelection(docId, [nodeId])
  }, [setSelection])

  // ---- 단축키 ----

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (event.key === 'Escape' && dialog) { event.preventDefault(); closeDialog(); return }
      if (event.key === 'F1') { event.preventDefault(); setDialog({ kind: 'shortcuts' }); return }

      // 입력 칸이나 편집기에 글자를 쓰는 중이면 단축키가 끼어들지 않게 한다
      const target = event.target as HTMLElement | null
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"], .cm-editor')
      const current = focusedId ? docsRef.current[focusedId] : null
      if (!typing && current?.scene && current.selection.length && focusedId) {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          updateScene(focusedId, current.selection.reduce((scene, id) => removeNode(scene, id), current.scene), [])
          return
        }
        if (mod && event.key.toLowerCase() === 'd') {
          event.preventDefault()
          const result = duplicateNode(current.scene, current.selection[current.selection.length - 1])
          if (result.id) updateScene(focusedId, result.scene, [result.id])
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setSelection(focusedId, [])
          return
        }
        if (!mod && ['g', 'r', 'h'].includes(event.key.toLowerCase())) {
          event.preventDefault()
          const key = event.key.toLowerCase()
          setGizmoMode(key === 'g' ? 'move' : key === 'r' ? 'rotate' : 'scale')
          return
        }
      }
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 's') { event.preventDefault(); void saveDocs(focusedId ? [focusedId] : [], true) }
      if (key === 'enter') { event.preventDefault(); if (focusedId) void execute(focusedId) }
      if (key === 'n') { event.preventDefault(); openNewDialog() }
      if (key === 'p') { event.preventDefault(); openView('projects'); window.setTimeout(() => searchRef.current?.focus(), 80) }
      if (key === 'e') { event.preventDefault(); setDialog({ kind: 'export' }) }
      if (key === ',') { event.preventDefault(); setDialog({ kind: 'settings' }) }
      if (key === 'b') { event.preventDefault(); toggleView('projects') }
      if (key === 'j') { event.preventDefault(); toggleView('console') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, closeDialog, saveDocs, execute, focusedId, openNewDialog, openView, toggleView, updateScene, setSelection])

  const filteredProjects = useMemo(
    () => index?.projects.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())) ?? [],
    [index?.projects, query],
  )

  if (!index || !settings) {
    return <div className="boot-screen"><Box size={32} /><span>JSCAD Studio 여는 중…</span></div>
  }

  const stats = dialog?.kind === 'export' && doc ? measureModel(doc.geometries) : null
  const openProjectIds = [...new Set((dock ? allTabs(dock) : []).map((tab) => readTab(tab).projectId).filter(Boolean))] as string[]

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

  const nodeMenu = (docId: string, nodeId: string, point: { x: number; y: number }) => {
    const target = docs[docId]
    const scene = target?.scene
    const node = scene?.nodes[nodeId]
    if (!scene || !node) return
    const picked = target.selection.includes(nodeId) && target.selection.length > 1 ? target.selection : [nodeId]
    const wrapInto = (factory: (input: Scene) => SceneNode) => () => {
      const result = groupInto(scene, picked, factory)
      if (result.id) updateScene(docId, result.scene, [result.id])
    }
    const many = picked.length > 1 ? ` ${picked.length}개` : ''

    setMenu({
      point,
      items: [
        { id: 'rename', label: '이름 바꾸기', icon: <Pencil size={15} />, onSelect: () => setRenaming(nodeId) },
        {
          id: 'duplicate',
          label: '복제',
          icon: <Copy size={15} />,
          onSelect: () => {
            const result = duplicateNode(scene, nodeId)
            if (result.id) updateScene(docId, result.scene, [result.id])
          },
        },
        { id: 'up', label: '위로 옮기기', icon: <ChevronRight size={15} />, onSelect: () => updateScene(docId, reorderNode(scene, nodeId, -1)) },
        { id: 'down', label: '아래로 옮기기', icon: <ChevronRight size={15} />, onSelect: () => updateScene(docId, reorderNode(scene, nodeId, 1)) },
        { id: 'group', label: `그룹으로 묶기${many}`, icon: <GroupIcon size={15} />, onSelect: wrapInto((input) => makeGroup(input)) },
        { id: 'stack', label: `적층으로 묶기${many}`, icon: <Layers size={15} />, onSelect: wrapInto((input) => makeStack(input)) },
        { id: 'subtract', label: `${BOOLEAN_LABELS.subtract}로 묶기${many}`, icon: <Diff size={15} />, onSelect: wrapInto((input) => makeBoolean(input, 'subtract')) },
        { id: 'union', label: `${BOOLEAN_LABELS.union}로 묶기${many}`, icon: <SquareStack size={15} />, onSelect: wrapInto((input) => makeBoolean(input, 'union')) },
        { id: 'intersect', label: `${BOOLEAN_LABELS.intersect}로 묶기${many}`, icon: <Boxes size={15} />, onSelect: wrapInto((input) => makeBoolean(input, 'intersect')) },
        ...(node.parent ? [{
          id: 'unparent',
          label: '최상위로 꺼내기',
          icon: <LayoutGrid size={15} />,
          onSelect: () => updateScene(docId, moveNode(scene, nodeId, null, scene.rootIds.length)),
        }] : []),
        {
          id: 'delete',
          label: `삭제${many}`,
          icon: <Trash2 size={15} />,
          danger: true,
          onSelect: () => updateScene(docId, picked.reduce((current, id) => removeNode(current, id), scene), []),
        },
      ],
    })
  }

  const describeTab = (tab: TabId): TabInfo => {
    const { kind, projectId } = readTab(tab)
    if (kind === 'projects') return { label: VIEW_LABELS.projects, icon: <FolderOpen size={14} /> }
    if (kind === 'shapes') return { label: VIEW_LABELS.shapes, icon: <Box size={14} /> }
    if (kind === 'console') return { label: VIEW_LABELS.console, icon: <Terminal size={14} /> }
    if (kind === 'objects') return { label: VIEW_LABELS.objects, icon: <Boxes size={14} /> }
    if (kind === 'inspector') return { label: VIEW_LABELS.inspector, icon: <Settings2 size={14} /> }
    if (kind === 'stack') return { label: VIEW_LABELS.stack, icon: <Layers size={14} /> }
    const target = projectId ? docs[projectId] : null
    const name = target?.project.name ?? index.projects.find((item) => item.id === projectId)?.name ?? '프로젝트'
    return kind === 'editor'
      ? { label: name, icon: <Code2 size={14} />, dirty: target?.dirty }
      : { label: `${name} 미리보기`, icon: <Eye size={14} /> }
  }

  /** 고른 객체의 형상만 따로 뽑아 뷰포트에서 다른 색으로 그린다 */
  const highlightOf = (target: OpenDoc) => {
    const scene = target.scene
    if (!scene || !target.selection.length) {
      return {
        rest: target.geometries,
        selected: [] as unknown[],
        box: null as SceneBox | null,
        origin: null as Vec3 | null,
        locked: [false, false, false],
      }
    }
    const picked = new Set(target.selection)
    const isRelated = (itemId: string) => picked.has(itemId)
      || ancestorsOf(scene, itemId).some((id) => picked.has(id))
      || target.selection.some((id) => ancestorsOf(scene, id).includes(itemId))
    const rest: unknown[] = []
    const selected: unknown[] = []
    for (const item of target.items) (isRelated(item.id) ? selected : rest).push(item.geometry)
    const boxes = target.selection.map((id) => target.layout[id]?.bounds).filter(Boolean) as SceneBox[]
    const box = boxes.length ? {
      min: [0, 1, 2].map((axis) => Math.min(...boxes.map((item) => item.min[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...boxes.map((item) => item.max[axis]))),
    } as SceneBox : null
    const origin = box
      ? [0, 1, 2].map((axis) => (box.min[axis] + box.max[axis]) / 2) as Vec3
      : null
    // 상대 배치나 적층이 잡고 있는 축은 기즈모로 끌 수 없다
    const focus = scene.nodes[target.selection[target.selection.length - 1]]
    const parent = focus?.parent ? scene.nodes[focus.parent] : null
    const locked = (['x', 'y', 'z'] as const).map((axis, index) => (
      !!focus?.anchor?.axes[axis] || (index === 2 && parent?.type === 'stack')
    ))
    return { rest, selected, box, origin, locked }
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
    if (kind === 'objects') {
      if (!doc || !focusedId) return <div className="dock-empty">프로젝트를 먼저 여세요.</div>
      if (!doc.scene) {
        return (
          <div className="visual-start">
            <span className="visual-start-icon"><Boxes /></span>
            <strong>시각 모드로 만들기</strong>
            <p className="muted-copy">
              도형을 객체로 놓고 트리·속성 패널에서 위치와 크기를 고칩니다.
              코드는 객체에서 자동으로 만들어지고, 언제든 코드 전용으로 되돌릴 수 있습니다.
            </p>
            <div className="visual-start-actions">
              <button className="button primary" onClick={() => startVisual(focusedId, true)}>기존 코드를 가져와 시작</button>
              <button className="button ghost" onClick={() => startVisual(focusedId, false)}>빈 장면으로 시작</button>
            </div>
            <p className="muted-copy">
              두 방법 모두 지금 코드를 코드 객체로 남깁니다. 빈 장면으로 시작하면 그 객체를 꺼 둔 채로 두므로,
              나중에 객체 트리에서 눈 아이콘을 눌러 다시 켜거나 지울 수 있습니다.
            </p>
          </div>
        )
      }
      return (
        <ObjectTree
          scene={doc.scene}
          selection={doc.selection}
          renamingId={renaming}
          onSelect={(nodeId, mode) => selectNode(focusedId, nodeId, mode)}
          onScene={(next) => updateScene(focusedId, next)}
          onMenu={(nodeId, point) => nodeMenu(focusedId, nodeId, point)}
          onRename={(nodeId, name) => {
            const trimmed = name.trim()
            if (trimmed && doc.scene) updateScene(focusedId, patchNode(doc.scene, nodeId, { name: trimmed }))
          }}
          onRenameEnd={() => setRenaming(null)}
          onAdd={(addKind) => createNode(focusedId, addKind)}
        />
      )
    }
    if (kind === 'inspector') {
      if (!doc?.scene || !focusedId) return <div className="dock-empty">시각 모드에서 객체를 고르면 여기에 나옵니다.</div>
      return (
        <Inspector
          scene={doc.scene}
          layout={doc.layout}
          selection={doc.selection}
          onScene={(next) => updateScene(focusedId, next)}
        />
      )
    }
    if (kind === 'stack') {
      if (!focusedId) return <div className="dock-empty">프로젝트를 먼저 여세요.</div>
      return (
        <StackEditor
          scene={doc?.scene ?? null}
          layout={doc?.layout ?? {}}
          selection={doc?.selection ?? []}
          onScene={(next) => updateScene(focusedId, next)}
          onSelect={(nodeId) => selectNode(focusedId, nodeId, 'single')}
          onCreate={() => {
            const target = docsRef.current[focusedId]
            const scene = target?.scene
            if (!scene) {
              createNode(focusedId, 'stack')
              return
            }
            if (target.selection.length) {
              const result = groupInto(scene, target.selection, (input) => makeStack(input))
              if (result.id) updateScene(focusedId, result.scene, [result.id])
              return
            }
            createNode(focusedId, 'stack')
          }}
        />
      )
    }
    const target = projectId ? docs[projectId] : null
    if (!projectId || !target) return <div className="dock-empty">불러오는 중…</div>
    if (kind === 'editor') {
      return (
        <div className="editor-host" data-editor-project={projectId} onPointerDown={() => setFocusedId(projectId)}>
          {isVisual(target) && (
            <div className="editor-banner">
              <Boxes size={15} />
              <span>시각 모드입니다. 이 코드는 객체 트리에서 자동으로 만들어집니다.</span>
              <button className="button ghost" onClick={() => stopVisual(projectId)}>코드 전용으로 전환</button>
            </div>
          )}
          <CodeEditor
            value={target.code}
            fontSize={settings.fontSize}
            readOnly={isVisual(target)}
            apiRef={apiRefFor(projectId)}
            onChange={(code) => updateCode(projectId, code)}
          />
        </div>
      )
    }
    const related = highlightOf(target)
    return (
      <div className="viewer-wrap" onPointerDown={() => setFocusedId(projectId)}>
        <Viewer
          geometries={related.rest}
          highlighted={related.selected}
          selectionBox={related.box}
          showGrid={showGrid}
          workplaneOffset={target.scene?.workplane.offset ?? 0}
          rotateSensitivity={settings.rotateSensitivity}
          zoomSensitivity={settings.zoomSensitivity}
          invertOrbitX={settings.invertOrbitX}
          fitToken={fitToken}
          gizmoMode={gizmoMode}
          gizmoOrigin={settings.gizmo ? related.origin : null}
          gizmoLockedAxes={related.locked}
          onGizmoStart={() => beginGizmo(projectId)}
          onGizmoMove={applyGizmo}
          onGizmoEnd={endGizmo}
          onPick={target.scene ? (ray) => pickAt(projectId, ray) : undefined}
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
          {doc?.scene && settings.gizmo && ([
            ['move', '이동', <Move3d size={16} key="m" />],
            ['rotate', '회전', <RotateCw size={16} key="r" />],
            ['scale', '크기', <Scale3d size={16} key="s" />],
          ] as [GizmoMode, string, React.ReactNode][]).map(([mode, label, icon]) => (
            <button
              key={mode}
              className={`icon-button tiny${gizmoMode === mode ? ' selected' : ''}`}
              onClick={() => setGizmoMode(mode)}
              aria-label={`${label} 기즈모`}
              title={`${label} 기즈모`}
            >
              {icon}
            </button>
          ))}
          <button className="icon-button tiny" onClick={() => setFitToken((value) => value + 1)} aria-label="화면 맞춤" title="모델을 화면에 맞춘다">
            <Maximize size={16} />
          </button>
          <button className={`icon-button tiny${showGrid ? ' selected' : ''}`} onClick={() => setShowGrid((value) => !value)} aria-label="그리드 토글">
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
          <button className="icon-button" onClick={() => setDialog({ kind: 'export' })} aria-label="내보내기" title="STL·3MF 내보내기 (Ctrl E)"><Download size={19} /></button>
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
        <button onClick={() => toggleView('objects')} title="객체 트리"><Boxes size={13} />객체</button>
        <button onClick={() => toggleView('inspector')} title="속성 패널"><Settings2 size={13} />속성</button>
        <button onClick={() => toggleView('stack')} title="적층 편집기"><Layers size={13} />적층</button>
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
            <div className="field"><span>시작 템플릿</span><div className="template-grid">{(Object.keys(TEMPLATE_LABELS) as ProjectTemplate[]).map((key) => <button key={key} className={newTemplate === key ? 'selected' : ''} onClick={() => setNewTemplate(key)}><span className="template-icon">{key === 'visual' ? <Boxes /> : key === 'keycap' ? <Box /> : key === 'plate' ? <Grid3X3 /> : <Code2 />}</span><strong>{TEMPLATE_LABELS[key]}</strong></button>)}</div></div>
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
            <Toggle
              checked={settings.gizmo}
              onChange={(gizmo) => updateSettings({ gizmo })}
              label="뷰포트 직접 조작"
              description="고른 객체에 이동·회전·크기 손잡이를 표시"
            />
            <Toggle
              checked={settings.invertOrbitX}
              onChange={(invertOrbitX) => updateSettings({ invertOrbitX })}
              label="가로 회전 방향 뒤집기"
              description="좌우로 끌 때 도는 방향이 손에 맞지 않으면 켜세요"
            />
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
          {dialog.kind === 'licenses' && <Licenses />}
          {dialog.kind === 'shortcuts' && <div className="shortcut-grid">
            <span>실행</span><kbd>Ctrl Enter</kbd><span>저장</span><kbd>Ctrl S</kbd><span>새 프로젝트</span><kbd>Ctrl N</kbd><span>프로젝트 검색</span><kbd>Ctrl P</kbd><span>프로젝트 패널</span><kbd>Ctrl B</kbd><span>출력 패널</span><kbd>Ctrl J</kbd><span>내보내기</span><kbd>Ctrl E</kbd><span>설정</span><kbd>Ctrl ,</kbd><span>자동완성</span><kbd>Ctrl Space</kbd><span>객체 복제</span><kbd>Ctrl D</kbd><span>이동·회전·크기 기즈모</span><kbd>G R H</kbd><span>객체 삭제</span><kbd>Delete</kbd><span>선택 해제 · 창 닫기</span><kbd>Esc</kbd>
          </div>}
        </Modal>
      )}

      <div className="toast-stack" aria-live="polite">{toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}><span />{item.message}</div>)}</div>
    </div>
  )
}
