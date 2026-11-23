import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { examDuration, validateRules } from '../../../shared/rules';
import { Alert, Button, Card, Field, Input, Loading, PageTitle, Select, Textarea } from '../../components/ui';
import { usePreviewedAction } from './PreviewDialog';
import type { AdminCourse, Overview } from './types';

export function SettingsPage() {
  useTitle('Course & rules');
  const { data, error, loading, reload } = useLoad(() => api.admin.get<Overview>('/admin/overview'));
  const [form, setForm] = useState<AdminCourse | null>(null);
  const [saved, setSaved] = useState(false);
  const { run, dialog } = usePreviewedAction();
  useEffect(() => {
    if (data) setForm(data.course);
  }, [data]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert tone="red">{error.message}</Alert>;
  if (!form) return null;
  const ruleErrors = validateRules(form.rules);
  const num = (key: keyof AdminCourse['rules']) => ({
    type: 'number',
    value: form.rules[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, rules: { ...form.rules, [key]: Number(e.target.value) } }),
  });
  return (
    <>
      {dialog}
      <PageTitle sub="Changes to duration rules recalculate every session; you will see the consequences before they are applied.">
        Course & rules
      </PageTitle>
      {saved && (
        <div className="mb-4">
          <Alert tone="green">Settings saved.</Alert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Examination duration rules">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Presentation (minutes)" htmlFor="r-pres">
              <Input id="r-pres" min={1} {...num('presentationMinutes')} />
            </Field>
            <Field label="Questions per student (minutes)" htmlFor="r-q">
              <Input id="r-q" min={0} {...num('questionsPerStudentMinutes')} />
            </Field>
            <Field label="Recovery break (minutes)" htmlFor="r-b">
              <Input id="r-b" min={0} {...num('breakMinutes')} />
            </Field>
            <div />
            <Field label="Minimum group size" htmlFor="r-min">
              <Input id="r-min" min={1} {...num('minGroupSize')} />
            </Field>
            <Field label="Maximum group size" htmlFor="r-max">
              <Input id="r-max" min={1} max={20} {...num('maxGroupSize')} />
            </Field>
          </div>
          {ruleErrors.length > 0 ? (
            <div className="mt-4">
              <Alert tone="red">{ruleErrors.join(' ')}</Alert>
            </div>
          ) : (
            <table className="mt-4 text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pr-6">Group size</th>
                  <th>Examination duration</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: form.rules.maxGroupSize - form.rules.minGroupSize + 1 }, (_, i) => form.rules.minGroupSize + i).map(
                  (n) => (
                    <tr key={n}>
                      <td>{n}</td>
                      <td>{examDuration(form.rules, n)} minutes</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Course information">
          <div className="space-y-4">
            <Field label="Course name" htmlFor="c-name">
              <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Academic year" htmlFor="c-year">
                <Input id="c-year" value={form.academicYear} onChange={(e) => setForm({ ...form, academicYear: e.target.value })} />
              </Field>
              <Field label="Institution" htmlFor="c-inst">
                <Input id="c-inst" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
              </Field>
            </div>
            <Field label="Description (shown on the home page)" htmlFor="c-desc">
              <Textarea id="c-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Contact email (public)" htmlFor="c-mail">
              <Input
                id="c-mail"
                type="email"
                value={form.contactEmail ?? ''}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Public schedule shows" htmlFor="c-mode">
                <Select
                  id="c-mode"
                  value={form.publicScheduleMode}
                  onChange={(e) => setForm({ ...form, publicScheduleMode: e.target.value as AdminCourse['publicScheduleMode'] })}
                >
                  <option value="names">Group names</option>
                  <option value="anonymous">Anonymous labels (Group 1, 2…)</option>
                  <option value="hidden">Nothing (only own booking via link)</option>
                </Select>
              </Field>
              <Field
                label="Email when estimated time moves by ≥ (min)"
                htmlFor="c-thr"
                hint="Changes to finalized times are always notified."
              >
                <Input
                  id="c-thr"
                  type="number"
                  min={0}
                  value={form.notifyThresholdMinutes}
                  onChange={(e) => setForm({ ...form, notifyThresholdMinutes: Number(e.target.value) })}
                />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="Privacy information page" className="lg:col-span-2">
          <Textarea
            rows={10}
            aria-label="Privacy text"
            value={form.privacyText}
            onChange={(e) => setForm({ ...form, privacyText: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-500">
            Plain text; blank lines separate paragraphs. Describe your actual data handling. Do not claim compliance arrangements that are
            not in place.
          </p>
        </Card>
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          disabled={ruleErrors.length > 0}
          onClick={() =>
            run({
              title: 'Save course settings',
              method: 'put',
              path: '/admin/course',
              body: form,
              onDone: () => {
                setSaved(true);
                void reload();
              },
            })
          }
        >
          Preview & save
        </Button>
        <Button variant="secondary" onClick={() => data && setForm(data.course)}>
          Discard changes
        </Button>
      </div>
    </>
  );
}
