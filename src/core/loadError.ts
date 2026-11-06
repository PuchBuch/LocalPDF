export type LoadErrorKind = 'password' | 'unreadable'

export function classifyLoadError(error: unknown): LoadErrorKind {
  return (error as { name?: unknown } | null)?.name === 'PasswordException' ? 'password' : 'unreadable'
}

export type FileKind = 'pdf' | 'jpeg' | 'png' | 'webp' | 'gif' | 'heic' | 'other'

const KINDS_BY_EXTENSION: Record<string, FileKind> = {
  pdf: 'pdf',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  heic: 'heic',
  heif: 'heic'
}

export function fileKind(name: string): FileKind {
  const extension = name.toLowerCase().split('.').at(-1) ?? ''
  return KINDS_BY_EXTENSION[extension] ?? 'other'
}
