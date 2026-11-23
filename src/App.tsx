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

const NAV: { to: string; label: string; icon: string; highlight?: boolean }[] = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/booking', label: 'Exam booking', icon: '📅', highlight: true },
  { to: '/manage', label: 'My booking', icon: '🔑' },
  { to: '/materials', label: 'Materials', icon: '📚' },
  { to: '/news', label: 'News', icon: '📰' },
  { to: '/projects', label: 'Past projects', icon: '💾' },
];

function PublicLayout({ children }: { children: React.ReactNode }) {
  const { course } = useCourse();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print">
        {/* University bar, as on di.unipi.it */}
        <div className="bg-unipi-dark text-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 text-xs">
            <a
              href="https://www.unipi.it"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold tracking-[0.2em] uppercase hover:underline"
            >
              Università di Pisa
            </a>
            <a href="https://di.unipi.it" target="_blank" rel="noopener noreferrer" className="hover:underline">
              Dipartimento di Informatica ↗
            </a>
          </div>
        </div>
        <div className="border-b-4 border-unipi bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
            <Link to="/" className="flex items-center gap-3">
              <img src="/favicon.svg" alt="" className="h-12 w-12" />
              <span>
                <span className="block text-xl leading-tight font-bold text-unipi sm:text-2xl">
                  {course?.name ?? 'Distributed Data Analysis and Mining (DDAM)'}
                </span>
                <span className="block text-sm leading-tight text-slate-600">
                  {course ? `Academic year ${course.academicYear}` : 'Course website'}
                </span>
              </span>
            </Link>
            <Link
              to="/booking"
              className="btn98 btn98-primary hidden px-3 py-1.5 text-sm font-bold sm:inline-flex sm:items-center sm:gap-2"
            >
              <span className="blink bg-[#ffd700] px-1 text-xs text-black">NEW!</span> Book your oral exam here →
            </Link>
          </div>
        </div>
        {/* Menu: a Windows 98 toolbar */}
        <nav className="win-raised" aria-label="Main menu">
          <div className="mx-auto flex max-w-5xl flex-wrap gap-1 px-3 py-1.5 text-sm">
            {NAV.map(({ to, label, icon, highlight }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cx('btn98 inline-flex items-center gap-1.5 px-3 py-1', highlight && 'font-bold', isActive && 'bg-white! font-bold')
                }
              >
                <span aria-hidden>{icon}</span>
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      {/* Footer: a Windows status bar */}
      <footer className="no-print win-raised text-xs">
        <div className="mx-auto max-w-5xl space-y-1.5 px-3 py-2">
          <p className="win-sunken bg-tooltip px-2 py-1">
            ⚠ This is <strong>not</strong> an official University of Pisa website. Booking here does <strong>not</strong> replace the
            official exam registration: you must still register through the official university channels.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <span className="win-sunken px-2 py-0.5">
              <Link className="text-[#0000ee] underline" to="/manage">
                My booking
              </Link>
            </span>
            <span className="win-sunken px-2 py-0.5">
              <Link className="text-[#0000ee] underline" to="/privacy">
                Privacy
              </Link>
            </span>
            {course?.contactEmail && (
              <span className="win-sunken px-2 py-0.5">
                Questions:{' '}
                <a className="text-[#0000ee] underline" href={`mailto:${course.contactEmail}`}>
                  {course.contactEmail}
                </a>
              </span>
            )}
            <span className="win-sunken ml-auto px-2 py-0.5 text-slate-600">Best viewed with any browser · 800×600 or higher</span>
          </div>
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
