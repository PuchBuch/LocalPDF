import { contextBridge, ipcRenderer } from 'electron'

export interface OpenedFile {
  name: string
  bytes: Uint8Array
}

export type SaveResult = { status: 'saved'; name: string } | { status: 'canceled' } | { status: 'failed' }

export type UnsavedAnswer = 'save' | 'discard' | 'cancel'

export type IncomingAnswer = 'add' | 'replace' | 'cancel'

export type PrintResult = 'printed' | 'canceled' | 'failed'

export interface StoredRecovery {
  state: string
  blobs: Record<string, Uint8Array>
}

export interface DialogTexts {
  unsavedMessage: string
  unsavedDetail: string
  save: string
  dontSave: string
  cancel: string
  /** With {names} where the file names go. */
  incomingMessage: string
  incomingDetail: string
  add: string
  replace: string
  filesFilter: string
}

const api = {
  systemLocale: (): Promise<string> => ipcRenderer.invoke('app:system-locale'),
  setDialogTexts: (texts: DialogTexts): void => ipcRenderer.send('app:set-dialog-texts', texts),
  chooseFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('files:choose'),
  takeStartupFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('files:take-startup'),
  onIncomingFiles: (listener: (files: OpenedFile[]) => void): void => {
    ipcRenderer.on('files:incoming', (_event, files: OpenedFile[]) => listener(files))
  },
  askUnsavedChanges: (): Promise<UnsavedAnswer> => ipcRenderer.invoke('document:ask-unsaved'),
  askIncomingFiles: (names: string[]): Promise<IncomingAnswer> => ipcRenderer.invoke('document:ask-incoming', names),
  setUnsavedChanges: (unsaved: boolean): void => ipcRenderer.send('document:set-unsaved', unsaved),
  onSaveAndClose: (listener: () => void): void => {
    ipcRenderer.on('window:save-and-close', () => listener())
  },
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  saveFile: (suggestedName: string, bytes: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('file:save', suggestedName, bytes),
  print: (): Promise<PrintResult> => ipcRenderer.invoke('document:print'),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write-text', text),
  readRecovery: (): Promise<StoredRecovery | null> => ipcRenderer.invoke('recovery:read'),
  writeRecovery: (state: string, newBlobs: Record<string, Uint8Array>, keptBlobs: string[]): Promise<void> =>
    ipcRenderer.invoke('recovery:write', state, newBlobs, keptBlobs),
  clearRecovery: (): Promise<void> => ipcRenderer.invoke('recovery:clear'),
  recoveryAccepted: (): Promise<void> => ipcRenderer.invoke('recovery:accepted')
}

export type LocalPdfApi = typeof api

contextBridge.exposeInMainWorld('localpdf', api)
