import { useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check, Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-react'
import {
  compare, checkRepo, EMPTY_GIT, push, pull, removeRemote,
  type Comparison, type GitSettings, type SyncItem, type SyncStatus,
} from '../git'
import type { Project } from '../types'

interface Props {
  settings: GitSettings | null
  loadProjects: () => Promise<Project[]>
  onSaveSettings: (next: GitSettings | null) => void
  onPulled: (files: { id: string; name: string; code: string }[]) => Promise<void>
  toast: (message: string, tone?: 'success' | 'error' | 'info') => void
}

const STATUS_LABEL: Record<SyncStatus, string> = {
  same: '같음',
  onlyLocal: '이 기기에만',
  onlyRemote: '저장소에만',
  changed: '다름',
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function GitPanel({ settings, loadProjects, onSaveSettings, onPulled, toast }: Props) {
  const [form, setForm] = useState<GitSettings>(settings ?? EMPTY_GIT)
  const [editing, setEditing] = useState(!settings)
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)

  const change = (patch: Partial<GitSettings>) => setForm((current) => ({ ...current, ...patch }))

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label)
    try {
      await task()
    } catch (error) {
      toast(message(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const connect = () => run('연결 확인', async () => {
    const repo = { ...form, repo: form.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '') }
    const info = await checkRepo(repo)
    const next = { ...repo, branch: repo.branch.trim() || info.defaultBranch }
    onSaveSettings(next)
    setForm(next)
    setEditing(false)
    setComparison(null)
    toast(`${info.fullName} (${next.branch}) 에 연결했습니다.${info.canPush ? '' : ' 쓰기 권한이 없어 올리기는 안 됩니다.'}`, info.canPush ? 'success' : 'info')
  })

  const refresh = () => settings && run('비교', async () => {
    setComparison(await compare(settings, await loadProjects()))
  })

  const doPush = (items: SyncItem[]) => settings && comparison && run('올리기', async () => {
    const count = await push(settings, await loadProjects(), items, comparison)
    toast(count ? `${count}개를 저장소에 올렸습니다.` : '올릴 것이 없습니다.', 'success')
    setComparison(await compare(settings, await loadProjects()))
  })

  const doPull = (items: SyncItem[]) => settings && run('내려받기', async () => {
    const files = await pull(settings, items)
    await onPulled(files)
    toast(`${files.length}개를 내려받았습니다.`, 'success')
    setComparison(await compare(settings, await loadProjects()))
  })

  const doRemove = (items: SyncItem[]) => settings && comparison && run('저장소에서 삭제', async () => {
    const count = await removeRemote(settings, items, comparison)
    toast(`${count}개를 저장소에서 지웠습니다.`, 'success')
    setComparison(await compare(settings, await loadProjects()))
  })

  if (editing || !settings) {
    return (
      <div className="form-stack git-form">
        <p className="muted-copy">
          GitHub 저장소 하나에 프로젝트를 보관합니다. 같은 저장소를 다른 기기에서 열면 그대로 이어서 쓸 수 있습니다.
        </p>
        <label className="field">
          <span>액세스 토큰</span>
          <div className="field-row">
            <input
              type={showToken ? 'text' : 'password'}
              value={form.token}
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_..."
              onChange={(event) => change({ token: event.target.value })}
            />
            <button className="icon-button tiny" onClick={() => setShowToken((value) => !value)} aria-label="토큰 보기">
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <p className="muted-copy">
          GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens 에서
          이 저장소 하나만 고르고 <strong>Contents: Read and write</strong> 권한을 주세요.
          토큰은 이 기기 안에만 저장되고 api.github.com 외에는 보내지 않습니다.
        </p>
        <label className="field">
          <span>저장소</span>
          <input value={form.repo} placeholder="사용자명/저장소명" spellCheck={false} onChange={(event) => change({ repo: event.target.value })} />
        </label>
        <div className="field-pair">
          <label className="field">
            <span>브랜치</span>
            <input value={form.branch} placeholder="main" spellCheck={false} onChange={(event) => change({ branch: event.target.value })} />
          </label>
          <label className="field">
            <span>폴더</span>
            <input value={form.folder} placeholder="projects" spellCheck={false} onChange={(event) => change({ folder: event.target.value })} />
          </label>
        </div>
        <div className="git-actions">
          {settings && <button className="button ghost" onClick={() => { setForm(settings); setEditing(false) }}>취소</button>}
          {settings && (
            <button className="button danger" onClick={() => { onSaveSettings(null); setComparison(null); setForm(EMPTY_GIT); toast('연결을 끊고 토큰을 지웠습니다.', 'info') }}>
              연결 끊기
            </button>
          )}
          <span className="footer-spacer" />
          <button className="button primary" disabled={!form.token.trim() || !form.repo.includes('/') || !!busy} onClick={connect}>
            {busy ?? '연결 확인'}
          </button>
        </div>
      </div>
    )
  }

  const pushable = comparison?.items.filter((item) => item.status === 'onlyLocal' || item.status === 'changed') ?? []
  const pullable = comparison?.items.filter((item) => item.status === 'onlyRemote' || item.status === 'changed') ?? []

  return (
    <div className="git-view">
      <div className="git-repo">
        <div>
          <strong>{settings.repo}</strong>
          <small>{settings.branch}{settings.folder ? ` · ${settings.folder}/` : ' · 저장소 루트'}</small>
        </div>
        <button className="button ghost" onClick={() => setEditing(true)}>설정</button>
      </div>

      <div className="git-actions">
        <button className="button ghost" disabled={!!busy} onClick={refresh}><RefreshCw size={16} />{busy === '비교' ? '비교 중…' : '비교'}</button>
        <span className="footer-spacer" />
        <button className="button ghost" disabled={!!busy || !pullable.length} onClick={() => doPull(pullable)}>
          <ArrowDownToLine size={16} />모두 내려받기{pullable.length ? ` ${pullable.length}` : ''}
        </button>
        <button className="button primary" disabled={!!busy || !pushable.length} onClick={() => doPush(pushable)}>
          <ArrowUpFromLine size={16} />모두 올리기{pushable.length ? ` ${pushable.length}` : ''}
        </button>
      </div>

      {!comparison && <p className="muted-copy">비교를 눌러 이 기기와 저장소의 차이를 확인하세요.</p>}

      {comparison && !comparison.items.length && <p className="muted-copy">아직 아무것도 없습니다. 프로젝트를 만들고 올려 보세요.</p>}

      {comparison && !!comparison.items.length && (
        <ul className="git-list">
          {comparison.items.map((item) => (
            <li key={item.id} className={`git-item ${item.status}`}>
              <span className="git-item-copy">
                <strong>{item.name}</strong>
                <small>{item.file}</small>
              </span>
              <span className={`git-badge ${item.status}`}>
                {item.status === 'same' && <Check size={12} />}
                {STATUS_LABEL[item.status]}
              </span>
              <span className="git-item-actions">
                {(item.status === 'onlyLocal' || item.status === 'changed') && (
                  <button className="icon-button tiny" disabled={!!busy} title="올리기" onClick={() => doPush([item])}><ArrowUpFromLine size={16} /></button>
                )}
                {(item.status === 'onlyRemote' || item.status === 'changed') && (
                  <button className="icon-button tiny" disabled={!!busy} title="내려받기" onClick={() => doPull([item])}><ArrowDownToLine size={16} /></button>
                )}
                {item.status === 'onlyRemote' && (
                  <button className="icon-button tiny" disabled={!!busy} title="저장소에서 지우기" onClick={() => doRemove([item])}><Trash2 size={16} /></button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="muted-copy">
        올리기는 이 기기의 내용으로 저장소를 덮어쓰고, 내려받기는 저장소 내용으로 이 기기를 덮어씁니다.
        같은 프로젝트를 두 기기에서 동시에 고쳤다면 한쪽을 고른 뒤 다시 맞춰 주세요.
      </p>
    </div>
  )
}
