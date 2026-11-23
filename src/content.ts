/**
 * Site content lives in /content as Markdown files with a small front-matter header. They are
 * bundled at build time, so editing a file on GitHub and pushing republishes the site.
 */
import { Marked } from 'marked';

export interface Doc {
  slug: string;
  meta: Record<string, string>;
  html: string;
}

const marked = new Marked({
  gfm: true,
  renderer: {
    // Never render raw HTML from content files (project pages come from student pull requests).
    html: ({ text }) => (text.trim().startsWith('<!--') ? '' : escapeHtml(text)),
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safe = /^(https?:|mailto:|\/|#)/i.test(href) ? href : '#';
      const external = /^https?:/i.test(safe);
      return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    },
  },
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function parse(slug: string, raw: string): Doc {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const meta: Record<string, string> = {};
  let body = raw;
  if (m) {
    body = m[2];
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
      if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return { slug, meta, html: marked.parse(body) as string };
}

const slugOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '');
const load = (files: Record<string, string>) =>
  Object.entries(files)
    .filter(([p]) => !slugOf(p).startsWith('_'))
    .map(([p, raw]) => parse(slugOf(p), raw));

const pages = import.meta.glob('/content/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const newsFiles = import.meta.glob('/content/news/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const projectFiles = import.meta.glob('/content/projects/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export function page(name: string): Doc | null {
  const raw = pages[`/content/${name}.md`];
  return raw ? parse(name, raw) : null;
}

export const news: Doc[] = load(newsFiles).sort((a, b) => (b.meta.date ?? b.slug).localeCompare(a.meta.date ?? a.slug));
export const projects: Doc[] = load(projectFiles).sort(
  (a, b) => (b.meta.year ?? '').localeCompare(a.meta.year ?? '') || a.meta.title?.localeCompare(b.meta.title ?? '') || 0,
);
