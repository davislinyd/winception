import { useEffect, useMemo, useState } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

interface SearchEntry { id: string; title: string; description: string; headings: string[]; body: string; url: string }

export function LocalSearch(): React.JSX.Element {
  const { i18n } = useDocusaurusContext();
  const locale = i18n.currentLocale;
  const indexUrl = useBaseUrl(`/search/${locale}.json`);
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [query, setQuery] = useState('');
  const zh = locale === 'zh-TW';
  useEffect(() => { void (async () => {
    const response = await fetch(indexUrl);
    const value = JSON.parse(await response.text()) as { entries: SearchEntry[] };
    setEntries(value.entries);
  })(); }, [indexUrl]);
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (normalized.length < 2) return [];
    return entries.filter((entry) => `${entry.title} ${entry.description} ${entry.headings.join(' ')} ${entry.body}`.toLocaleLowerCase(locale).includes(normalized)).slice(0, 8);
  }, [entries, locale, query]);
  return (
    <section className="interactive-card" aria-labelledby="local-search-title">
      <h2 id="local-search-title">{zh ? '本地全文搜尋' : 'Local full-text search'}</h2>
      <p>{zh ? '索引隨文件一起建置；不連接外部搜尋、analytics 或 telemetry。' : 'The index ships with the docs; no external search, analytics or telemetry is used.'}</p>
      <label>{zh ? '搜尋技術文件' : 'Search technical documentation'}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '例如：named pipe、PXE、repair' : 'For example: named pipe, PXE, repair'} /></label>
      {results.length > 0 && <ul className="search-results">{results.map((entry) => <li key={entry.id}><Link to={entry.url}>{entry.title}</Link><span>{entry.description}</span></li>)}</ul>}
      {query.trim().length >= 2 && results.length === 0 && <p role="status">{zh ? '找不到符合項目。' : 'No matching documentation.'}</p>}
    </section>
  );
}
