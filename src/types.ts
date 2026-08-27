export type ProjectTemplate = 'blank' | 'keycap' | 'plate'

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface Project extends ProjectMeta {
  code: string
}

export interface AppSettings {
  motion: boolean
  autoRun: boolean
  autoSave: boolean
  fontSize: number
  uiScale: number
  rotateSensitivity: number
  zoomSensitivity: number
  sidebarOpen: boolean
  consoleOpen: boolean
}

export interface ProjectIndex {
  version: 1
  activeProjectId: string | null
  projects: ProjectMeta[]
  settings: AppSettings
}

export interface RunResult {
  geometries: unknown[]
  durationMs: number
}

export type DialogState =
  | { kind: 'new' }
  | { kind: 'rename'; project: Project }
  | { kind: 'delete'; project: Project }
  | { kind: 'settings' }
  | { kind: 'shortcuts' }
  | { kind: 'licenses' }
  | null
