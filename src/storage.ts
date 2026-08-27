import { BaseDirectory, exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { TEMPLATES } from './templates'
import type { AppSettings, Project, ProjectIndex, ProjectMeta, ProjectTemplate } from './types'

const ROOT = 'jscad-studio'
const PROJECTS_DIR = `${ROOT}/projects`
const INDEX_PATH = `${ROOT}/index.json`
const BROWSER_KEY = 'jscad-studio:data:v1'

export const DEFAULT_SETTINGS: AppSettings = {
  motion: true,
  autoRun: true,
  autoSave: true,
  fontSize: 15,
  uiScale: 1,
  rotateSensitivity: 0.3,
  zoomSensitivity: 0.35,
  sidebarOpen: true,
  consoleOpen: false,
  sidebarWidth: 248,
  splitRatio: 0.45,
  consoleHeight: 150,
}

const isTauri = () => '__TAURI_INTERNALS__' in window

const browserLoad = (): { index: ProjectIndex; files: Record<string, string> } | null => {
  const raw = localStorage.getItem(BROWSER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const browserSave = (index: ProjectIndex, files: Record<string, string>) => {
  localStorage.setItem(BROWSER_KEY, JSON.stringify({ index, files }))
}

const makeProject = (name: string, template: ProjectTemplate): Project => {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name,
    code: TEMPLATES[template],
    createdAt: now,
    updatedAt: now,
  }
}

const toMeta = ({ code: _code, ...meta }: Project): ProjectMeta => meta

const defaultWorkspace = () => {
  const project = makeProject('키캡 시작하기', 'keycap')
  const index: ProjectIndex = {
    version: 1,
    activeProjectId: project.id,
    projects: [toMeta(project)],
    settings: DEFAULT_SETTINGS,
  }
  return { index, project }
}

const ensureNativeDirs = async () => {
  if (!(await exists(ROOT, { baseDir: BaseDirectory.AppLocalData }))) {
    await mkdir(ROOT, { baseDir: BaseDirectory.AppLocalData, recursive: true })
  }
  if (!(await exists(PROJECTS_DIR, { baseDir: BaseDirectory.AppLocalData }))) {
    await mkdir(PROJECTS_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true })
  }
}

export const storage = {
  async initialize(): Promise<{ index: ProjectIndex; active: Project }> {
    if (!isTauri()) {
      const saved = browserLoad()
      if (saved?.index.projects.length) {
        const id = saved.index.activeProjectId ?? saved.index.projects[0].id
        const meta = saved.index.projects.find((item) => item.id === id) ?? saved.index.projects[0]
        const index = { ...saved.index, settings: { ...DEFAULT_SETTINGS, ...saved.index.settings } }
        return { index, active: { ...meta, code: saved.files[meta.id] ?? TEMPLATES.blank } }
      }
      const initial = defaultWorkspace()
      browserSave(initial.index, { [initial.project.id]: initial.project.code })
      return { index: initial.index, active: initial.project }
    }

    await ensureNativeDirs()
    if (!(await exists(INDEX_PATH, { baseDir: BaseDirectory.AppLocalData }))) {
      const initial = defaultWorkspace()
      await writeTextFile(`${PROJECTS_DIR}/${initial.project.id}.jscad`, initial.project.code, { baseDir: BaseDirectory.AppLocalData })
      await writeTextFile(INDEX_PATH, JSON.stringify(initial.index, null, 2), { baseDir: BaseDirectory.AppLocalData })
      return { index: initial.index, active: initial.project }
    }

    const index = JSON.parse(await readTextFile(INDEX_PATH, { baseDir: BaseDirectory.AppLocalData })) as ProjectIndex
    index.settings = { ...DEFAULT_SETTINGS, ...index.settings }
    const id = index.activeProjectId ?? index.projects[0]?.id
    if (!id) {
      const initial = defaultWorkspace()
      await this.saveProject(initial.project, initial.index)
      return { index: initial.index, active: initial.project }
    }
    const meta = index.projects.find((item) => item.id === id) ?? index.projects[0]
    const code = await readTextFile(`${PROJECTS_DIR}/${meta.id}.jscad`, { baseDir: BaseDirectory.AppLocalData })
    return { index, active: { ...meta, code } }
  },

  async loadProject(meta: ProjectMeta): Promise<Project> {
    if (!isTauri()) {
      const saved = browserLoad()
      return { ...meta, code: saved?.files[meta.id] ?? TEMPLATES.blank }
    }
    const code = await readTextFile(`${PROJECTS_DIR}/${meta.id}.jscad`, { baseDir: BaseDirectory.AppLocalData })
    return { ...meta, code }
  },

  async saveProject(project: Project, index: ProjectIndex): Promise<void> {
    const nextIndex: ProjectIndex = {
      ...index,
      activeProjectId: project.id,
      projects: index.projects.map((item) => item.id === project.id ? toMeta(project) : item),
    }
    if (!nextIndex.projects.some((item) => item.id === project.id)) nextIndex.projects.unshift(toMeta(project))

    if (!isTauri()) {
      const files = browserLoad()?.files ?? {}
      browserSave(nextIndex, { ...files, [project.id]: project.code })
      return
    }
    await ensureNativeDirs()
    await writeTextFile(`${PROJECTS_DIR}/${project.id}.jscad`, project.code, { baseDir: BaseDirectory.AppLocalData })
    await writeTextFile(INDEX_PATH, JSON.stringify(nextIndex, null, 2), { baseDir: BaseDirectory.AppLocalData })
  },

  async saveIndex(index: ProjectIndex): Promise<void> {
    if (!isTauri()) {
      browserSave(index, browserLoad()?.files ?? {})
      return
    }
    await ensureNativeDirs()
    await writeTextFile(INDEX_PATH, JSON.stringify(index, null, 2), { baseDir: BaseDirectory.AppLocalData })
  },

  async deleteProject(id: string, index: ProjectIndex): Promise<void> {
    const next = { ...index, projects: index.projects.filter((item) => item.id !== id) }
    if (!isTauri()) {
      const files = browserLoad()?.files ?? {}
      delete files[id]
      browserSave(next, files)
      return
    }
    const path = `${PROJECTS_DIR}/${id}.jscad`
    if (await exists(path, { baseDir: BaseDirectory.AppLocalData })) {
      await remove(path, { baseDir: BaseDirectory.AppLocalData })
    }
    await writeTextFile(INDEX_PATH, JSON.stringify(next, null, 2), { baseDir: BaseDirectory.AppLocalData })
  },

  create(name: string, template: ProjectTemplate) {
    return makeProject(name, template)
  },
}
