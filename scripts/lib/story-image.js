const HTTP_URL = /^https?:\/\//i;

function cleanUrl(value) {
  if (!value) return '';
  const url = String(value).replace(/&amp;/g, '&').trim();
  return HTTP_URL.test(url) ? url : '';
}

function fromMedia(node) {
  if (!node) return '';
  if (typeof node === 'string') return cleanUrl(node);
  if (Array.isArray(node)) {
    for (const entry of node) {
      const url = fromMedia(entry);
      if (url) return url;
    }
    return '';
  }
  return cleanUrl(node.url || node.$?.url || node.href);
}

// First usable http(s) image on an RSS or Reddit item. Empty when the feed
// has no image, so the card can omit the thumbnail.
export function storyImage(item = {}) {
  const enclosure = item.enclosure;
  const enclosureType = String(enclosure?.type || '');
  if (!enclosureType || enclosureType.startsWith('image/')) {
    const enclosed = fromMedia(enclosure);
    if (enclosed) return enclosed;
  }

  const media = fromMedia(item['media:content'] || item.mediaContent);
  if (media) return media;

  const thumb = fromMedia(item['media:thumbnail'] || item.mediaThumbnail || item.thumbnail);
  if (thumb) return thumb;

  const html = `${item['content:encoded'] || ''} ${item.content || ''}`;
  const match = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  return match ? cleanUrl(match[1]) : '';
}
