import type { MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { news, page, projects, type Doc } from '../content';
import { useTitle } from '../lib/hooks';
import { Alert, Card, PageTitle } from '../components/ui';

const REPO = import.meta.env.VITE_SITE_REPO || 'DDAM-26-27/DDAM-26-27.github.io';

/** Renders Markdown HTML; internal links navigate without a page reload. */
export function Prose({ html }: { html: string }) {
  const nav = useNavigate();
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (a && href?.startsWith('/') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      nav(href);
    }
  };
  return <div className="prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

function formatDate(d?: string) {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return d ?? '';
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function ContentPage({ name, fallbackTitle }: { name: string; fallbackTitle: string }) {
  const doc = page(name);
  useTitle(doc?.meta.title ?? fallbackTitle);
  return (
    <>
      <PageTitle sub={doc?.meta.subtitle}>{doc?.meta.title ?? fallbackTitle}</PageTitle>
      <Card>{doc ? <Prose html={doc.html} /> : <p className="text-slate-600">Nothing here yet.</p>}</Card>
    </>
  );
}

export function SiteHomePage() {
  const doc = page('home');
  useTitle('');
  const cards: [string, string, string][] = [
    ['/booking', 'Exam booking', 'Register your group for an oral examination day.'],
    ['/materials', 'Materials', 'Slides, notebooks and readings.'],
    ['/news', 'News', 'Announcements and updates.'],
    ['/projects', 'Past projects', 'Projects published by previous students.'],
  ];
  return (
    <>
      <PageTitle sub={doc?.meta.subtitle}>{doc?.meta.title ?? 'Course website'}</PageTitle>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([to, title, text]) => (
          <Link
            key={to}
            to={to}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300 hover:bg-blue-50/40"
          >
            <p className="font-semibold text-blue-800">{title} →</p>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">{doc ? <Prose html={doc.html} /> : <p>Welcome.</p>}</Card>
        <Card
          title="Latest news"
          actions={
            <Link to="/news" className="text-sm text-blue-700 hover:underline">
              All news
            </Link>
          }
        >
          {news.length === 0 && <p className="text-sm text-slate-600">No news yet.</p>}
          <ul className="space-y-3">
            {news.slice(0, 3).map((n) => (
              <li key={n.slug}>
                <p className="text-xs text-slate-500">{formatDate(n.meta.date)}</p>
                <Link to={`/news#${n.slug}`} className="text-sm font-medium text-slate-900 hover:underline">
                  {n.meta.title ?? n.slug}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

export const MaterialsPage = () => <ContentPage name="materials" fallbackTitle="Materials" />;

export function NewsPage() {
  useTitle('News');
  return (
    <>
      <PageTitle>News</PageTitle>
      {news.length === 0 && <Alert tone="neutral">No news yet.</Alert>}
      <div className="space-y-4">
        {news.map((n) => (
          <Card key={n.slug}>
            <article id={n.slug} className="scroll-mt-20">
              <p className="text-xs text-slate-500">{formatDate(n.meta.date)}</p>
              <h2 className="mb-2 text-lg font-semibold">{n.meta.title ?? n.slug}</h2>
              <Prose html={n.html} />
            </article>
          </Card>
        ))}
      </div>
    </>
  );
}

function ProjectCard({ p }: { p: Doc }) {
  return (
    <Link to={`/projects/${p.slug}`} className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300">
      <p className="text-xs text-slate-500">{p.meta.year}</p>
      <p className="font-semibold text-slate-900">{p.meta.title ?? p.slug}</p>
      {p.meta.team && <p className="text-sm text-slate-600">{p.meta.team}</p>}
      {p.meta.summary && <p className="mt-2 text-sm text-slate-700">{p.meta.summary}</p>}
    </Link>
  );
}

export function ProjectsPage() {
  useTitle('Past projects');
  return (
    <>
      <PageTitle sub="Projects that previous students chose to share, as inspiration for your own.">Past projects</PageTitle>
      {projects.length === 0 && (
        <div className="mb-4">
          <Alert tone="neutral">No projects have been published yet.</Alert>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {projects.map((p) => (
          <ProjectCard key={p.slug} p={p} />
        ))}
      </div>
      <Card className="mt-6" title="Publish your project">
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            Finished the exam and want to help next year&apos;s students? You can publish a short page about your project, with a link to
            its GitHub repository. Publishing is voluntary, and <strong>every team member must agree</strong>.
          </p>
          <ul className="list-disc pl-5">
            <li>
              <a
                className="text-blue-700 underline"
                href={`https://github.com/${REPO}/issues/new?template=publish-project.yml`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Fill in the “Publish my project” form
              </a>{' '}
              (needs a GitHub account). The lecturer reviews it and adds the page.
            </li>
            <li>
              Or open a pull request that adds a file to{' '}
              <a
                className="text-blue-700 underline"
                href={`https://github.com/${REPO}/tree/main/content/projects`}
                target="_blank"
                rel="noopener noreferrer"
              >
                content/projects
              </a>{' '}
              by copying <code>_TEMPLATE.md</code>.
            </li>
          </ul>
          <p>You can ask for your page to be removed at any time.</p>
        </div>
      </Card>
    </>
  );
}

export function ProjectPage() {
  const { slug = '' } = useParams();
  const p = projects.find((x) => x.slug === slug);
  useTitle(p?.meta.title ?? 'Project');
  if (!p)
    return (
      <Alert tone="red">
        Project not found.{' '}
        <Link to="/projects" className="underline">
          All projects
        </Link>
      </Alert>
    );
  const gh = p.meta.github && /^https:\/\/github\.com\//.test(p.meta.github) ? p.meta.github : null;
  return (
    <>
      <div className="mb-2 text-sm">
        <Link to="/projects" className="text-blue-700 hover:underline">
          ← Past projects
        </Link>
      </div>
      <PageTitle sub={[p.meta.year, p.meta.team].filter(Boolean).join(' · ')}>{p.meta.title ?? p.slug}</PageTitle>
      {gh && (
        <p className="mb-4">
          <a
            href={gh}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            View the repository on GitHub ↗
          </a>
        </p>
      )}
      <Card>
        <Prose html={p.html} />
      </Card>
    </>
  );
}
