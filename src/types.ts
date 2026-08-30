import type { DockNode } from './dock/types'
import type { GitSettings } from './git'

export type ProjectTemplate = 'visual' | 'blank' | 'keycap' | 'plate'

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
  /** 가로로 끌 때 도는 방향. 손가락을 따라오게 할지, 반대로 돌릴지 */
  invertOrbitX: boolean
  /** 뷰포트에서 객체를 직접 끌어 옮기는 기즈모 */
  gizmo: boolean
  /** 코드를 다시 실행할 때 미리보기 카메라를 모델에 맞출지 */
  autoFit: boolean
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
