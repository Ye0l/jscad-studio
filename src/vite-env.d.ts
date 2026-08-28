/// <reference types="vite/client" />

// JSCAD 직렬화 패키지는 타입 선언을 배포하지 않는다
declare module '@jscad/stl-serializer' {
  export const mimeType: string
  export function serialize(options: { binary?: boolean }, ...objects: unknown[]): (ArrayBuffer | string)[]
}

declare module '@jscad/3mf-serializer' {
  export const mimeType: string
  export function serialize(options: Record<string, unknown>, ...objects: unknown[]): (ArrayBuffer | Uint8Array)[]
}
