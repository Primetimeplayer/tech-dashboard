// Region and language choices for the news feeds.
// Google News wants hl, gl, and ceid on the RSS URL. Other publishers get the
// same gl and hl query when they tolerate it. The Verge 404s if a query
// string is added, so that host is left untouched.

export const DEFAULT_REGION = 'US';
export const DEFAULT_LANGUAGE = 'en-US';

export const REGIONS = [
  { id: 'US', label: 'Worldwide / US' },
  { id: 'GB', label: 'United Kingdom' },
  { id: 'INT', label: 'Global / International' },
  { id: 'DE', label: 'Germany' },
  { id: 'FR', label: 'France' },
  { id: 'JP', label: 'Japan' },
  { id: 'IN', label: 'India' },
  { id: 'ES', label: 'Spain' },
  { id: 'BR', label: 'Brazil' },
  { id: 'MX', label: 'Mexico' },
  { id: 'CA', label: 'Canada' },
  { id: 'AU', label: 'Australia' },
  { id: 'KR', label: 'South Korea' },
  { id: 'IT', label: 'Italy' },
  { id: 'NL', label: 'Netherlands' },
];

export const LANGUAGES = [
  { id: 'en-US', label: 'English' },
  { id: 'es-419', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'ja', label: 'Japanese' },
  { id: 'pt-BR', label: 'Portuguese' },
  { id: 'hi', label: 'Hindi' },
  { id: 'ko', label: 'Korean' },
  { id: 'zh-CN', label: 'Chinese' },
  { id: 'it', label: 'Italian' },
  { id: 'nl', label: 'Dutch' },
];

const QUERY_BLOCKLIST = new Set(['www.theverge.com', 'theverge.com']);

// Google serves these English editions directly. hl=en-US with another gl
// often redirects, and that redirect comes back as 503 from some networks.
const ENGLISH_HL = {
  US: 'en-US',
  GB: 'en-GB',
  IN: 'en-IN',
  AU: 'en-AU',
  CA: 'en-CA',
};

function ceidLanguage(language) {
  if (language.startsWith('en')) return 'en';
  if (language === 'pt-BR') return 'pt-419';
  if (language === 'zh-CN') return 'zh-Hans';
  return language;
}

function headlineLanguage(region, language) {
  if (language.startsWith('en')) return ENGLISH_HL[region] || 'en-US';
  return language;
}

export function normalizeRegion(value) {
  const id = String(value || '').trim().toUpperCase();
  return REGIONS.some((region) => region.id === id) ? id : DEFAULT_REGION;
}

export function normalizeLanguage(value) {
  const id = String(value || '').trim();
  return LANGUAGES.some((language) => language.id === id) ? id : DEFAULT_LANGUAGE;
}

// Google News RSS: hl is the language, gl is the edition, ceid is region:language.
// ceid uses the language tag Google actually serves (en, not en-US). Global /
// International has no gl code, so it uses the world topic and a US edition.
export function googleNewsUrl(region, language) {
  const gl = normalizeRegion(region);
  const selected = normalizeLanguage(language);
  const edition = gl === 'INT' ? 'US' : gl;
  const hl = headlineLanguage(edition, selected);
  const lang = ceidLanguage(selected);
  if (gl === 'INT') {
    return `https://news.google.com/rss/headlines/section/topic/WORLD?hl=${hl}&gl=US&ceid=US:${lang}`;
  }
  return `https://news.google.com/rss?hl=${hl}&gl=${edition}&ceid=${edition}:${lang}`;
}

export function applyLocaleParams(url, region, language) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return String(url || '');
  }
  if (parsed.hostname === 'news.google.com') return googleNewsUrl(region, language);
  if (QUERY_BLOCKLIST.has(parsed.hostname)) return parsed.toString();
  const gl = normalizeRegion(region);
  const hl = normalizeLanguage(language);
  parsed.searchParams.set('gl', gl === 'INT' ? 'US' : gl);
  parsed.searchParams.set('hl', hl);
  return parsed.toString();
}
