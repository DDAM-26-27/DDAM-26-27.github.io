import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { CourseProvider, useCourse } from './lib/course';
import { BookingHomePage } from './pages/Booking';
import { MaterialsPage, NewsPage, ProjectPage, ProjectsPage, SiteHomePage } from './pages/Site';
import { BookPage } from './pages/Book';
import { ManagePage } from './pages/Manage';
import { SchedulePage } from './pages/Schedule';
import { PrivacyPage } from './pages/Privacy';
import { AdminApp } from './pages/admin/AdminApp';
import { cx } from './components/ui';

function PublicLayout({ children }: { children: React.ReactNode }) {
  const { course } = useCourse();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <span>
              <span className="block text-sm font-semibold leading-tight text-slate-900">DDAM</span>
              <span className="block text-xs leading-tight text-slate-500">
                {course ? `${course.academicYear} · ${course.institution}` : 'Distributed Data Analysis and Mining'}
              </span>
            </span>
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {[
              ['/', 'Home'],
              ['/materials', 'Materials'],
              ['/news', 'News'],
              ['/projects', 'Past projects'],
              ['/booking', 'Exam booking'],
            ].map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cx('rounded-md px-3 py-1.5', isActive ? 'bg-blue-50 font-medium text-blue-800' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <footer className="no-print border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl space-y-1 px-4 py-4 text-xs text-slate-500">
          <p>
            Course website for {course?.name ?? 'Distributed Data Analysis and Mining'}. This is not an official University of Pisa website.
            The exam booking page is an organizational tool, <strong>not</strong> the official exam registration: you must still register
            through the official university channels.
          </p>
          <p>
            <Link className="underline" to="/manage">
              My booking
            </Link>{' '}
            ·{' '}
            <Link className="underline" to="/privacy">
              Privacy
            </Link>
            {course?.contactEmail && (
              <>
                {' '}
                · Questions:{' '}
                <a className="underline" href={`mailto:${course.contactEmail}`}>
                  {course.contactEmail}
                </a>
              </>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}

export function App() {
  const loc = useLocation();
  if (loc.pathname.startsWith('/admin')) return <AdminApp />;
  return (
    <CourseProvider>
      <PublicLayout>
        <Routes>
          <Route path="/" element={<SiteHomePage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:slug" element={<ProjectPage />} />
          <Route path="/booking" element={<BookingHomePage />} />
          <Route path="/booking/:sessionId" element={<BookPage />} />
          <Route path="/book/:sessionId" element={<BookPage />} />
          <Route path="/manage" element={<ManagePage />} />
          <Route path="/schedule/:sessionId" element={<SchedulePage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route
            path="*"
            element={
              <p className="text-slate-600">
                Page not found.{' '}
                <Link className="text-blue-700 underline" to="/">
                  Go to the home page
                </Link>
              </p>
            }
          />
        </Routes>
      </PublicLayout>
    </CourseProvider>
  );
}
