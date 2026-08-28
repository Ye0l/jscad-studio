import type { DockNode } from './dock/types'
import type { GitSettings } from './git'

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
  /** 도크 레이아웃. 처음 실행이거나 저장본이 깨졌으면 null */
  dock: DockNode | null
  /** GitHub 연동 설정. 연결 전에는 null */
  git: GitSettings | null
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
  | { kind: 'export' }
  | { kind: 'git' }
  | { kind: 'render' }
  | null
