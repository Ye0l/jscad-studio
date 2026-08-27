import * as modeling from '@jscad/modeling'
import * as stlSerializer from '@jscad/stl-serializer'
import * as threeMfSerializer from '@jscad/3mf-serializer'
import { isTauri } from './platform'

type Maybe<T> = T & { default?: T }
const unwrap = <T,>(module: Maybe<T>): T => module.default ?? module

const jscad = unwrap(modeling as Maybe<typeof modeling>)
const stl = unwrap(stlSerializer as Maybe<typeof stlSerializer>)
const threeMf = unwrap(threeMfSerializer as Maybe<typeof threeMfSerializer>)

export type ExportFormat = 'stl' | '3mf'

export const EXPORT_FORMATS: { id: ExportFormat; label: string; extension: string; note: string }[] = [
  { id: 'stl', label: 'STL', extension: 'stl', note: '모든 슬라이서가 읽는 표준 형식. 바이너리로 저장한다.' },
  { id: '3mf', label: '3MF', extension: '3mf', note: '단위와 색을 함께 담는 최신 형식. 큐라·프루사·뱀부에서 열린다.' },
]

// 앱은 형상을 unknown[] 으로 들고 다니므로 측정 함수에 넘길 때만 좁힌다
type Solid = Parameters<typeof jscad.measurements.measureAggregateVolume>[0]
const asSolids = (geometries: unknown[]) => geometries as Solid[]

export interface ModelStats {
  size: [number, number, number]
  volume: number
}

/** 내보내기 전에 확인할 모델 크기(mm)와 부피(mm³) */
export const measureModel = (geometries: unknown[]): ModelStats | null => {
  if (!geometries.length) return null
  try {
    const [min, max] = jscad.measurements.measureAggregateBoundingBox(...asSolids(geometries)) as [number[], number[]]
    return {
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
      volume: jscad.measurements.measureAggregateVolume(...asSolids(geometries)),
    }
  } catch {
    return null
  }
}

const toBytes = (chunks: (ArrayBuffer | Uint8Array | string)[]) => {
  const encoder = new TextEncoder()
  const parts = chunks.map((chunk) =>
    typeof chunk === 'string' ? encoder.encode(chunk)
      : chunk instanceof Uint8Array ? chunk
        : new Uint8Array(chunk))
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

// 바이너리 STL 은 헤더·개수·삼각형이 따로 나뉘어 오므로 하나로 이어 붙여야 한다
export const serializeGeometries = (format: ExportFormat, geometries: unknown[]) => (
  format === 'stl'
    ? toBytes(stl.serialize({ binary: true }, ...geometries))
    : toBytes(threeMf.serialize({}, ...geometries))
)

const safeFileName = (name: string) => (name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'model')

/** 저장한 위치를 돌려준다. 사용자가 취소하면 null. */
export const exportGeometries = async (
  projectName: string,
  format: ExportFormat,
  geometries: unknown[],
): Promise<string | null> => {
  if (!geometries.length) throw new Error('내보낼 형상이 없습니다. 먼저 코드를 실행하세요.')
  const spec = EXPORT_FORMATS.find((item) => item.id === format)!
  const fileName = `${safeFileName(projectName)}.${spec.extension}`
  const bytes = serializeGeometries(format, geometries)

  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.append(link)
    link.click()
    link.remove()
    // 브라우저가 내려받기를 시작할 시간을 준 뒤 해제한다
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return fileName
  }

  const { save } = await import('@tauri-apps/plugin-dialog')
  const target = await save({ defaultPath: fileName, filters: [{ name: spec.label, extensions: [spec.extension] }] })
  if (!target) return null
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(target, bytes)
  return target
}
