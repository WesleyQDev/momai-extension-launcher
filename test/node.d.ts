declare module 'node:module' {
  export function createRequire(filename: string): (specifier: string) => any
}

interface ImportMeta {
  url: string
}
