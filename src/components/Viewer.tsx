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
    const resize = () => {
      const rect = host.getBoundingClientRect()
      cameraApi.setProjection(camera, camera, { width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
      cameraApi.update(camera, camera)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    let frame = 0
    const animate = () => {
      const update = orbit.update({ controls, camera })
      Object.assign(controls, update.controls)
      Object.assign(camera, update.camera)
      cameraApi.update(camera, camera)
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

  const applyGesture = (kind: 'rotate' | 'pan' | 'zoom', delta: number | number[]) => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const state = { controls: runtime.controls, camera: runtime.camera }
    const result = kind === 'rotate'
      ? runtime.orbit.rotate(state, delta)
      : kind === 'pan'
        ? runtime.orbit.pan(state, delta, 0.75)
        : runtime.orbit.zoom(state, delta, 0.085 * zoomSensitivity)
    Object.assign(runtime.controls, result.controls)
    Object.assign(runtime.camera, result.camera)
  }

  return (
    <div
      ref={hostRef}
      className="viewer-canvas"
      tabIndex={0}
      aria-label="3D 미리보기. 드래그로 회전, 두 손가락으로 이동과 확대"
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => {
        event.preventDefault()
        applyGesture('zoom', event.deltaY > 0 ? 1 : -1)
      }}
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
          if (event.shiftKey || event.buttons === 2 || event.button === 2) applyGesture('pan', [dx, dy])
          else applyGesture('rotate', [dx * 0.008 * rotateSensitivity, -dy * 0.008 * rotateSensitivity])
          return
        }
        const [a, b] = [...pointers.values()]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const previousPinch = previousPinchRef.current
        if (previousPinch) {
          const rawRatio = previousPinch.distance / Math.max(distance, 1)
          const dampedRatio = 1 + (rawRatio - 1) * zoomSensitivity
          const safeRatio = Math.min(1.06, Math.max(0.94, dampedRatio))
          const runtime = runtimeRef.current
          if (runtime && Number.isFinite(safeRatio)) runtime.controls.scale *= safeRatio
          applyGesture('pan', [center.x - previousPinch.center.x, center.y - previousPinch.center.y])
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
