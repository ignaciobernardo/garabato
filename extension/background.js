// Inject Garabato into the active tab (or toggle it if it's already there).
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['garabato.js'] });
  } catch (err) {
    // chrome:// pages, the Chrome Web Store, the PDF viewer, etc. don't allow scripts
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#FF3B30' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({ tabId: tab.id, title: chrome.i18n.getMessage('cantOpen') });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {}), 2500);
    console.warn('Garabato:', err);
  }
});
