import { useRef, useState } from 'react'
import { Anchor as AnchorIcon, Link2Off, Maximize2, Move3d, RotateCw, Ruler, Scale3d } from 'lucide-react'
import { CodeEditor } from './CodeEditor'
import { PRIMITIVES } from '../scene/primitives'
import { boxCenter, boxSize, round } from '../scene/mat'
import { ancestorsOf, BOOLEAN_LABELS, NODE_TYPE_LABELS, setParam, setTransform, patchNode } from '../scene/model'
import type { Anchor, AnchorSide, Axis, BooleanOp, Layout, Scene, Vec3 } from '../scene/types'

interface Props {
  scene: Scene
  layout: Layout
  selection: string[]
  /** typing 이 true 면 코드를 치는 중이라 재계산을 서두르지 않는다 */
  onScene: (next: Scene, options?: { typing?: boolean; coalesce?: string }) => void
  fontSize?: number
  /** 코드 객체를 큰 창에서 열고 싶을 때 */
  onExpandCode?: () => void
  /** 값이 확정됐을 때(입력 끝) 알린다. 무거운 재계산을 미뤄 두는 데 쓴다 */
  onCommit?: () => void
}

const AXIS_LABELS: Record<Axis, string> = { x: 'X', y: 'Y', z: 'Z' }
const SIDE_SHORT: Record<Axis, Record<AnchorSide, string>> = {
  x: { min: '왼쪽', center: '가운데', max: '오른쪽' },
  y: { min: '앞', center: '가운데', max: '뒤' },
  z: { min: '아래', center: '가운데', max: '위' },
}

interface FieldProps {
  label: string
  value: number
  step?: number
  min?: number
  disabled?: boolean
  hint?: string
  onChange: (value: number) => void
  onCommit?: () => void
}

/** 이름표를 좌우로 끌면 값이 바뀐다 — 태블릿에서 숫자를 조금씩 맞출 때 편하다 */
function NumberField({ label, value, step = 1, min, disabled, hint, onChange, onCommit }: FieldProps) {
  const [text, setText] = useState<string | null>(null)
  const scrub = useRef<{ x: number; start: number } | null>(null)

  const commit = (raw: string) => {
    setText(raw)
    const parsed = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(parsed)) onChange(min !== undefined ? Math.max(min, parsed) : parsed)
  }

  return (
    <label className={`num-field${disabled ? ' is-disabled' : ''}`} title={hint}>
      <span
        className="num-label"
        onPointerDown={(event) => {
          if (disabled) return
          event.currentTarget.setPointerCapture(event.pointerId)
          scrub.current = { x: event.clientX, start: value }
        }}
        onPointerMove={(event) => {
          const state = scrub.current
          if (!state) return
          const next = state.start + Math.round((event.clientX - state.x) / 4) * step
          onChange(min !== undefined ? Math.max(min, next) : next)
        }}
        onPointerUp={() => { if (scrub.current) { scrub.current = null; onCommit?.() } }}
        onPointerCancel={() => { scrub.current = null }}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={text ?? String(round(value, 3))}
        onChange={(event) => commit(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={() => { setText(null); onCommit?.() }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const next = value + (event.key === 'ArrowUp' ? step : -step) * (event.shiftKey ? 10 : 1)
          onChange(min !== undefined ? Math.max(min, next) : next)
        }}
      />
    </label>
  )
}

function VectorRow({
  icon, title, value, step, onChange, disabledAxes, hints, onCommit,
}: {
  icon: React.ReactNode
  title: string
  value: Vec3
  step?: number
  onChange: (next: Vec3) => void
  disabledAxes?: Partial<Record<Axis, string>>
  hints?: string
  onCommit?: () => void
}) {
  return (
    <div className="ins-block">
      <div className="ins-block-head"><span className="ins-icon">{icon}</span>{title}{hints && <small>{hints}</small>}</div>
      <div className="ins-grid">
        {(['x', 'y', 'z'] as Axis[]).map((axis, index) => (
          <NumberField
            key={axis}
            label={AXIS_LABELS[axis]}
            value={value[index]}
            step={step}
            disabled={!!disabledAxes?.[axis]}
            hint={disabledAxes?.[axis]}
            onChange={(next) => {
              const copy = [...value] as Vec3
              copy[index] = next
              onChange(copy)
            }}
            onCommit={onCommit}
          />
        ))}
      </div>
    </div>
  )
}

export function Inspector({ scene, layout, selection, onScene, onCommit, fontSize = 13, onExpandCode }: Props) {
  const id = selection[selection.length - 1]
  const node = id ? scene.nodes[id] : null

  if (!node) {
    return (
      <div className="inspector empty">
        <p className="muted-copy">
          객체를 고르면 위치·회전·크기를 숫자로 고칠 수 있습니다.
          {selection.length > 1 ? ' 여러 개를 골랐다면 마지막에 고른 객체를 보여 줍니다.' : ''}
        </p>
      </div>
    )
  }

  const bounds = layout[node.id]?.bounds ?? null
  const size = boxSize(bounds)
  const center = boxCenter(bounds)
  const parent = node.parent ? scene.nodes[node.parent] : null
  const anchor = node.anchor
  const anchorDisabled: Partial<Record<Axis, string>> = {}
  for (const axis of ['x', 'y', 'z'] as Axis[]) {
    if (anchor?.axes[axis]) anchorDisabled[axis] = '상대 배치가 이 축을 정하고 있습니다'
  }
  if (parent?.type === 'stack') anchorDisabled.z = '적층이 Z 를 정하고 있습니다'

  const candidates = Object.values(scene.nodes).filter((item) => {
    if (item.id === node.id) return false
    if (ancestorsOf(scene, item.id).includes(node.id)) return false
    // 서로를 기준으로 삼아 빙빙 도는 것을 막는다
    let cursor: string | null = item.anchor?.target ?? null
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor)) {
      if (cursor === node.id) return false
      seen.add(cursor)
      cursor = scene.nodes[cursor]?.anchor?.target ?? null
    }
    return true
  })

  const updateAnchor = (changes: Partial<Anchor>) => {
    if (!anchor) return
    onScene(patchNode(scene, node.id, { anchor: { ...anchor, ...changes } }))
  }

  const setAxisRule = (axis: Axis, rule: { target: AnchorSide; self: AnchorSide } | null) => {
    if (!anchor) return
    updateAnchor({ axes: { ...anchor.axes, [axis]: rule } })
  }

  return (
    <div className="inspector">
      <header className="ins-head">
        <div>
          <strong>{node.name}</strong>
          <small>{NODE_TYPE_LABELS[node.type]}{node.type === 'primitive' ? ` · ${PRIMITIVES[node.primitive].label}` : ''}</small>
        </div>
        <label className="ins-color" title="색">
          <input
            type="color"
            value={node.color ?? '#52cbb5'}
            onChange={(event) => onScene(patchNode(scene, node.id, { color: event.target.value }))}
          />
          <span style={{ background: node.color ?? 'transparent' }} />
        </label>
        {node.color && (
          <button className="icon-button tiny" title="색 지우기" onClick={() => onScene(patchNode(scene, node.id, { color: null }))}>
            <Link2Off size={15} />
          </button>
        )}
      </header>

      <VectorRow
        icon={<Move3d size={14} />}
        title="위치 (mm)"
        value={node.transform.position}
        onChange={(position) => onScene(setTransform(scene, node.id, { position }))}
        disabledAxes={anchorDisabled}
        onCommit={onCommit}
      />

      <VectorRow
        icon={<RotateCw size={14} />}
        title="회전 (도)"
        value={node.transform.rotation}
        step={15}
        onChange={(rotation) => onScene(setTransform(scene, node.id, { rotation }))}
        onCommit={onCommit}
      />

      {node.type === 'primitive' && (
        <div className="ins-block">
          <div className="ins-block-head"><span className="ins-icon"><Ruler size={14} /></span>크기</div>
          <div className="ins-grid">
            {PRIMITIVES[node.primitive].params.filter((param) => param.group === 'size').map((param) => (
              <NumberField
                key={param.key}
                label={param.label}
                value={node.params[param.key]}
                step={param.step}
                min={param.min}
                onChange={(value) => onScene(setParam(scene, node.id, param.key, value))}
                onCommit={onCommit}
              />
            ))}
          </div>
          <div className="ins-grid detail">
            {PRIMITIVES[node.primitive].params.filter((param) => param.group === 'detail').map((param) => (
              <NumberField
                key={param.key}
                label={param.label}
                value={node.params[param.key]}
                step={param.step}
                min={param.min}
                onChange={(value) => onScene(setParam(scene, node.id, param.key, value))}
                onCommit={onCommit}
              />
            ))}
          </div>
        </div>
      )}

      <VectorRow
        icon={<Scale3d size={14} />}
        title="배율"
        value={node.transform.scale}
        step={0.1}
        onChange={(scale) => onScene(setTransform(scene, node.id, { scale }))}
        onCommit={onCommit}
      />

      {node.type === 'boolean' && (
        <div className="ins-block">
          <div className="ins-block-head">연산</div>
          <div className="ins-choice">
            {(Object.keys(BOOLEAN_LABELS) as BooleanOp[]).map((op) => (
              <button
                key={op}
                className={node.op === op ? 'selected' : ''}
                onClick={() => onScene(patchNode(scene, node.id, { op } as never))}
              >
                {BOOLEAN_LABELS[op]}
              </button>
            ))}
          </div>
          <p className="muted-copy">빼기는 맨 위 자식에서 나머지를 덜어 냅니다.</p>
        </div>
      )}

      {node.type === 'stack' && (
        <div className="ins-block">
          <div className="ins-block-head">기본 간격</div>
          <div className="ins-grid">
            <NumberField
              label="mm"
              value={node.gap}
              step={0.5}
              onChange={(gap) => onScene(patchNode(scene, node.id, { gap } as never))}
              onCommit={onCommit}
            />
          </div>
          <p className="muted-copy">층별 간격은 적층 편집기에서 따로 줄 수 있습니다.</p>
        </div>
      )}

      {node.type === 'code' && (
        <div className="ins-block">
          <div className="ins-block-head">
            코드
            {onExpandCode && (
              <button className="ins-link" onClick={onExpandCode}><Maximize2 size={12} />큰 창에서</button>
            )}
          </div>
          <div className="ins-code">
            <CodeEditor
              value={node.code}
              fontSize={fontSize}
              onChange={(code) => onScene(
                patchNode(scene, node.id, { code } as never),
                { typing: true, coalesce: `code:${node.id}` },
              )}
            />
          </div>
          <p className="muted-copy">module.exports = &#123; main &#125; 형태로 형상을 돌려주세요. 아래 모서리를 끌면 높이를 바꿀 수 있습니다.</p>
        </div>
      )}

      <div className="ins-block">
        <div className="ins-block-head">
          <span className="ins-icon"><AnchorIcon size={14} /></span>
          상대 배치
          {anchor && (
            <button className="ins-link" onClick={() => onScene(patchNode(scene, node.id, { anchor: null }))}>해제</button>
          )}
        </div>
        {!candidates.length ? (
          <p className="muted-copy">기준으로 삼을 다른 객체가 없습니다.</p>
        ) : !anchor ? (
          <select
            className="ins-select"
            value=""
            onChange={(event) => {
              if (!event.target.value) return
              onScene(patchNode(scene, node.id, {
                anchor: {
                  target: event.target.value,
                  axes: { x: null, y: null, z: null },
                  offset: [0, 0, 0],
                } satisfies Anchor,
              }))
            }}
          >
            <option value="">기준 객체 고르기…</option>
            {candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : (
          <div className="anchor-editor">
            <select className="ins-select" value={anchor.target} onChange={(event) => updateAnchor({ target: event.target.value })}>
              {candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <div className="anchor-legend"><span /><span>기준 객체에서</span><span>내 쪽에서</span><span>더하기</span></div>
            {(['x', 'y', 'z'] as Axis[]).map((axis, index) => {
              const rule = anchor.axes[axis]
              return (
                <div className="anchor-row" key={axis}>
                  <span className="anchor-axis">{AXIS_LABELS[axis]}</span>
                  <select
                    value={rule ? rule.target : ''}
                    onChange={(event) => setAxisRule(axis, event.target.value
                      ? { target: event.target.value as AnchorSide, self: rule?.self ?? 'center' }
                      : null)}
                  >
                    <option value="">안 씀</option>
                    {(['min', 'center', 'max'] as AnchorSide[]).map((side) => (
                      <option key={side} value={side}>{SIDE_SHORT[axis][side]}</option>
                    ))}
                  </select>
                  <select
                    value={rule ? rule.self : 'center'}
                    disabled={!rule}
                    onChange={(event) => rule && setAxisRule(axis, { target: rule.target, self: event.target.value as AnchorSide })}
                  >
                    {(['min', 'center', 'max'] as AnchorSide[]).map((side) => (
                      <option key={side} value={side}>{SIDE_SHORT[axis][side]}</option>
                    ))}
                  </select>
                  <NumberField
                    label=""
                    value={anchor.offset[index]}
                    disabled={!rule}
                    onChange={(value) => {
                      const offset = [...anchor.offset] as Vec3
                      offset[index] = value
                      updateAnchor({ offset })
                    }}
                    onCommit={onCommit}
                  />
                </div>
              )
            })}
            <p className="muted-copy">
              기준 객체가 커지거나 움직이면 이 객체도 따라갑니다.
              예를 들어 Z 를 “위 / 아래”로 두면 기준 객체 윗면에 이 객체 바닥이 붙습니다.
            </p>
          </div>
        )}
      </div>

      <dl className="ins-facts">
        <div><dt>크기</dt><dd>{size.map((value) => round(value, 2)).join(' × ')} mm</dd></div>
        <div><dt>가운데</dt><dd>{center.map((value) => round(value, 2)).join(', ')}</dd></div>
        <div><dt>바닥 Z</dt><dd>{bounds ? round(bounds.min[2], 2) : '–'}</dd></div>
      </dl>
    </div>
  )
}
