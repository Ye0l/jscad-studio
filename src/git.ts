// GitHub Contents API 로 프로젝트를 저장소 한 곳에 올리고 내려받는다.
// 실제 git 프로토콜은 브라우저에서 CORS 프록시가 필요하지만 REST API 는 그대로 쓸 수 있어
// 웹 빌드와 Tauri 빌드가 같은 코드로 동작한다.
import type { Project, ProjectMeta } from './types'

const API = 'https://api.github.com'
export const MANIFEST_FILE = 'jscad-studio.json'

export interface GitSettings {
  token: string
  /** owner/name */
  repo: string
  branch: string
  /** 저장소 안의 폴더. 빈 값이면 저장소 루트 */
  folder: string
}

export const EMPTY_GIT: GitSettings = { token: '', repo: '', branch: 'main', folder: 'projects' }

export type SyncStatus = 'same' | 'onlyLocal' | 'onlyRemote' | 'changed'

export interface SyncItem {
  id: string
  name: string
  file: string
  path: string
  status: SyncStatus
  remoteSha?: string
}

interface ManifestEntry { id: string; name: string; file: string; updatedAt: string }
interface Manifest { version: 1; projects: ManifestEntry[] }

interface ContentEntry { name: string; path: string; sha: string; type: string }

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const fromBase64 = (value: string) => {
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** git 이 파일에 매기는 해시. 내용을 내려받지 않고도 원격과 같은지 비교할 수 있다 */
export const blobSha = async (text: string) => {
  const body = new TextEncoder().encode(text)
  const header = new TextEncoder().encode(`blob ${body.length}`)
  // git 헤더는 길이 뒤에 NUL 바이트가 온다
  const buffer = new Uint8Array(header.length + 1 + body.length)
  buffer.set(header)
  buffer[header.length] = 0
  buffer.set(body, header.length + 1)
  const digest = await crypto.subtle.digest('SHA-1', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const safeFileName = (name: string) =>
  (name.trim().replace(/^\.+|\.+$/g, '').replace(/[\\/:*?"<>| ]/g, '_').slice(0, 80) || 'project')

const joinPath = (folder: string, file: string) => (folder ? `${folder.replace(/^\/+|\/+$/g, '')}/${file}` : file)
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

const describe = (status: number, body: string) => {
  if (status === 401) return '토큰이 올바르지 않거나 만료되었습니다.'
  if (status === 403) return '토큰 권한이 부족하거나 요청 한도를 넘었습니다. Contents 읽기·쓰기 권한을 확인하세요.'
  if (status === 409) return '원격이 그사이 바뀌었습니다. 다시 비교한 뒤 시도하세요.'
  if (status === 422) return `요청을 처리하지 못했습니다: ${body.slice(0, 160)}`
  return `GitHub 오류 ${status}: ${body.slice(0, 160)}`
}

class NotFound extends Error {}

const request = async <T,>(settings: GitSettings, path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${settings.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (response.status === 404) throw new NotFound('저장소나 경로를 찾을 수 없습니다.')
  if (!response.ok) throw new Error(describe(response.status, await response.text()))
  return response.status === 204 ? (null as T) : (await response.json() as T)
}

export const checkRepo = async (settings: GitSettings) => {
  try {
    const repo = await request<{ full_name: string; default_branch: string; private: boolean; permissions?: { push?: boolean } }>(
      settings, `/repos/${settings.repo}`,
    )
    return {
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      canPush: repo.permissions?.push !== false,
    }
  } catch (error) {
    if (error instanceof NotFound) throw new Error('저장소를 찾을 수 없습니다. 이름과 토큰 권한을 확인하세요.')
    throw error
  }
}

const listFolder = async (settings: GitSettings): Promise<ContentEntry[]> => {
  const folder = settings.folder.replace(/^\/+|\/+$/g, '')
  const path = folder ? `/${encodePath(folder)}` : ''
  try {
    const entries = await request<ContentEntry[] | ContentEntry>(
      settings, `/repos/${settings.repo}/contents${path}?ref=${encodeURIComponent(settings.branch)}`,
    )
    return Array.isArray(entries) ? entries : []
  } catch (error) {
    // 폴더가 아직 없으면 처음 올리는 것이므로 빈 목록으로 본다
    if (error instanceof NotFound) return []
    throw error
  }
}

const readFile = async (settings: GitSettings, path: string) => {
  const file = await request<{ content: string; encoding: string; sha: string }>(
    settings, `/repos/${settings.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(settings.branch)}`,
  )
  return { text: file.encoding === 'base64' ? fromBase64(file.content) : file.content, sha: file.sha }
}

const readManifest = async (settings: GitSettings, entries: ContentEntry[]): Promise<Manifest> => {
  const found = entries.find((entry) => entry.name === MANIFEST_FILE)
  if (!found) return { version: 1, projects: [] }
  try {
    const parsed = JSON.parse((await readFile(settings, found.path)).text) as Manifest
    return Array.isArray(parsed?.projects) ? { version: 1, projects: parsed.projects } : { version: 1, projects: [] }
  } catch {
    return { version: 1, projects: [] }
  }
}

/** 같은 이름이 겹치면 id 앞자리를 붙여 파일을 구분한다 */
const fileNameFor = (project: ProjectMeta, taken: Map<string, string>) => {
  const base = safeFileName(project.name)
  const candidate = `${base}.jscad`
  const owner = taken.get(candidate)
  if (!owner || owner === project.id) {
    taken.set(candidate, project.id)
    return candidate
  }
  const unique = `${base}-${project.id.slice(0, 6)}.jscad`
  taken.set(unique, project.id)
  return unique
}

export interface Comparison {
  items: SyncItem[]
  manifest: Manifest
  entries: ContentEntry[]
}

/** 로컬 프로젝트와 원격 파일을 맞춰 본다. 내용 비교는 blob 해시로 해서 파일을 내려받지 않는다 */
export const compare = async (settings: GitSettings, projects: Project[]): Promise<Comparison> => {
  const entries = await listFolder(settings)
  const manifest = await readManifest(settings, entries)
  const files = entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.jscad'))

  const byFile = new Map(files.map((entry) => [entry.name, entry]))
  const idByFile = new Map(manifest.projects.map((entry) => [entry.file, entry.id]))
  const taken = new Map<string, string>(manifest.projects.map((entry) => [entry.file, entry.id]))

  const items: SyncItem[] = []
  const usedFiles = new Set<string>()

  for (const project of projects) {
    const known = manifest.projects.find((entry) => entry.id === project.id)
    const file = known?.file ?? fileNameFor(project, taken)
    usedFiles.add(file)
    const remote = byFile.get(file)
    const localSha = await blobSha(project.code)
    items.push({
      id: project.id,
      name: project.name,
      file,
      path: joinPath(settings.folder, file),
      remoteSha: remote?.sha,
      status: !remote ? 'onlyLocal' : remote.sha === localSha ? 'same' : 'changed',
    })
  }

  // 원격에만 있는 파일은 다른 기기에서 올린 프로젝트다
  for (const entry of files) {
    if (usedFiles.has(entry.name)) continue
    items.push({
      id: idByFile.get(entry.name) ?? crypto.randomUUID(),
      name: manifest.projects.find((record) => record.file === entry.name)?.name ?? entry.name.replace(/\.jscad$/, ''),
      file: entry.name,
      path: entry.path,
      remoteSha: entry.sha,
      status: 'onlyRemote',
    })
  }

  return { items: items.sort((a, b) => a.name.localeCompare(b.name)), manifest, entries }
}

const putFile = (settings: GitSettings, path: string, text: string, message: string, sha?: string) =>
  request<{ content: { sha: string } }>(settings, `/repos/${settings.repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: toBase64(text), branch: settings.branch, ...(sha ? { sha } : {}) }),
  })

const deleteFile = (settings: GitSettings, path: string, message: string, sha: string) =>
  request(settings, `/repos/${settings.repo}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: settings.branch }),
  })

const writeManifest = (settings: GitSettings, comparison: Comparison, projects: ManifestEntry[]) => {
  const existing = comparison.entries.find((entry) => entry.name === MANIFEST_FILE)
  const manifest: Manifest = { version: 1, projects }
  return putFile(
    settings,
    joinPath(settings.folder, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'JSCAD Studio: 목록 갱신',
    existing?.sha,
  )
}

/** 고른 프로젝트를 올리고 매니페스트를 갱신한다 */
export const push = async (settings: GitSettings, projects: Project[], items: SyncItem[], comparison: Comparison) => {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const entries = [...comparison.manifest.projects]
  let count = 0

  for (const item of items) {
    const project = byId.get(item.id)
    if (!project) continue
    await putFile(settings, item.path, project.code, `JSCAD Studio: ${project.name} 저장`, item.remoteSha)
    const record: ManifestEntry = { id: project.id, name: project.name, file: item.file, updatedAt: project.updatedAt }
    const at = entries.findIndex((entry) => entry.id === project.id)
    if (at >= 0) entries[at] = record
    else entries.push(record)
    count += 1
  }

  if (count) await writeManifest(settings, comparison, entries)
  return count
}

/** 고른 항목의 원격 코드를 읽어 온다. 저장은 호출한 쪽에서 한다 */
export const pull = async (settings: GitSettings, items: SyncItem[]) => {
  const results: { id: string; name: string; code: string }[] = []
  for (const item of items) {
    const file = await readFile(settings, item.path)
    results.push({ id: item.id, name: item.name, code: file.text })
  }
  return results
}

/** 원격 파일을 지운다 (로컬에서 지운 프로젝트 정리용) */
export const removeRemote = async (settings: GitSettings, items: SyncItem[], comparison: Comparison) => {
  let count = 0
  for (const item of items) {
    if (!item.remoteSha) continue
    await deleteFile(settings, item.path, `JSCAD Studio: ${item.name} 삭제`, item.remoteSha)
    count += 1
  }
  if (count) {
    const removed = new Set(items.map((item) => item.file))
    await writeManifest(settings, comparison, comparison.manifest.projects.filter((entry) => !removed.has(entry.file)))
  }
  return count
}
