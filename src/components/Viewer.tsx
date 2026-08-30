import { useEffect, useRef, type RefObject } from 'react'
import * as rendererModule from '@jscad/regl-renderer'
import { boundsOf, dimensionAnchors, type Bounds } from '../geometryBounds'
import type { Box, Vec3 } from '../scene/types'

export type GizmoMode = 'move' | 'rotate' | 'scale'

export interface CameraState {
  position: number[]
  target: number[]
  up: number[]
  fov: number
}

export interface ViewerHandle {
  /** 렌더 이미지가 지금 보는 각도를 그대로 쓰도록 카메라를 넘겨준다 */
  getCamera: () => CameraState | null
  /** 모델이 화면에 꽉 차도록 다시 맞춘다 */
  fit: () => void
}

/** 기즈모를 끌 때 나오는 값. 언제나 “끌기 시작한 순간부터의 총 변화량”이다 */
export type GizmoPayload =
  | { mode: 'move'; delta: Vec3 }
  | { mode: 'rotate'; axis: number; degrees: number }
  | { mode: 'scale'; axis: number; distance: number }

interface Props {
  geometries: unknown[]
  /** 고른 객체의 형상. 다른 색으로 그린다 */
  highlighted?: unknown[]
  /** 고른 객체를 감싸는 상자 */
  selectionBox?: Box | null
  showGrid: boolean
  /** 경계 상자와 X·Y·Z 실제 길이를 겹쳐 보여 준다 */
  showDimensions?: boolean
  /** 다시 실행할 때마다 화면을 모델에 맞출지. 꺼도 첫 실행에는 한 번 맞춘다 */
  autoFit?: boolean
  /** 새 객체가 놓이는 작업면 높이 */
  workplaneOffset?: number
  rotateSensitivity: number
  zoomSensitivity: number
  /** 가로 회전 방향 뒤집기 */
  invertOrbitX?: boolean
  /** 값이 바뀌면 모델이 화면에 꽉 차도록 다시 맞춘다 */
  fitToken?: number
  /** 기즈모를 그릴 자리. null 이면 그리지 않는다 */
  gizmoOrigin?: Vec3 | null
  gizmoMode?: GizmoMode
  /** 상대 배치·적층이 정하고 있어 직접 끌 수 없는 축 */
  gizmoLockedAxes?: boolean[]
  onGizmoStart?: () => void
  onGizmoMove?: (payload: GizmoPayload) => void
  onGizmoEnd?: () => void
  /** 뷰포트를 탭했을 때 그 자리로 나가는 광선. 무엇을 고를지는 바깥에서 정한다 */
  onPick?: (ray: { origin: Vec3; direction: Vec3 }) => void
  onInteractionHint?: () => void
  apiRef?: RefObject<ViewerHandle | null>
}

const AXIS_COLORS = ['#ff6f7a', '#7ee08a', '#7fb4ff']
const AXIS_NAMES = ['X', 'Y', 'Z']
/** 화면에서 기즈모 손잡이까지의 길이 (px). 카메라 거리와 상관없이 일정하게 보인다 */
const HANDLE_PX = 74
const RING_PX = 54

type Point = { x: number; y: number }
type Vector = ArrayLike<number>

// 감도 1.0 에서 화면 1px 이 도는 각도. 기본값(0.34)에서 약 0.3°/px 가 되도록 맞췄다
const ROTATE_STEP = 0.0155
// 휠 한 칸이 감도 1.0 에서 약 30% 줌
const WHEEL_STEP = 0.3
// 핀치는 손가락 간격과 1:1 로 붙어야 손에 익는다. 한 번에 튀는 값만 잘라 낸다
const PINCH_CLAMP = { min: 0.8, max: 1.25 }

const SOLID_COLOR = [0.27, 0.78, 0.68, 1]
const SELECTED_COLOR = [1, 0.72, 0.29, 1]
const BOX_COLOR = [1, 0.72, 0.29, 0.9]
const PLANE_COLOR = [0.42, 0.58, 0.72, 0.55]
const DIMENSION_COLOR = [0.42, 0.62, 0.78, 0.85]
const GRID_COLOR = [0.42, 0.47, 0.56, 0.4]
const GRID_SUB_COLOR = [0.35, 0.4, 0.48, 0.16]

const distanceBetween = (a: Vector, b: Vector) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// 휠 한 칸을 1로 환산한다 (브라우저·기기마다 deltaY 단위가 달라서 정규화가 필요)
const wheelNotches = (event: WheelEvent) => {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
  return Math.max(-4, Math.min(4, (event.deltaY * unit) / 100))
}

/**
 * 한 변이 1 인 상자의 12 모서리. 실제 크기는 model 행렬로만 바꾸므로 버퍼를 다시 만들지 않는다.
 * drawLines 의 셰이더가 normal 을 요구하므로 쓰이지 않더라도 같은 개수만큼 채워 준다.
 */
const unitBoxLines = () => {
  const corner = (index: number) => [
    (index & 1 ? 0.5 : -0.5), (index & 2 ? 0.5 : -0.5), (index & 4 ? 0.5 : -0.5),
  ]
  const edges = [
    [0, 1], [1, 3], [3, 2], [2, 0],
    [4, 5], [5, 7], [7, 6], [6, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  const positions = edges.flatMap(([a, b]) => [corner(a), corner(b)])
  // indices 가 있어야 regl 이 그릴 정점 개수를 알 수 있다
  return { positions, normals: positions.map(() => [0, 0, 1]), indices: positions.map((_, index) => index) }
}

/** 열 우선 4x4: 가운데로 옮기고 크기를 준다 */
const boxMatrix = (center: number[], size: number[]) => [
  size[0], 0, 0, 0,
  0, size[1], 0, 0,
  0, 0, size[2], 0,
  center[0], center[1], center[2], 1,
]

export function Viewer({
  geometries, highlighted, selectionBox, showGrid, showDimensions = false, autoFit = false,
  workplaneOffset = 0, rotateSensitivity, zoomSensitivity, invertOrbitX = false, fitToken = 0,
  gizmoOrigin = null, gizmoMode = 'move', gizmoLockedAxes, onGizmoStart, onGizmoMove, onGizmoEnd,
  onPick, onInteractionHint, apiRef,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<any>(null)
  const pointersRef = useRef(new Map<number, Point>())
  const previousPinchRef = useRef<{ distance: number; center: Point } | null>(null)
  // 두 손가락 제스처가 끝난 직후 남은 손가락으로 화면이 홱 도는 것을 막는다
  const gestureRef = useRef(false)
  // 탭인지 끌기인지 가리기 위해 누른 자리와 움직인 거리를 기억한다
  const tapRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const fittedRef = useRef({ token: -1, count: 0 })
  /** 지금 그리고 있는 형상 entity. 화면 맞춤이 이 목록을 그대로 쓴다 */
  const solidsRef = useRef<unknown[]>([])
  const boundsRef = useRef<Bounds | null>(null)
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([])
  const readoutRef = useRef<HTMLDivElement>(null)
  const showDimensionsRef = useRef(showDimensions)
  showDimensionsRef.current = showDimensions
  const svgRef = useRef<SVGSVGElement>(null)
  const projectRef = useRef<((point: Vec3) => Point | null) | null>(null)
  const gizmoRef = useRef<{ origin: Vec3 | null; mode: GizmoMode; locked: boolean[] }>(
    { origin: null, mode: 'move', locked: [] },
  )
  const gizmoDragRef = useRef<{
    axis: number
    kind: 'axis' | 'view' | 'ring'
    start: Point
    origin: Vec3
    /** 화면에서의 축 방향(단위 벡터)과, 화면 1px 이 뜻하는 실제 거리 */
    dir: Point
    worldPerPixel: number
    startAngle: number
    sign: number
    right: Vec3
    up: Vec3
  } | null>(null)
  gizmoRef.current = { origin: gizmoOrigin, mode: gizmoMode, locked: gizmoLockedAxes ?? [] }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // 렌더러가 새로 만들어지면 카메라도 처음 상태이므로 화면 맞춤 기록을 지운다
    fittedRef.current = { token: -1, count: 0 }
    const renderer = rendererModule as any
    const cameraApi = renderer.cameras.perspective
    const orbit = renderer.controls.orbit
    const camera = {
      ...cameraApi.defaults,
      position: [...cameraApi.defaults.position],
      target: [...cameraApi.defaults.target],
      up: [...cameraApi.defaults.up],
    }
    const controls = {
      ...orbit.defaults,
      // 관성을 끄면 끈 만큼만 돌아간다 (기본값은 끌던 힘이 남아 과하게 돈다)
      drag: 1,
      limits: { ...orbit.defaults.limits },
      zoomToFit: { ...orbit.defaults.zoomToFit },
      userControl: { ...orbit.defaults.userControl },
      autoRotate: { ...orbit.defaults.autoRotate },
    }
    // 격자·축·선택 상자·작업면은 한 번만 만들고 표시 여부와 행렬만 바꾼다
    const guides = [
      {
        visuals: { drawCmd: 'drawGrid', show: true },
        // 50mm 굵은 눈금 + 10mm 가는 눈금. 더 촘촘하면 확대했을 때 화면이 지저분해진다
        size: [200, 200],
        ticks: [50, 10],
        color: GRID_COLOR,
        subColor: GRID_SUB_COLOR,
      },
      { visuals: { drawCmd: 'drawAxis', show: true }, size: 100 },
    ]
    const selection = {
      visuals: { drawCmd: 'drawLines', show: false },
      geometry: unitBoxLines(),
      color: BOX_COLOR,
      model: boxMatrix([0, 0, 0], [1, 1, 1]),
    }
    const plane = {
      visuals: { drawCmd: 'drawLines', show: false },
      geometry: unitBoxLines(),
      color: PLANE_COLOR,
      model: boxMatrix([0, 0, 0], [1, 1, 0]),
    }
    const dimensionBox = {
      visuals: { drawCmd: 'drawLines', show: false, transparent: true },
      geometry: unitBoxLines(),
      color: DIMENSION_COLOR,
      model: boxMatrix([0, 0, 0], [1, 1, 1]),
    }
    /*
     * regl-renderer 는 entity 마다 draw command 를 한 번 만들어 캐시에 넣고 다시는 비우지 않는다.
     * 형상을 다시 만들 때마다 entity 도 새로 생기므로, 그냥 두면 GPU 버퍼가 계속 쌓인다.
     * 그래서 command 를 만들 때 쓰인 regl 자원을 entity 별로 적어 두었다가,
     * 그 entity 가 화면에서 빠지면 함께 지운다. (죽은 command 는 다시 불리지 않는다)
     */
    const trackedResources = new Map<object, { destroy?: () => void }[]>()
    let reglInstance: { destroy?: () => void; stats?: Record<string, number> } | null = null

    const trackingRegl = (regl: any, created: { destroy?: () => void }[]) => new Proxy(regl, {
      apply: (target: any, _thisArg: unknown, args: unknown[]) => target(...args),
      get: (target: any, property: string | symbol) => {
        const value = target[property]
        if (typeof value !== 'function') return value
        if (property !== 'buffer' && property !== 'elements' && property !== 'texture') return value.bind(target)
        return (...args: unknown[]) => {
          const resource = value.call(target, ...args)
          created.push(resource)
          return resource
        }
      },
    })

    const trackCommand = (factory: any) => (regl: any, entity: any) => {
      reglInstance = regl
      const created: { destroy?: () => void }[] = []
      const command = factory(trackingRegl(regl, created), entity)
      if (created.length) trackedResources.set(entity, created)
      return command
    }

    /** 지금 그리는 목록에 없는 entity 의 GPU 자원을 놓아 준다 */
    const retire = (keep: object[]) => {
      const alive = new Set(keep)
      for (const [entity, created] of trackedResources) {
        if (alive.has(entity)) continue
        for (const resource of created) resource.destroy?.()
        trackedResources.delete(entity)
      }
    }

    const options: any = {
      glOptions: { container: host, attributes: { antialias: true, alpha: false } },
      camera,
      drawCommands: {
        drawAxis: trackCommand(renderer.drawCommands.drawAxis),
        drawGrid: trackCommand(renderer.drawCommands.drawGrid),
        drawLines: trackCommand(renderer.drawCommands.drawLines),
        drawMesh: trackCommand(renderer.drawCommands.drawMesh),
      },
      rendering: { background: [0.055, 0.063, 0.078, 1] },
      entities: [],
    }
    const render = renderer.prepareRender(options)
    let viewport = { width: 1, height: 1 }
    const resize = () => {
      const rect = host.getBoundingClientRect()
      viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
      // 기즈모 SVG 도 같은 좌표계를 쓰도록 맞춘다 (UI 배율이 걸려 있어도 어긋나지 않는다)
      svgRef.current?.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`)
      cameraApi.setProjection(camera, camera, viewport)
      cameraApi.update(camera, camera)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    // 가까이 확대해도 모델이 근평면에 잘리지 않도록 근/원평면을 카메라 거리에 맞춘다
    const syncPlanes = () => {
      const distance = distanceBetween(camera.position, camera.target)
      if (!(distance > 0)) return
      const near = Math.max(distance * 0.01, 0.01)
      if (Math.abs(camera.near - near) < camera.near * 0.2) return
      camera.near = near
      camera.far = Math.max(distance * 20, 2000)
      cameraApi.setProjection(camera, camera, viewport)
    }

    /** 월드 좌표를 화면 좌표(px)로. 카메라 뒤에 있으면 null */
    const project = (point: Vec3): Point | null => {
      const { view, projection } = camera
      const apply = (matrix: number[], input: number[]) => [0, 1, 2, 3].map((row) =>
        matrix[row] * input[0] + matrix[4 + row] * input[1] + matrix[8 + row] * input[2] + matrix[12 + row] * input[3])
      const eye = apply(view, [point[0], point[1], point[2], 1])
      const clip = apply(projection, eye)
      if (!(clip[3] > 1e-6)) return null
      return {
        x: (clip[0] / clip[3] * 0.5 + 0.5) * viewport.width,
        y: (0.5 - clip[1] / clip[3] * 0.5) * viewport.height,
      }
    }
    projectRef.current = project

    // 기즈모는 SVG 로 덮어 그린다. 프레임마다 좌표만 갈아 끼워 다시 렌더링하지 않는다
    const paintGizmo = () => {
      const svg = svgRef.current
      if (!svg) return
      const { origin, mode, locked } = gizmoRef.current
      const at = origin ? project(origin) : null
      if (!at) {
        svg.style.display = 'none'
        return
      }
      svg.style.display = ''
      const center = svg.querySelector<SVGCircleElement>('[data-gizmo-center]')
      center?.setAttribute('cx', String(at.x))
      center?.setAttribute('cy', String(at.y))
      for (let axis = 0; axis < 3; axis += 1) {
        const step: Vec3 = [origin![0], origin![1], origin![2]]
        step[axis] += 1
        const tip = project(step)
        const group = svg.querySelector<SVGGElement>(`[data-gizmo-axis="${axis}"]`)
        if (!group) continue
        // 상대 배치가 정하고 있는 축은 끌어도 소용이 없으니 아예 보여 주지 않는다
        if (mode === 'move' && locked[axis]) {
          group.style.display = 'none'
          continue
        }
        const dx = tip ? tip.x - at.x : 0
        const dy = tip ? tip.y - at.y : 0
        const length = Math.hypot(dx, dy)
        // 축이 카메라를 정면으로 향하면 화면에서 점이 되므로 감춘다
        if (!tip || length < 0.02) {
          group.style.display = 'none'
          continue
        }
        group.style.display = ''
        const unit = { x: dx / length, y: dy / length }
        const reach = mode === 'rotate' ? RING_PX : HANDLE_PX
        const end = { x: at.x + unit.x * reach, y: at.y + unit.y * reach }
        group.dataset.dirX = String(unit.x)
        group.dataset.dirY = String(unit.y)
        group.dataset.scale = String(1 / length)
        const line = group.querySelector('line')
        line?.setAttribute('x1', String(at.x))
        line?.setAttribute('y1', String(at.y))
        line?.setAttribute('x2', String(end.x))
        line?.setAttribute('y2', String(end.y))
        const knob = group.querySelector('[data-gizmo-knob]')
        knob?.setAttribute('cx', String(end.x))
        knob?.setAttribute('cy', String(end.y))
        const label = group.querySelector('text')
        label?.setAttribute('x', String(at.x + unit.x * (reach + 13)))
        label?.setAttribute('y', String(at.y + unit.y * (reach + 13) + 4))
      }
    }

    /** 치수 숫자는 WebGL 대신 HTML 로 얹고, 프레임마다 화면 좌표만 갈아 끼운다 */
    const paintLabels = () => {
      const bounds = boundsRef.current
      const labels = labelRefs.current
      if (!showDimensionsRef.current || !bounds || !labels.length) return
      dimensionAnchors(bounds).forEach((anchor, index) => {
        const element = labels[index]
        if (!element) return
        const at = project(anchor.point as Vec3)
        if (!at) {
          element.style.opacity = '0'
          return
        }
        element.style.opacity = '1'
        element.style.transform = `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`
        element.textContent = anchor.value.toFixed(anchor.value < 10 ? 2 : 1)
      })
      if (readoutRef.current) {
        readoutRef.current.textContent = `${bounds.size.map((value) => value.toFixed(1)).join(' × ')} mm`
      }
    }

    let frame = 0
    const animate = () => {
      const update = orbit.update({ controls, camera })
      Object.assign(controls, update.controls)
      Object.assign(camera, update.camera)
      cameraApi.update(camera, camera)
      syncPlanes()
      options.camera = camera
      render(options)
      paintGizmo()
      paintLabels()
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    /** 지금 그리고 있는 형상에 화면을 맞춘다 */
    const fitToSolids = () => {
      const entities = solidsRef.current
      if (!entities.length) return
      const fit = orbit.zoomToFit({ controls, camera, entities })
      Object.assign(controls, fit.controls)
      Object.assign(camera, fit.camera)
    }

    runtimeRef.current = {
      renderer, cameraApi, orbit, camera, controls, options, render,
      selection, plane, dimensionBox, guides, retire, fitToSolids,
    }
    if (apiRef) {
      apiRef.current = {
        getCamera: () => ({
          position: [...camera.position],
          target: [...camera.target],
          up: [...camera.up],
          fov: camera.fov,
        }),
        fit: fitToSolids,
      }
    }

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      runtimeRef.current = null
      if (apiRef) apiRef.current = null
      // 탭을 닫으면 WebGL 컨텍스트째로 놓아 준다 (안 그러면 컨텍스트가 그대로 남는다)
      retire([])
      reglInstance?.destroy?.()
      host.replaceChildren()
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const { renderer, options, selection, plane, dimensionBox, guides, retire } = runtime
    const solids = renderer.entitiesFromSolids({ color: SOLID_COLOR }, geometries)
    // 형상 자체가 색을 들고 있으면 그 색이 이긴다. 고른 객체는 얕은 복사로 색만 덮어쓴다
    const picked = renderer.entitiesFromSolids(
      { color: SELECTED_COLOR },
      (highlighted ?? []).map((item) => ({ ...(item as object), color: SELECTED_COLOR })),
    )
    for (const guide of guides) guide.visuals.show = showGrid
    solidsRef.current = [...solids, ...picked]
    // 치수는 실제 형상에서 잰다 (고른 객체도 모델의 일부다)
    boundsRef.current = boundsOf([...geometries, ...(highlighted ?? [])])
    const size = boundsRef.current?.size
    if (boundsRef.current && size) {
      const center = [0, 1, 2].map((axis) => (boundsRef.current!.min[axis] + boundsRef.current!.max[axis]) / 2)
      dimensionBox.model = boxMatrix(center, size.map((value) => Math.max(value, 0.01)))
    }
    options.entities = [...guides, plane, selection, dimensionBox, ...solids, ...picked]
    // 방금 밀려난 형상의 GPU 자원을 바로 놓아 준다
    retire(options.entities)
  }, [geometries, highlighted, showGrid])

  // 선택 상자와 작업면은 행렬만 갈아 끼운다
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const { selection } = runtime
    if (!selectionBox) {
      selection.visuals.show = false
      return
    }
    const size = [0, 1, 2].map((axis) => Math.max(0.01, selectionBox.max[axis] - selectionBox.min[axis]))
    const center = [0, 1, 2].map((axis) => (selectionBox.max[axis] + selectionBox.min[axis]) / 2)
    selection.model = boxMatrix(center, size)
    selection.visuals.show = true
  }, [selectionBox])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.dimensionBox.visuals.show = showDimensions && !!boundsRef.current
    for (const label of labelRefs.current) {
      if (label && !showDimensions) label.style.opacity = '0'
    }
  }, [showDimensions, geometries])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.plane.model = boxMatrix([0, 0, workplaneOffset], [400, 400, 0])
    runtime.plane.visuals.show = showGrid && Math.abs(workplaneOffset) > 1e-6
  }, [workplaneOffset, showGrid])

  // 빈 화면에 모델이 처음 생겼을 때와 “화면 맞춤”을 눌렀을 때만 카메라를 옮긴다.
  // 값을 고칠 때마다 카메라가 튀면 직접 조작이 불가능해진다.
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const solids = [...geometries, ...(highlighted ?? [])]
    const previousCount = fittedRef.current.count
    fittedRef.current.count = solids.length
    if (!solids.length) return
    if (!autoFit && previousCount > 0 && fittedRef.current.token === fitToken) return
    runtime.fitToSolids()
    fittedRef.current = { token: fitToken, count: solids.length }
    // 형상이 바뀔 때마다 카메라가 튀지 않도록 개수와 fitToken 만 본다 (autoFit 을 켜면 매번 맞춘다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken, autoFit, geometries, highlighted])

  const rotateBy = (dx: number, dy: number) => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const gain = ROTATE_STEP * rotateSensitivity
    const angle = [(invertOrbitX ? -dx : dx) * gain, -dy * gain]
    const result = runtime.orbit.rotate({ controls: runtime.controls, camera: runtime.camera }, angle)
    Object.assign(runtime.controls, result.controls)
  }

  // 드래그한 방향으로 모델이 따라오도록 카메라와 타깃을 화면 축 기준으로 함께 옮긴다
  const panBy = (dx: number, dy: number) => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const { camera, controls } = runtime
    if (!controls.userControl.pan) return
    const height = camera.viewport ? camera.viewport[3] : 0
    const distance = distanceBetween(camera.position, camera.target)
    if (!(height > 0) || !(distance > 0)) return
    // 타깃 평면에서 화면 1px이 차지하는 실제 거리 (그대로 써야 손가락과 1:1로 붙어 움직인다)
    const worldPerPixel = (2 * distance * Math.tan(camera.fov / 2)) / height
    const view = camera.view
    const right = [view[0], view[4], view[8]]
    const up = [view[1], view[5], view[9]]
    const offset = right.map((value, index) => (value * -dx + up[index] * dy) * worldPerPixel)
    camera.position = [0, 1, 2].map((index) => camera.position[index] + offset[index])
    camera.target = [0, 1, 2].map((index) => camera.target[index] + offset[index])
  }

  // 1보다 크면 멀어지고(축소), 작으면 가까워진다(확대)
  const zoomBy = (ratio: number) => {
    const runtime = runtimeRef.current
    if (!runtime || !Number.isFinite(ratio) || ratio <= 0) return
    const { camera, controls } = runtime
    if (!controls.userControl.zoom) return
    const distance = distanceBetween(camera.position, camera.target)
    if (!(distance > 0)) return
    const { minDistance, maxDistance } = controls.limits
    const next = Math.min(maxDistance, Math.max(minDistance, distance * controls.scale * ratio))
    controls.scale = next / distance
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // React의 onWheel은 passive로 붙어 preventDefault가 먹지 않으므로 직접 등록한다
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const notches = wheelNotches(event)
      if (!notches) return
      onInteractionHint?.()
      zoomBy(Math.exp(notches * WHEEL_STEP * zoomSensitivity))
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [zoomSensitivity, onInteractionHint])

  /** 화면 한 점을 지나는 광선 (원근 카메라 기준) */
  const rayAt = (point: Point) => {
    const runtime = runtimeRef.current
    const host = hostRef.current
    if (!runtime || !host) return null
    const rect = host.getBoundingClientRect()
    const { camera } = runtime
    const view = camera.view
    const right: Vec3 = [view[0], view[4], view[8]]
    const up: Vec3 = [view[1], view[5], view[9]]
    const backward: Vec3 = [view[2], view[6], view[10]]
    const ndcX = (point.x / Math.max(1, rect.width)) * 2 - 1
    const ndcY = 1 - (point.y / Math.max(1, rect.height)) * 2
    const tangent = Math.tan(camera.fov / 2)
    const aspect = rect.width / Math.max(1, rect.height)
    const direction = [0, 1, 2].map((index) => (
      -backward[index] + right[index] * ndcX * tangent * aspect + up[index] * ndcY * tangent
    )) as Vec3
    const length = Math.hypot(...direction) || 1
    return {
      origin: [...camera.position] as Vec3,
      direction: direction.map((value) => value / length) as Vec3,
    }
  }

  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = hostRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  const startGizmo = (event: React.PointerEvent, axis: number, kind: 'axis' | 'view') => {
    const runtime = runtimeRef.current
    const origin = gizmoOrigin
    if (!runtime || !origin) return
    event.stopPropagation()
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId)

    const group = (event.currentTarget as Element).closest('[data-gizmo-axis]') as SVGGElement | null
    const dir = { x: Number(group?.dataset.dirX ?? 1), y: Number(group?.dataset.dirY ?? 0) }
    const worldPerPixel = Number(group?.dataset.scale ?? 1)
    const start = localPoint(event)
    const at = projectRef.current?.(origin) ?? start
    const { camera } = runtime
    const view = camera.view
    const right: Vec3 = [view[0], view[4], view[8]]
    const up: Vec3 = [view[1], view[5], view[9]]
    // 화면 평면에서 끌 때 쓸 배율 — 대상이 놓인 깊이에서 1px 이 뜻하는 실제 거리
    const depth = distanceBetween(camera.position, origin)
    const planePerPixel = (2 * depth * Math.tan(camera.fov / 2)) / Math.max(1, camera.viewport?.[3] ?? 1)
    const toCamera = [0, 1, 2].map((index) => camera.position[index] - origin[index])
    const facing = toCamera[axis]

    gizmoDragRef.current = {
      axis,
      kind: kind === 'view' ? 'view' : gizmoMode === 'rotate' ? 'ring' : 'axis',
      start,
      origin: [...origin] as Vec3,
      dir,
      worldPerPixel: kind === 'view' ? planePerPixel : worldPerPixel,
      startAngle: Math.atan2(start.y - at.y, start.x - at.x),
      sign: facing > 0 ? -1 : 1,
      right,
      up,
    }
    onGizmoStart?.()
  }

  const moveGizmo = (event: React.PointerEvent) => {
    const drag = gizmoDragRef.current
    if (!drag || !onGizmoMove) return
    const point = localPoint(event)

    if (drag.kind === 'view') {
      const dx = (point.x - drag.start.x) * drag.worldPerPixel
      const dy = (point.y - drag.start.y) * drag.worldPerPixel
      const delta = [0, 1, 2].map((index) => drag.right[index] * dx - drag.up[index] * dy) as Vec3
      onGizmoMove({ mode: 'move', delta })
      return
    }

    if (drag.kind === 'ring') {
      const at = projectRef.current?.(drag.origin)
      if (!at) return
      const angle = Math.atan2(point.y - at.y, point.x - at.x)
      let turn = angle - drag.startAngle
      while (turn > Math.PI) turn -= Math.PI * 2
      while (turn < -Math.PI) turn += Math.PI * 2
      onGizmoMove({ mode: 'rotate', axis: drag.axis, degrees: (turn * 180 / Math.PI) * drag.sign })
      return
    }

    const along = (point.x - drag.start.x) * drag.dir.x + (point.y - drag.start.y) * drag.dir.y
    const distance = along * drag.worldPerPixel
    if (gizmoMode === 'scale') {
      onGizmoMove({ mode: 'scale', axis: drag.axis, distance })
      return
    }
    const delta: Vec3 = [0, 0, 0]
    delta[drag.axis] = distance
    onGizmoMove({ mode: 'move', delta })
  }

  const endGizmo = () => {
    if (!gizmoDragRef.current) return
    gizmoDragRef.current = null
    onGizmoEnd?.()
  }

  const gizmoHandles = (
    <svg
      ref={svgRef}
      className={`gizmo-layer mode-${gizmoMode}`}
      preserveAspectRatio="none"
      style={{ display: gizmoOrigin ? undefined : 'none' }}
      onPointerMove={moveGizmo}
      onPointerUp={endGizmo}
      onPointerCancel={endGizmo}
    >
      {[0, 1, 2].map((axis) => (
        <g key={axis} data-gizmo-axis={axis}>
          <line stroke={AXIS_COLORS[axis]} strokeWidth={2} strokeLinecap="round" />
          <circle
            data-gizmo-knob
            r={gizmoMode === 'scale' ? 6 : 7}
            fill={AXIS_COLORS[axis]}
            className="gizmo-knob"
            onPointerDown={(event) => startGizmo(event, axis, 'axis')}
          />
          <text fill={AXIS_COLORS[axis]} textAnchor="middle" className="gizmo-label">{AXIS_NAMES[axis]}</text>
        </g>
      ))}
      {gizmoMode === 'move' && (
        <circle
          data-gizmo-center
          r={9}
          className="gizmo-center"
          onPointerDown={(event) => startGizmo(event, 0, 'view')}
        />
      )}
    </svg>
  )

  // WebGL 캔버스는 regl 이 host 안에 직접 붙이므로, 기즈모 SVG 는 형제로 둔다
  return (
    <div className="viewer-stage">
    <div
      ref={hostRef}
      className="viewer-canvas"
      tabIndex={0}
      aria-label="3D 미리보기. 드래그로 회전, 두 손가락으로 이동과 확대"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        tapRef.current = pointersRef.current.size === 1 ? { x: event.clientX, y: event.clientY, moved: false } : null
        if (pointersRef.current.size > 1) gestureRef.current = true
        onInteractionHint?.()
      }}
      onPointerMove={(event) => {
        const previous = pointersRef.current.get(event.pointerId)
        if (!previous) return
        const pointers = pointersRef.current
        const current = { x: event.clientX, y: event.clientY }
        pointers.set(event.pointerId, current)
        if (tapRef.current && Math.hypot(current.x - tapRef.current.x, current.y - tapRef.current.y) > 4) {
          tapRef.current.moved = true
        }
        if (pointers.size === 1) {
          if (gestureRef.current) return
          const dx = current.x - previous.x
          const dy = current.y - previous.y
          const panning = event.shiftKey || (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
          if (panning) panBy(dx, dy)
          else rotateBy(dx, dy)
          return
        }
        const [a, b] = [...pointers.values()]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const previousPinch = previousPinchRef.current
        if (previousPinch) {
          panBy(center.x - previousPinch.center.x, center.y - previousPinch.center.y)
          const ratio = previousPinch.distance / Math.max(distance, 1)
          zoomBy(Math.min(PINCH_CLAMP.max, Math.max(PINCH_CLAMP.min, ratio)))
        }
        previousPinchRef.current = { distance, center }
      }}
      onPointerUp={(event) => {
        pointersRef.current.delete(event.pointerId)
        if (pointersRef.current.size < 2) previousPinchRef.current = null
        const tap = tapRef.current
        tapRef.current = null
        // 끌지 않고 그대로 뗐으면 그 자리에 있는 객체를 고른다
        if (tap && !tap.moved && !gestureRef.current && onPick) {
          const ray = rayAt(localPoint(event))
          if (ray) onPick(ray)
        }
        if (!pointersRef.current.size) gestureRef.current = false
      }}
      onPointerCancel={(event) => {
        pointersRef.current.delete(event.pointerId)
        previousPinchRef.current = null
        tapRef.current = null
        if (!pointersRef.current.size) gestureRef.current = false
      }}
    />
      {gizmoHandles}
      {showDimensions && (
        <div className="dimension-layer" aria-hidden>
          {['x', 'y', 'z'].map((axis, index) => (
            <span
              key={axis}
              className={`dimension-label ${axis}`}
              ref={(element) => { labelRefs.current[index] = element }}
            />
          ))}
        </div>
      )}
      {showDimensions && <div className="dimension-readout" ref={readoutRef} />}
    </div>
  )
}
