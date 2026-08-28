import { useEffect, useState } from 'react'
import { Camera, Download } from 'lucide-react'
import { renderToBlob, type RenderBackground } from '../renderImage'
import type { CameraState } from './Viewer'

interface Props {
  geometries: unknown[]
  /** 열려 있는 미리보기의 각도. 없으면 모델에 맞춰 자동으로 잡는다 */
  camera: CameraState | null
  viewport: { width: number; height: number } | null
  projectName: string
  toast: (message: string, tone?: 'success' | 'error' | 'info') => void
}

const SCALES = [
  { id: 1, label: '보통' },
  { id: 2, label: '높음' },
  { id: 3, label: '아주 높음' },
]

const BACKGROUNDS: { id: RenderBackground; label: string }[] = [
  { id: 'dark', label: '어두운 배경' },
  { id: 'light', label: '밝은 배경' },
  { id: 'transparent', label: '투명' },
]

const BASE = { width: 1280, height: 900 }

export function RenderPanel({ geometries, camera, viewport, projectName, toast }: Props) {
  const [scale, setScale] = useState(2)
  const [background, setBackground] = useState<RenderBackground>('dark')
  const [grid, setGrid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null)

  // 미리보기가 열려 있으면 그 비율 그대로, 아니면 기본 비율로 그린다
  const size = viewport && viewport.width > 40 && viewport.height > 40 ? viewport : BASE
  const output = { width: Math.round(size.width), height: Math.round(size.height) }

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url) }, [image])

  const render = async () => {
    setBusy(true)
    try {
      const blob = await renderToBlob({ geometries, camera, ...output, supersample: scale, background, grid })
      setImage((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return { url: URL.createObjectURL(blob), blob }
      })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    if (!image) return
    const link = document.createElement('a')
    link.href = image.url
    link.download = `${projectName || 'render'}.png`
    document.body.append(link)
    link.click()
    link.remove()
  }

  return (
    <div className="render-view">
      <div className="render-preview">
        {image
          ? <img src={image.url} alt="렌더 결과" />
          : <p className="muted-copy">{geometries.length ? '렌더를 누르면 지금 보는 각도로 그립니다.' : '먼저 코드를 실행해 형상을 만들어 주세요.'}</p>}
      </div>

      <div className="render-options">
        <div className="option-row">
          <span>품질</span>
          <div className="chip-row">
            {SCALES.map((item) => (
              <button key={item.id} className={scale === item.id ? 'selected' : ''} onClick={() => setScale(item.id)}>
                {item.label}
                <small>{output.width * item.id}×{output.height * item.id}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="option-row">
          <span>배경</span>
          <div className="chip-row">
            {BACKGROUNDS.map((item) => (
              <button key={item.id} className={background === item.id ? 'selected' : ''} onClick={() => setBackground(item.id)}>{item.label}</button>
            ))}
          </div>
        </div>
        <div className="option-row">
          <span>격자와 축</span>
          <div className="chip-row">
            <button className={grid ? '' : 'selected'} onClick={() => setGrid(false)}>숨김</button>
            <button className={grid ? 'selected' : ''} onClick={() => setGrid(true)}>표시</button>
          </div>
        </div>
      </div>

      <p className="muted-copy">
        결과는 {output.width}×{output.height} PNG 입니다. 품질을 올리면 그만큼 크게 그린 뒤 줄여서 가장자리가 매끄러워집니다.
        {camera ? '' : ' 미리보기 탭이 닫혀 있어 모델에 맞춘 기본 각도로 그립니다.'}
      </p>

      <div className="git-actions">
        <span className="footer-spacer" />
        {image && <button className="button ghost" onClick={save}><Download size={16} />PNG 저장</button>}
        <button className="button primary" disabled={busy || !geometries.length} onClick={() => void render()}>
          <Camera size={16} />{busy ? '그리는 중…' : image ? '다시 렌더' : '렌더'}
        </button>
      </div>
    </div>
  )
}
