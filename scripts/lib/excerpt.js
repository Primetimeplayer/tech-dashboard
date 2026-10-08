// Trim a feed excerpt for the dashboard.
// Empty input stays empty. Short text is kept whole, including its last word
// and closing punctuation. Only text that actually exceeds `max` is cut on a
// word boundary and marked with an ellipsis.

export function excerpt(raw = '', max = 240) {
  const text = String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || max <= 0) return '';
  if (text.length <= max) return text;

  let cut = text.slice(0, max);
  const atWord = cut.replace(/\s+\S*$/, '').trim();
  if (atWord) cut = atWord;
  cut = cut.replace(/[.,;:!?]+$/, '').trim();
  return `${cut}…`;
}
