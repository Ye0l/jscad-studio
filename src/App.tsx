import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Box, Braces, ChevronRight, CircleHelp, Code2, Eye, FolderOpen, Grid3X3,
  Menu, MoreVertical, Play, Plus, Save, Search, Settings, Trash2, X,
} from 'lucide-react'
import { CodeEditor } from './components/CodeEditor'
import { Licenses } from './components/Licenses'
import { Modal } from './components/Modal'
import { Toggle } from './components/Toggle'
import { Viewer } from './components/Viewer'
import { runJscad } from './jscadRunner'
import { storage } from './storage'
import { TEMPLATE_LABELS } from './templates'
import type { AppSettings, DialogState, Project, ProjectIndex, ProjectTemplate } from './types'

interface ToastState { id: number; message: string; tone: 'success' | 'error' | 'info' }

const DIALOG_TITLES: Record<NonNullable<DialogState>['kind'], string> = {
  new: '새 프로젝트',
  rename: '프로젝트 관리',
  delete: '프로젝트 삭제',
  settings: '설정',
  shortcuts: '키보드 단축키',
  licenses: '오픈소스 라이선스',
}

const formatTime = (iso: string) => new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

export function App() {
  const [index, setIndex] = useState<ProjectIndex | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [geometries, setGeometries] = useState<unknown[]>([])
  const [runState, setRunState] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [runMessage, setRunMessage] = useState('준비 중…')
  const [dirty, setDirty] = useState(false)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dialogClosing, setDialogClosing] = useState(false)
  const [newName, setNewName] = useState('새 프로젝트')
  const [newTemplate, setNewTemplate] = useState<ProjectTemplate>('blank')
  const [renameValue, setRenameValue] = useState('')
  const [query, setQuery] = useState('')
  const [showGrid, setShowGrid] = useState(true)
  const [toasts, setToasts] = useState<ToastState[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const saveTimerRef = useRef<number | null>(null)

  const settings = index?.settings
  const motion = settings?.motion ?? true

  const toast = useCallback((message: string, tone: ToastState['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((items) => [...items, { id, message, tone }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3100)
  }, [])

  useEffect(() => {
    storage.initialize()
      .then(({ index: loadedIndex, active }) => {
        setIndex(loadedIndex)
        setProject(active)
      })
      .catch((error) => {
        setRunState('error')
        setRunMessage(`저장소 초기화 실패: ${String(error)}`)
        toast('프로젝트 저장소를 열지 못했습니다.', 'error')
      })
  }, [toast])

  useEffect(() => {
    document.documentElement.classList.toggle('motion-off', !motion)
  }, [motion])

  const execute = useCallback(async (code = project?.code) => {
    if (!code) return
    setRunState('running')
    setRunMessage('모델 계산 중…')
    try {
      const result = await runJscad(code)
      setGeometries(result.geometries)
      setRunState('success')
      setRunMessage(`${result.geometries.length}개 형상 · ${result.durationMs.toFixed(1)}ms`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRunState('error')
      setRunMessage(message)
    }
  }, [project?.code])

  useEffect(() => {
    if (!project) return
    void execute(project.code)
    // Run once when switching projects; live runs are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  useEffect(() => {
    if (!project || !settings?.autoRun || !dirty) return
    const timer = window.setTimeout(() => void execute(project.code), 480)
    return () => window.clearTimeout(timer)
  }, [project?.code, project, settings?.autoRun, dirty, execute])

  const buildSavedState = useCallback((target: Project, sourceIndex: ProjectIndex) => {
    const saved = { ...target, updatedAt: new Date().toISOString() }
    const nextIndex = {
      ...sourceIndex,
      activeProjectId: saved.id,
      projects: sourceIndex.projects.map((item) => item.id === saved.id
        ? { id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt }
        : item),
    }
    if (!nextIndex.projects.some((item) => item.id === saved.id)) {
      nextIndex.projects.unshift({ id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt })
    }
    return { saved, nextIndex }
  }, [])

  const saveNow = useCallback(async (announce = true) => {
    if (!project || !index) return
    const { saved, nextIndex } = buildSavedState(project, index)
    try {
      await storage.saveProject(saved, nextIndex)
      setProject(saved)
      setIndex(nextIndex)
      setDirty(false)
      if (announce) toast('프로젝트를 저장했습니다.', 'success')
    } catch (error) {
      toast(`저장 실패: ${String(error)}`, 'error')
    }
  }, [project, index, buildSavedState, toast])

  useEffect(() => {
    if (!project || !index || !dirty || !settings?.autoSave) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void saveNow(false), 850)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [project?.code, project, index, dirty, settings?.autoSave, saveNow])

  const closeDialog = useCallback((after?: () => void) => {
    if (!dialog) return
    if (!motion) {
      setDialog(null)
      after?.()
      return
    }
    setDialogClosing(true)
    window.setTimeout(() => {
      setDialog(null)
      setDialogClosing(false)
      after?.()
    }, 170)
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
    setProject(created)
    setDirty(false)
    toast(`${created.name} 프로젝트를 만들었습니다.`, 'success')
  }, [index, newName, newTemplate, toast])

  const switchProject = useCallback(async (id: string) => {
    if (!index || project?.id === id) return
    if (dirty && project) await saveNow(false)
    const meta = index.projects.find((item) => item.id === id)
    if (!meta) return
    try {
      const loaded = await storage.loadProject(meta)
      const nextIndex = { ...index, activeProjectId: id }
      await storage.saveIndex(nextIndex)
      setIndex(nextIndex)
      setProject(loaded)
      setDirty(false)
    } catch (error) {
      toast(`프로젝트 열기 실패: ${String(error)}`, 'error')
    }
  }, [index, project, dirty, saveNow, toast])

  const renameProject = useCallback(async () => {
    if (!index || !project || !renameValue.trim()) return
    const renamed = { ...project, name: renameValue.trim(), updatedAt: new Date().toISOString() }
    const { nextIndex } = buildSavedState(renamed, index)
    await storage.saveProject(renamed, nextIndex)
    setProject(renamed)
    setIndex(nextIndex)
    setDirty(false)
    toast('프로젝트 이름을 바꿨습니다.', 'success')
  }, [index, project, renameValue, buildSavedState, toast])

  const deleteProject = useCallback(async () => {
    if (!index || !project) return
    if (index.projects.length === 1) {
      toast('마지막 프로젝트는 삭제할 수 없습니다.', 'error')
      return
    }
    const remaining = index.projects.filter((item) => item.id !== project.id)
    const nextMeta = remaining[0]
    const nextIndex = { ...index, activeProjectId: nextMeta.id, projects: remaining }
    await storage.deleteProject(project.id, nextIndex)
    const loaded = await storage.loadProject(nextMeta)
    setIndex(nextIndex)
    setProject(loaded)
    setDirty(false)
    toast('프로젝트를 삭제했습니다.', 'success')
  }, [index, project, toast])

  const updateSettings = useCallback((changes: Partial<AppSettings>) => {
    if (!index) return
    const next = { ...index, settings: { ...index.settings, ...changes } }
    setIndex(next)
    void storage.saveIndex(next).catch((error) => toast(`설정 저장 실패: ${String(error)}`, 'error'))
  }, [index, toast])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (event.key === 'Escape' && dialog) {
        event.preventDefault(); closeDialog(); return
      }
      if (event.key === 'F1') {
        event.preventDefault(); setDialog({ kind: 'shortcuts' }); return
      }
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 's') { event.preventDefault(); void saveNow() }
      if (key === 'enter') { event.preventDefault(); void execute() }
      if (key === 'n') { event.preventDefault(); openNewDialog() }
      if (key === 'p') { event.preventDefault(); updateSettings({ sidebarOpen: true }); setTimeout(() => searchRef.current?.focus(), 80) }
      if (key === ',') { event.preventDefault(); setDialog({ kind: 'settings' }) }
      if (key === 'b') { event.preventDefault(); updateSettings({ sidebarOpen: !settings?.sidebarOpen }) }
      if (key === 'j') { event.preventDefault(); updateSettings({ consoleOpen: !settings?.consoleOpen }) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, closeDialog, saveNow, execute, openNewDialog, updateSettings, settings?.sidebarOpen, settings?.consoleOpen])

  const filteredProjects = useMemo(() => index?.projects.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())) ?? [], [index?.projects, query])

  if (!index || !project || !settings) {
    return <div className="boot-screen"><Box size={32} /><span>JSCAD Studio 여는 중…</span></div>
  }

  return (
    <div
      className={`app-shell${settings.sidebarOpen ? '' : ' sidebar-closed'}${settings.consoleOpen ? ' console-open' : ''}`}
      style={{
        width: `${100 / settings.uiScale}%`,
        height: `${100 / settings.uiScale}%`,
        transform: `scale(${settings.uiScale})`,
        transformOrigin: 'top left',
      } as CSSProperties}
    >
      <header className="topbar">
        <div className="brand">
          <button className="icon-button sidebar-toggle" onClick={() => updateSettings({ sidebarOpen: !settings.sidebarOpen })} aria-label="프로젝트 패널 토글"><Menu size={20} /></button>
          <div className="brand-mark"><Braces size={20} /></div>
          <span>JSCAD Studio</span>
          <ChevronRight size={15} className="muted" />
          <strong>{project.name}</strong>
          {dirty && <span className="dirty-dot" title="저장되지 않은 변경" />}
        </div>
        <div className="top-actions">
          <button className="button ghost" onClick={() => void saveNow()}><Save size={17} /><span>저장</span><kbd>Ctrl S</kbd></button>
          <button className="button primary" onClick={() => void execute()} disabled={runState === 'running'}><Play size={17} fill="currentColor" /><span>실행</span><kbd>Ctrl ↵</kbd></button>
          <button className="icon-button" onClick={() => setDialog({ kind: 'settings' })} aria-label="설정"><Settings size={19} /></button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="panel-heading"><span>프로젝트</span><button className="icon-button tiny" onClick={openNewDialog} aria-label="새 프로젝트"><Plus size={17} /></button></div>
          <label className="search-box"><Search size={15} /><input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="프로젝트 검색" /><kbd>Ctrl P</kbd></label>
          <nav className="project-list">
            {filteredProjects.map((item) => (
              <button key={item.id} className={`project-item${item.id === project.id ? ' active' : ''}`} onClick={() => void switchProject(item.id)}>
                <span className="project-icon"><Code2 size={17} /></span>
                <span className="project-copy"><strong>{item.name}</strong><small>{formatTime(item.updatedAt)}</small></span>
                {item.id === project.id && <span className="active-pip" />}
              </button>
            ))}
          </nav>
          <button className="new-project-button" onClick={openNewDialog}><Plus size={17} />새 프로젝트 <kbd>Ctrl N</kbd></button>
        </aside>

        <section className="editor-panel">
          <div className="panel-heading tab-heading">
            <span><Code2 size={15} />main.jscad</span>
            <div>
              <button className="icon-button tiny" onClick={() => { setRenameValue(project.name); setDialog({ kind: 'rename', project }) }} aria-label="프로젝트 메뉴"><MoreVertical size={17} /></button>
            </div>
          </div>
          <CodeEditor
            value={project.code}
            fontSize={settings.fontSize}
            onChange={(code) => { setProject((current) => current ? { ...current, code } : current); setDirty(true) }}
          />
        </section>

        <section className="preview-panel">
          <div className="panel-heading preview-heading">
            <span><Eye size={15} />3D 미리보기</span>
            <div className="preview-actions">
              <button className={`icon-button tiny${showGrid ? ' selected' : ''}`} onClick={() => setShowGrid((value) => !value)} aria-label="그리드 토글"><Grid3X3 size={17} /></button>
            </div>
          </div>
          <div className="viewer-wrap">
            <Viewer
              geometries={geometries}
              showGrid={showGrid}
              rotateSensitivity={settings.rotateSensitivity}
              zoomSensitivity={settings.zoomSensitivity}
            />
            <div className="viewer-hint">드래그: 회전 · Shift+드래그: 이동 · 휠/핀치: 확대</div>
            {runState === 'error' && <div className="error-overlay"><X size={18} /><span>{runMessage}</span></div>}
          </div>
        </section>
      </main>

      <section className="console-panel" aria-hidden={!settings.consoleOpen}>
        <div className="console-heading"><span>출력</span><button className="icon-button tiny" onClick={() => updateSettings({ consoleOpen: false })}><X size={16} /></button></div>
        <pre className={runState === 'error' ? 'error-text' : ''}>{runMessage}</pre>
      </section>

      <footer className="statusbar">
        <button onClick={() => updateSettings({ consoleOpen: !settings.consoleOpen })} className={`run-status ${runState}`}><span />{runState === 'error' ? '오류' : runState === 'running' ? '실행 중' : '준비됨'}</button>
        <span>{runMessage}</span>
        <span className="status-spacer" />
        <span>{dirty ? (settings.autoSave ? '자동 저장 대기' : '저장 필요') : '저장됨'}</span>
        <button onClick={() => setDialog({ kind: 'shortcuts' })}>F1 단축키</button>
      </footer>

      {dialog && (
        <Modal
          title={DIALOG_TITLES[dialog.kind]}
          closing={dialogClosing}
          onClose={() => closeDialog()}
          footer={dialog.kind === 'new' ? <><button className="button ghost" onClick={() => closeDialog()}>취소</button><button className="button primary" disabled={!newName.trim()} onClick={() => closeDialog(() => void createProject())}>만들기</button></>
            : dialog.kind === 'rename' ? <><button className="button danger" onClick={() => closeDialog(() => setDialog({ kind: 'delete', project }))}><Trash2 size={16} />삭제</button><span className="footer-spacer" /><button className="button ghost" onClick={() => closeDialog()}>취소</button><button className="button primary" disabled={!renameValue.trim()} onClick={() => closeDialog(() => void renameProject())}>저장</button></>
              : dialog.kind === 'delete' ? <><button className="button ghost" onClick={() => closeDialog()}>취소</button><button className="button danger" onClick={() => closeDialog(() => void deleteProject())}>삭제</button></>
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
            <button className="settings-link" onClick={() => setDialog({ kind: 'licenses' })}><span><strong>오픈소스 라이선스</strong><small>이 앱이 포함한 소프트웨어의 저작권과 라이선스 원문</small></span><ChevronRight size={17} /></button>
          </div>}
          {dialog.kind === 'licenses' && <Licenses />}
          {dialog.kind === 'shortcuts' && <div className="shortcut-grid">
            <span>실행</span><kbd>Ctrl Enter</kbd><span>저장</span><kbd>Ctrl S</kbd><span>새 프로젝트</span><kbd>Ctrl N</kbd><span>프로젝트 검색</span><kbd>Ctrl P</kbd><span>프로젝트 패널</span><kbd>Ctrl B</kbd><span>출력 패널</span><kbd>Ctrl J</kbd><span>설정</span><kbd>Ctrl ,</kbd><span>창 닫기</span><kbd>Esc</kbd>
          </div>}
        </Modal>
      )}

      <div className="toast-stack" aria-live="polite">{toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}><span />{item.message}</div>)}</div>
    </div>
  )
}
