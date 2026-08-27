// 배포되는 의존성의 라이선스 고지를 THIRD-PARTY-NOTICES.md 로 생성한다.
// 사용법: node scripts/generate-notices.mjs   (npm install 과 cargo 가 필요)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ANDROID_TARGET = 'aarch64-linux-android'
const LICENSE_FILE = /^(LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE)([-.].*)?$/i

const run = (command, args, cwd = ROOT) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

// 패키지 디렉터리의 라이선스 원문을 파일 단위로 읽는다.
// 파일마다 따로 담아야 Apache-2.0 처럼 여러 패키지가 공유하는 긴 원문을 한 번만 실을 수 있다.
const readLicenseTexts = (dir) => {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8').trim())
    .filter(Boolean)
}

const collectJs = () => {
  const output = run('npm', ['ls', '--omit=dev', '--all', '--parseable'])
  const dirs = [...new Set(output.split('\n').map((line) => line.trim()).filter(Boolean))]
  return dirs
    .filter((dir) => dir !== ROOT)
    .map((dir) => {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      const license = typeof manifest.license === 'string'
        ? manifest.license
        : manifest.license?.type ?? manifest.licenses?.map((entry) => entry.type).join(' OR ') ?? 'UNKNOWN'
      const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
      return {
        name: manifest.name,
        version: manifest.version,
        license,
        url: (repository ?? manifest.homepage ?? '').replace(/^git\+/, '').replace(/\.git$/, ''),
        texts: readLicenseTexts(dir),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

const collectRust = () => {
  const raw = run(
    'cargo',
    ['metadata', '--format-version', '1', '--locked', '--filter-platform', ANDROID_TARGET],
    join(ROOT, 'src-tauri'),
  )
  const metadata = JSON.parse(raw)
  const used = new Set(metadata.resolve.nodes.map((node) => node.id))
  return metadata.packages
    .filter((pkg) => used.has(pkg.id) && !metadata.workspace_members.includes(pkg.id))
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? 'UNKNOWN',
      url: pkg.repository ?? pkg.homepage ?? '',
      texts: readLicenseTexts(dirname(pkg.manifest_path)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// 저작권자 표시 없이 표준 전문만 담은 사본은 사본마다 사소한 서식 차이가 있어도 한 벌로 묶는다
const STANDARD_TEXTS = [
  { id: 'Apache-2.0', match: /^Apache License\s+Version 2\.0, January 2004/ },
  { id: 'MPL-2.0', match: /^Mozilla Public License Version 2\.0/ },
]

// 같은 원문을 쓰는 패키지가 많으므로 원문은 한 번만 싣고 사용 패키지를 함께 적는다
const groupTexts = (packages) => {
  const groups = new Map()
  for (const pkg of packages) {
    for (const text of pkg.texts) {
      const normalized = text.replace(/\s+/g, ' ').trim()
      const standard = STANDARD_TEXTS.find((entry) => entry.match.test(normalized))
      const key = standard ? standard.id : createHash('sha1').update(normalized).digest('hex')
      if (!groups.has(key)) groups.set(key, { text, users: [] })
      groups.get(key).users.push(`${pkg.name} ${pkg.version}`)
    }
  }
  return [...groups.values()].sort((a, b) => b.users.length - a.users.length)
}

const table = (packages) => [
  '| 패키지 | 버전 | 라이선스 | 출처 |',
  '| --- | --- | --- | --- |',
  ...packages.map((pkg) => `| ${pkg.name} | ${pkg.version} | ${pkg.license} | ${pkg.url} |`),
].join('\n')

const section = (title, packages) => {
  const missing = packages.filter((pkg) => !pkg.texts.length).map((pkg) => `${pkg.name} ${pkg.version}`)
  return [
    `## ${title} (${packages.length}개)`,
    '',
    table(packages),
    '',
    missing.length ? `> 배포물에 라이선스 원문 파일이 없는 패키지: ${missing.join(', ')}\n` : '',
    ...groupTexts(packages).map(({ text, users }) => [
      `### ${users.join(', ')}`,
      '',
      '```',
      text,
      '```',
      '',
    ].join('\n')),
  ].join('\n')
}

const js = collectJs()
const rust = collectRust()
const document = [
  '# 서드파티 라이선스 고지',
  '',
  'JSCAD Studio는 아래 오픈소스 소프트웨어를 포함해 배포됩니다. 각 저작권자와 라이선스 원문을 그대로 싣습니다.',
  '이 파일은 `node scripts/generate-notices.mjs` 로 자동 생성되므로 직접 고치지 마세요.',
  '',
  `생성 기준: 프런트엔드는 npm 런타임 의존성, 네이티브는 \`${ANDROID_TARGET}\` 대상 Rust 크레이트입니다.`,
  '',
  section('프런트엔드 (npm)', js),
  section('네이티브 (Rust / Cargo)', rust),
].join('\n')

writeFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), document.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n')
console.log(`npm ${js.length}개, cargo ${rust.length}개 기록`)
