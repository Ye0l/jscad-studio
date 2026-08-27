import { useEffect, useRef } from 'react'
import * as rendererModule from '@jscad/regl-renderer'

interface Props {
  geometries: unknown[]
  showGrid: boolean
  rotateSensitivity: number
  zoomSensitivity: number
  onInteractionHint?: () => void
}

type Point = { x: number; y: number }
type Vector = ArrayLike<number>

// 감도 기본값(0.35)에서 휠 한 칸이 약 12% 줌, 핀치는 손가락 간격 변화와 1:1이 되도록 맞춘 계수
const WHEEL_STEP = 0.34
const PINCH_GAIN = 2.85

const distanceBetween = (a: Vector, b: Vector) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// 휠 한 칸을 1로 환산한다 (브라우저·기기마다 deltaY 단위가 달라서 정규화가 필요)
const wheelNotches = (event: WheelEvent) => {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
  return Math.max(-4, Math.min(4, (event.deltaY * unit) / 100))
}

export function Viewer({ geometries, showGrid, rotateSensitivity, zoomSensitivity, onInteractionHint }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<any>(null)
  const pointersRef = useRef(new Map<number, Point>())
  const previousPinchRef = useRef<{ distance: number; center: Point } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
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
      limits: { ...orbit.defaults.limits },
      zoomToFit: { ...orbit.defaults.zoomToFit },
      userControl: { ...orbit.defaults.userControl },
      autoRotate: { ...orbit.defaults.autoRotate },
    }
    const options: any = {
      glOptions: { container: host, attributes: { antialias: true, alpha: false } },
      camera,
      drawCommands: {
        drawAxis: renderer.drawCommands.drawAxis,
        drawGrid: renderer.drawCommands.drawGrid,
        drawLines: renderer.drawCommands.drawLines,
        drawMesh: renderer.drawCommands.drawMesh,
      },
      rendering: { background: [0.055, 0.063, 0.078, 1] },
      entities: [],
    }
    const render = renderer.prepareRender(options)
    let viewport = { width: 1, height: 1 }
    const resize = () => {
      const rect = host.getBoundingClientRect()
      viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
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

    let frame = 0
    const animate = () => {
      const update = orbit.update({ controls, camera })
      Object.assign(controls, update.controls)
      Object.assign(camera, update.camera)
      cameraApi.update(camera, camera)
      syncPlanes()
      options.camera = camera
      render(options)
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    runtimeRef.current = { renderer, cameraApi, orbit, camera, controls, options, render }

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      runtimeRef.current = null
      host.replaceChildren()
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const { renderer, orbit, camera, controls, options } = runtime
    const solids = renderer.entitiesFromSolids({ color: [0.27, 0.78, 0.68, 1] }, geometries)
    const guides = [
      { visuals: { drawCmd: 'drawGrid', show: showGrid }, size: [400, 400], ticks: [10, 2] },
      { visuals: { drawCmd: 'drawAxis', show: showGrid }, size: 120 },
    ]
    options.entities = [...guides, ...solids]
    if (solids.length) {
      const fit = orbit.zoomToFit({ controls, camera, entities: solids })
      Object.assign(controls, fit.controls)
      Object.assign(camera, fit.camera)
    }
  }, [geometries, showGrid])

  const rotateBy = (dx: number, dy: number) => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const angle = [dx * 0.008 * rotateSensitivity, -dy * 0.008 * rotateSensitivity]
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

  return (
    <div
      ref={hostRef}
      className="viewer-canvas"
      tabIndex={0}
      aria-label="3D 미리보기. 드래그로 회전, 두 손가락으로 이동과 확대"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        onInteractionHint?.()
      }}
      onPointerMove={(event) => {
        const previous = pointersRef.current.get(event.pointerId)
        if (!previous) return
        const pointers = pointersRef.current
        const current = { x: event.clientX, y: event.clientY }
        pointers.set(event.pointerId, current)
        if (pointers.size === 1) {
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
          const rawRatio = previousPinch.distance / Math.max(distance, 1)
          const gained = 1 + (rawRatio - 1) * zoomSensitivity * PINCH_GAIN
          zoomBy(Math.min(1.6, Math.max(0.625, gained)))
        }
        previousPinchRef.current = { distance, center }
      }}
      onPointerUp={(event) => {
        pointersRef.current.delete(event.pointerId)
        if (pointersRef.current.size < 2) previousPinchRef.current = null
      }}
      onPointerCancel={(event) => {
        pointersRef.current.delete(event.pointerId)
        previousPinchRef.current = null
      }}
    />
  )
}
