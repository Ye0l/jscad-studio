import { useEffect, useState } from 'react'

const HIGHLIGHTS = [
  { name: 'JSCAD (@jscad/modeling, @jscad/regl-renderer)', license: 'MIT', holder: 'JSCAD Organization' },
  { name: 'CodeMirror 6', license: 'MIT', holder: 'Marijn Haverbeke 외 기여자' },
  { name: 'React', license: 'MIT', holder: 'Meta Platforms, Inc. 및 계열사' },
  { name: 'Tauri', license: 'MIT 또는 Apache-2.0', holder: 'Tauri Programme within The Commons Conservancy' },
  { name: 'regl', license: 'MIT', holder: 'Mikola Lysenko' },
  { name: 'Lucide', license: 'ISC', holder: 'Lucide Contributors' },
]

export function Licenses() {
  const [notices, setNotices] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    // 고지 전문이 수백 KB라 첫 화면을 무겁게 하지 않도록 이 화면을 열 때만 따로 불러온다
    import('../../THIRD-PARTY-NOTICES.md?raw')
      .then((module) => { if (active) setNotices(module.default) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])

  return (
    <div className="license-view">
      <p className="muted-copy">JSCAD Studio는 아래 오픈소스 소프트웨어를 포함해 배포됩니다. 전체 목록과 라이선스 원문은 아래에 그대로 싣습니다.</p>
      <ul className="license-highlights">
        {HIGHLIGHTS.map((item) => (
          <li key={item.name}><strong>{item.name}</strong><span>{item.license} · © {item.holder}</span></li>
        ))}
      </ul>
      {failed
        ? <p className="muted-copy">고지 전문을 불러오지 못했습니다. 저장소의 THIRD-PARTY-NOTICES.md 를 확인해 주세요.</p>
        : notices === null
          ? <p className="muted-copy">고지 전문을 불러오는 중…</p>
          : <pre className="license-text">{notices}</pre>}
    </div>
  )
}
