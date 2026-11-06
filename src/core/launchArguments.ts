import { fileKind } from './loadError'

/** The files a command line asks to open: a double-click in Explorer passes the path this way. */
export function openableArguments(argv: string[]): string[] {
  return argv.filter((argument) => !argument.startsWith('-') && fileKind(argument) !== 'other')
}
