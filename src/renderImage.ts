// 미리보기와 별개로, 지금 보는 각도를 높은 해상도로 한 번 그려 PNG 로 만든다.
// 편집 중 미리보기는 부드러움이 우선이라 낮은 해상도로 계속 돌지만, 여기서는
// 화면 크기의 몇 배로 그린 뒤 줄여서 계단을 없애고 조명도 더 부드럽게 쓴다.
import * as rendererModule from '@jscad/regl-renderer'
import type { CameraState } from './components/Viewer'

type Maybe<T> = T & { default?: T }
const renderer = ((rendererModule as Maybe<typeof rendererModule>).default ?? rendererModule) as any

export type RenderBackground = 'dark' | 'light' | 'transparent'

export interface RenderOptions {
  geometries: unknown[]
  camera: CameraState | null
  width: number
  height: number
  /** 실제로 그릴 배수. 2 면 두 배로 그린 뒤 줄인다 */
  supersample: number
  background: RenderBackground
  grid: boolean
}

const BACKGROUNDS: Record<RenderBackground, [number, number, number, number]> = {
  dark: [0.055, 0.063, 0.078, 1],
  light: [0.96, 0.97, 0.98, 1],
  transparent: [0, 0, 0, 0],
}

const MAX_PIXELS = 4096

export const renderToBlob = async (options: RenderOptions): Promise<Blob> => {
  if (!options.geometries.length) throw new Error('그릴 형상이 없습니다. 먼저 코드를 실행하세요.')

  const scale = Math.max(1, Math.min(options.supersample, 4))
  const width = Math.min(Math.round(options.width * scale), MAX_PIXELS)
  const height = Math.min(Math.round(options.height * scale), MAX_PIXELS)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const cameraApi = renderer.cameras.perspective
  const orbit = renderer.controls.orbit
  const camera = {
    ...cameraApi.defaults,
    position: [...(options.camera?.position ?? cameraApi.defaults.position)],
    target: [...(options.camera?.target ?? cameraApi.defaults.target)],
    up: [...(options.camera?.up ?? cameraApi.defaults.up)],
    fov: options.camera?.fov ?? cameraApi.defaults.fov,
  }

  const solids = renderer.entitiesFromSolids({ color: [0.27, 0.78, 0.68, 1] }, options.geometries)
  const entities = options.grid
    ? [
      { visuals: { drawCmd: 'drawGrid', show: true }, size: [400, 400], ticks: [10, 2] },
      { visuals: { drawCmd: 'drawAxis', show: true }, size: 120 },
      ...solids,
    ]
    : solids

  const draw = renderer.prepareRender({
    glOptions: { canvas, attributes: { antialias: true, alpha: options.background === 'transparent', preserveDrawingBuffer: true } },
    camera,
    drawCommands: {
      drawAxis: renderer.drawCommands.drawAxis,
      drawGrid: renderer.drawCommands.drawGrid,
      drawLines: renderer.drawCommands.drawLines,
      drawMesh: renderer.drawCommands.drawMesh,
    },
    rendering: { background: BACKGROUNDS[options.background] },
    entities,
  })

  cameraApi.setProjection(camera, camera, { width, height })
  // 각도를 물려받지 못했으면 모델이 화면에 꽉 차도록 맞춘다
  if (!options.camera) {
    const controls = {
      ...orbit.defaults,
      limits: { ...orbit.defaults.limits },
      zoomToFit: { ...orbit.defaults.zoomToFit },
      userControl: { ...orbit.defaults.userControl },
      autoRotate: { ...orbit.defaults.autoRotate },
    }
    const fit = orbit.zoomToFit({ controls, camera, entities: solids })
    Object.assign(controls, fit.controls)
    Object.assign(camera, fit.camera)
    const update = orbit.update({ controls, camera })
    Object.assign(camera, update.camera)
  }
  cameraApi.update(camera, camera)

  draw({
    camera,
    entities,
    // 미리보기보다 주변광을 올리고 반사를 낮춰 형태가 또렷하게 보이도록 한다
    rendering: {
      background: BACKGROUNDS[options.background],
      ambientLightAmount: 0.42,
      diffuseLightAmount: 0.78,
      specularLightAmount: 0.12,
      materialShininess: 16,
      lightPosition: [180, 260, 320],
    },
    drawCommands: {
      drawAxis: renderer.drawCommands.drawAxis,
      drawGrid: renderer.drawCommands.drawGrid,
      drawLines: renderer.drawCommands.drawLines,
      drawMesh: renderer.drawCommands.drawMesh,
    },
  })

  const target = document.createElement('canvas')
  target.width = Math.round(options.width)
  target.height = Math.round(options.height)
  const context = target.getContext('2d')
  if (!context) throw new Error('이미지를 만들 수 없습니다.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(canvas, 0, 0, target.width, target.height)

  // WebGL 컨텍스트 수는 브라우저마다 제한이 있어 다 쓰면 바로 놓아준다
  canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext()

  return await new Promise<Blob>((resolve, reject) => {
    target.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 로 변환하지 못했습니다.'))), 'image/png')
  })
}
