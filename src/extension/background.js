// A click on the toolbar button opens the editor, or brings back the tab it is already in.
// One tab at a time: the tabs would otherwise share one store for crash recovery.
chrome.action.onClicked.addListener(async () => {
  const [existing] = await chrome.runtime.getContexts({ contextTypes: ['TAB'] })
  if (existing?.tabId >= 0) {
    await chrome.tabs.update(existing.tabId, { active: true })
    await chrome.windows.update(existing.windowId, { focused: true })
    return
  }
  await chrome.tabs.create({ url: 'index.html' })
})
