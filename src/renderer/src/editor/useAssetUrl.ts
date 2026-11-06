import { useEditor } from '../store'

// Assets never change once added, and undo can bring one back at any time.
const urls = new Map<string, string>()

/** A URL to show an image asset with. */
export function useAssetUrl(assetId: string | null): string | null {
  const asset = useEditor((state) => (assetId ? state.document?.assets[assetId] : undefined))
  if (!assetId || !asset) return null

  let url = urls.get(assetId)
  if (!url) {
    url = URL.createObjectURL(new Blob([asset.bytes.slice()], { type: asset.mime }))
    urls.set(assetId, url)
  }
  return url
}
