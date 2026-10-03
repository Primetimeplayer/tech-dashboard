function loadRecentItems() {
  try {
    const items = JSON.parse(localStorage.getItem('techDashboardRecents') || '[]');
    return Array.isArray(items) ? items : [];
  } catch (e) {
    return [];
  }
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-recent-title]');
  if (!link) return;

  const title = link.dataset.recentTitle;
  const url = link.href;
  if (!title || !url) return;

  const recents = loadRecentItems().filter(item => item && item.url !== url);
  recents.unshift({ title, url });

  localStorage.setItem('techDashboardRecents', JSON.stringify(recents.slice(0, 5)));
});

function renderRecents() {
  const container = document.getElementById('recentArticles');
  if (!container) return;

  const fragment = document.createDocumentFragment();
  for (const item of loadRecentItems()) {
    if (!item || typeof item.url !== 'string' || !item.url.trim() ||
        typeof item.title !== 'string' || !item.title.trim()) continue;

    let url;
    try {
      url = new URL(item.url);
    } catch (e) {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

    const anchor = document.createElement('a');
    anchor.className = 'recent-item';
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.href = url.href;
    anchor.textContent = item.title;
    fragment.appendChild(anchor);
  }
  container.replaceChildren(fragment);
}

renderRecents();
