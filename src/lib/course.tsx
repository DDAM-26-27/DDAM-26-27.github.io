import { createContext, useContext, type ReactNode } from 'react';
import type { PublicCourse } from '../../shared/types';
import { api } from './api';
import { useLoad } from './hooks';

const Ctx = createContext<{ course: PublicCourse | null; error: string | null; reload: () => void }>({
  course: null,
  error: null,
  reload: () => {},
});

export function CourseProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useLoad(() => api.get<PublicCourse>('/public/course'));
  return <Ctx.Provider value={{ course: data, error: error?.message ?? null, reload }}>{children}</Ctx.Provider>;
}

export const useCourse = () => useContext(Ctx);
