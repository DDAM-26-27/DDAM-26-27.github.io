import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiFailure, downloadAdminFile } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { formatDateLong, formatDuration, formatRange, formatTime, parseTime } from '../../../shared/time';
import { BLOCK_TYPE_LABELS, BLOCK_TYPES } from '../../../shared/types';
import { validateGroup, type FieldErrors, type GroupInput } from '../../../shared/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Loading,
  Modal,
  PageTitle,
  RegistrationBadge,
  ScheduleStatusBadge,
  Select,
  Stat,
} from '../../components/ui';
import { TimelineBar, TimelineLegend, TimelineList, type TimelineEntry } from '../../components/Timeline';
import { emptyGroup, GroupForm } from '../../components/GroupForm';
import { usePreviewedAction } from './PreviewDialog';
import type { AdminBooking, IntervalDTO, SessionDetail } from './types';

export function SessionPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.admin.get<SessionDetail>(`/admin/sessions/${id}`), [id]);
  const { run, dialog } = usePreviewedAction();
  const [flash, setFlash] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminBooking | 'new' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [link, setLink] = useState<{ group: string; url: string } | null>(null);
  useTitle(data ? `Session ${data.session.date}` : 'Session');

  useEffect(() => setOrder(null), [data]);

  const scheduled = useMemo(() => (data?.bookings ?? []).filter((b) => b.start != null), [data]);
  const unscheduled = useMemo(() => (data?.bookings ?? []).filter((b) => b.start == null), [data]);

  if (loading && !data) return <Loading />;
  if (error) return <Alert tone="red">{error.message}</Alert>;
  if (!data) return null;

  const s = data.session;
  const finalized = s.scheduleStatus === 'finalized';
  const byId = new Map(data.bookings.map((b) => [b.id, b]));
  const done = (text: string) => () => {
    setFlash({ tone: 'green', text });
    void reload();
  };
  const fail = (e: unknown) => setFlash({ tone: 'red', text: (e as ApiFailure).message });

  const entries: TimelineEntry[] = data.timeline.map((i) => {
    if (i.kind === 'exam') {
      const b = byId.get(i.bookingId!)!;
      const tags = [
        `${b.groupSize} students`,
        b.placement === 'manual' ? 'manual order' : null,
        b.gapFill ? 'gap fill' : null,
        b.createdBy === 'admin' ? 'added by lecturer' : null,
      ].filter(Boolean);
      return { start: i.start, end: i.end, kind: 'exam', label: b.groupName, sublabel: tags.join(' · '), revised: b.revised };
    }
    if (i.kind === 'blocked')
      return { start: i.start, end: i.end, kind: 'blocked', label: i.label || BLOCK_TYPE_LABELS[i.blockType ?? 'other'] };
    return {
      start: i.start,
      end: i.end,
      kind: i.kind,
      label: i.kind === 'break' ? 'Recovery break' : i.kind === 'available' ? 'Available' : 'Not available',
    };
  });

  const currentOrder = order ?? scheduled.map((b) => b.id);
  const move = (idx: number, delta: number) => {
    const next = [...currentOrder];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
  };
  const saveOrder = () =>
    run({
      title: 'Apply manual order',
      method: 'put',
      path: `/admin/sessions/${id}/order`,
      body: { bookingIds: [...currentOrder, ...unscheduled.map((b) => b.id)] },
      note: 'Groups will be examined in exactly this order. New bookings are added after them and may fill gaps.',
      onDone: done('Manual order saved.'),
    });

  const setRegistration = async (status: string) => {
    try {
      await api.admin.put(`/admin/sessions/${id}/registration`, { status });
      done(`Registration is now ${status}.`)();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      {dialog}
      <div className="mb-2 text-sm">
        <Link to="/admin" className="text-blue-700 hover:underline">
          ← Overview
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle
          sub={
            <>
              {s.startTime}–{s.endTime} · {s.timezone}
              {s.location ? ` · ${s.location}` : ''} · schedule v{s.scheduleVersion}
              {s.scheduleUpdatedAt ? `, updated ${new Date(s.scheduleUpdatedAt).toLocaleString('en-GB')}` : ''}
            </>
          }
        >
          {formatDateLong(s.date)}
        </PageTitle>
        <div className="flex flex-wrap gap-2">
          <RegistrationBadge status={s.registrationStatus} />
          <ScheduleStatusBadge status={s.scheduleStatus} />
        </div>
      </div>

      {flash && (
        <div className="mb-4">
          <Alert tone={flash.tone}>{flash.text}</Alert>
        </div>
      )}

      <Card className="mb-4" title="Controls">
        <div className="flex flex-wrap gap-2">
          {s.registrationStatus !== 'open' && !finalized && <Button onClick={() => setRegistration('open')}>Open registration</Button>}
          {s.registrationStatus === 'open' && (
            <Button variant="secondary" onClick={() => setRegistration('closed')}>
              Close registration
            </Button>
          )}
          {s.registrationStatus !== 'draft' && (
            <Button variant="ghost" onClick={() => setRegistration('draft')}>
              Hide (draft)
            </Button>
          )}
          {!finalized ? (
            <Button
              variant="secondary"
              disabled={unscheduled.length > 0}
              title={unscheduled.length ? 'Resolve unscheduled groups first' : undefined}
              onClick={() =>
                run({
                  title: 'Finalize schedule',
                  method: 'post',
                  path: `/admin/sessions/${id}/finalize`,
                  body: {},
                  confirmLabel: 'Finalize and notify groups',
                  note: 'Times will be frozen and shown as confirmed. Registration will close. Group representatives whose confirmed time is new or changed are notified.',
                  onDone: done('Schedule finalized.'),
                })
              }
            >
              Finalize schedule
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() =>
                run({
                  title: 'Unlock schedule',
                  method: 'post',
                  path: `/admin/sessions/${id}/unfinalize`,
                  body: {},
                  note: 'The schedule becomes tentative again. The confirmed order is kept as a manual order; any change to a confirmed time will be marked as “Revised” and the group notified.',
                  onDone: done('Schedule unlocked.'),
                })
              }
            >
              Unlock schedule
            </Button>
          )}
          <Button variant="secondary" onClick={() => setEditing('new')}>
            Add group
          </Button>
          <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
            Edit date & hours
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              run({
                title: 'Recalculate schedule',
                method: 'post',
                path: `/admin/sessions/${id}/recalculate`,
                body: {},
                onDone: done('Schedule recalculated.'),
              })
            }
          >
            Recalculate
          </Button>
          <span className="mx-1 hidden w-px bg-slate-200 sm:block" />
          <Button variant="ghost" onClick={() => downloadAdminFile(`/admin/sessions/${id}/export.csv`, 'schedule.csv').catch(fail)}>
            Export CSV
          </Button>
          <Button variant="ghost" onClick={() => downloadAdminFile(`/admin/sessions/${id}/export.ics`, 'schedule.ics').catch(fail)}>
            Export .ics
          </Button>
          <Button variant="ghost" onClick={() => window.open(`/admin/sessions/${id}/print`, '_blank')}>
            Print / PDF
          </Button>
          <Button
            variant="ghost"
            className="text-red-700"
            onClick={async () => {
              if (!window.confirm('Delete this examination session? This is only possible when it has no active bookings.')) return;
              try {
                await api.admin.del(`/admin/sessions/${id}`);
                nav('/admin');
              } catch (e) {
                fail(e);
              }
            }}
          >
            Delete session
          </Button>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Groups" value={data.bookings.length} />
        <Stat label="Students" value={data.availability.studentCount} />
        <Stat label="Exam time" value={formatDuration(data.stats.examMinutes)} />
        <Stat label="Breaks" value={formatDuration(data.stats.breakMinutes)} />
        <Stat label="Unused" value={formatDuration(data.stats.availableMinutes)} />
        <Stat
          label="Room for"
          value={data.availability.maxBookableGroupSize ? `≤ ${data.availability.maxBookableGroupSize} students` : 'Full'}
        />
      </div>

      {unscheduled.length > 0 && (
        <div className="mb-4">
          <Alert tone="red" title={`${unscheduled.length} group(s) without an examination time`}>
            <ul className="list-disc pl-5">
              {unscheduled.map((b) => (
                <li key={b.id}>
                  <strong>{b.groupName}</strong> ({b.durationMinutes} min): {b.unscheduledReason}.{' '}
                  <button className="underline" onClick={() => setEditing(b)}>
                    Edit / move
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1">Resolve by moving the group to another date, freeing time, changing availability or cancelling.</p>
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Daily timeline">
          <div className="space-y-3">
            <TimelineBar entries={entries} dayStart={parseTime(s.startTime)} dayEnd={parseTime(s.endTime)} />
            <TimelineLegend />
            <TimelineList entries={entries} compact />
          </div>
        </Card>
        <div className="lg:col-span-2">
          <IntervalsEditor
            key={JSON.stringify(data.intervals)}
            intervals={data.intervals}
            onSave={(intervals) =>
              run({
                title: 'Update availability',
                method: 'put',
                path: `/admin/sessions/${id}/intervals`,
                body: { intervals },
                onDone: done('Availability updated.'),
              })
            }
          />
        </div>
      </div>

      <Card
        className="mt-4"
        title={
          <>
            Examination order{' '}
            {data.manualOrder ? <Badge tone="blue">Administrator-defined order</Badge> : <Badge>Automatic (FIFO + gap filling)</Badge>}
          </>
        }
        actions={
          finalized ? (
            <span className="text-sm text-slate-500">Unlock the schedule to reorder.</span>
          ) : (
            <>
              {order && (
                <>
                  <Button size="sm" onClick={saveOrder}>
                    Preview & save order
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setOrder(null)}>
                    Discard
                  </Button>
                </>
              )}
              {data.manualOrder && !order && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    run({
                      title: 'Reset to automatic order',
                      method: 'put',
                      path: `/admin/sessions/${id}/order`,
                      body: { bookingIds: null },
                      onDone: done('Automatic ordering restored.'),
                    })
                  }
                >
                  Reset to automatic order
                </Button>
              )}
            </>
          )
        }
      >
        {scheduled.length === 0 && <p className="text-sm text-slate-600">No scheduled groups yet.</p>}
        {order && <p className="mb-2 text-sm text-amber-800">Unsaved order. Times will be recalculated when you save.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-2">Order</th>
                <th className="py-2 pr-2">Time</th>
                <th className="py-2 pr-2">Group</th>
                <th className="py-2 pr-2">Students</th>
                <th className="py-2 pr-2">Representative</th>
                <th className="py-2 pr-2">Booked</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentOrder.map((bid, idx) => {
                const b = byId.get(bid)!;
                return (
                  <tr
                    key={bid}
                    draggable={!finalized}
                    onDragStart={() => setDragId(bid)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (!dragId || dragId === bid) return;
                      const next = currentOrder.filter((x) => x !== dragId);
                      next.splice(next.indexOf(bid), 0, dragId);
                      setOrder(next);
                      setDragId(null);
                    }}
                    className={dragId === bid ? 'opacity-50' : ''}
                  >
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1">
                        {!finalized && (
                          <span aria-hidden className="cursor-grab text-slate-400" title="Drag to reorder">
                            ⋮⋮
                          </span>
                        )}
                        <span className="w-5 text-slate-500">{idx + 1}</span>
                        {!finalized && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Move ${b.groupName} up`}
                              disabled={idx === 0}
                              onClick={() => move(idx, -1)}
                            >
                              ↑
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Move ${b.groupName} down`}
                              disabled={idx === currentOrder.length - 1}
                              onClick={() => move(idx, 1)}
                            >
                              ↓
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-2 font-mono whitespace-nowrap">
                      {order ? <span className="text-slate-400">recalculated on save</span> : formatRange(b.start!, b.end!)}
                      {b.revised && b.confirmedStart != null && (
                        <span className="block text-xs text-amber-800">Revised · was {formatTime(b.confirmedStart)}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <span className="font-medium">{b.groupName}</span>
                      <span className="ml-1 text-xs text-slate-500">#{b.sequence}</span>
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {b.gapFill && <Badge tone="blue">gap fill</Badge>}
                        {b.placement === 'manual' && <Badge>manual</Badge>}
                        {b.createdBy === 'admin' && <Badge>added by lecturer</Badge>}
                        {b.capacityOverride && <Badge tone="amber">override</Badge>}
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      {b.groupSize} · <span className="text-slate-600">{b.members.join(', ')}</span>
                      {b.notes && <span className="block text-xs text-slate-500">Note: {b.notes}</span>}
                    </td>
                    <td className="py-2 pr-2">
                      <a className="text-blue-700 hover:underline" href={`mailto:${b.representativeEmail}`}>
                        {b.representativeEmail}
                      </a>
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-500">{new Date(b.createdAt).toLocaleString('en-GB')}</td>
                    <td className="py-2 text-right">
                      <BookingActions
                        b={b}
                        onEdit={() => setEditing(b)}
                        run={run}
                        done={done}
                        fail={fail}
                        onLink={(url) => setLink({ group: b.groupName, url })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {data.cancelled.length > 0 && (
        <details className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium">Cancelled bookings ({data.cancelled.length})</summary>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {data.cancelled.map((b) => (
              <li key={b.id}>
                {b.groupName} ({b.groupSize}) · {b.representativeEmail} · cancelled{' '}
                {b.cancelledAt ? new Date(b.cancelledAt).toLocaleString('en-GB') : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium">Schedule revisions ({data.revisions.length})</summary>
        <ul className="mt-2 space-y-1 text-sm text-slate-600">
          {data.revisions.map((r) => (
            <li key={r.version}>
              v{r.version} · {new Date(r.createdAt).toLocaleString('en-GB')} · {r.reason} ·{' '}
              <span className="text-slate-500">{r.actor}</span>
            </li>
          ))}
        </ul>
      </details>

      <BookingModal
        target={editing}
        detail={data}
        onClose={() => setEditing(null)}
        onSubmit={(payload, b) => {
          setEditing(null);
          if (b === 'new') {
            run({
              title: 'Add group',
              method: 'post',
              path: `/admin/sessions/${payload.sessionId}/bookings`,
              body: payload,
              onDone: (r) => {
                if (r.value?.managementUrl) setLink({ group: payload.groupName, url: r.value.managementUrl });
                done('Group added.')();
              },
            });
          } else {
            run({
              title: payload.sessionId !== b.sessionId ? `Move ${b.groupName}` : `Edit ${b.groupName}`,
              method: 'put',
              path: `/admin/bookings/${b.id}`,
              body: payload,
              onDone: done('Booking updated.'),
            });
          }
        }}
      />
      <SessionSettingsModal open={settingsOpen} detail={data} onClose={() => setSettingsOpen(false)} run={run} done={done} />
      <Modal
        open={!!link}
        title={`Management link for ${link?.group}`}
        onClose={() => setLink(null)}
        footer={<Button onClick={() => setLink(null)}>Done</Button>}
      >
        <p className="text-sm text-slate-700">
          Send this private link to the group representative. It is shown only once; previous links for this booking stop working.
        </p>
        <input
          readOnly
          className="mt-3 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs"
          value={link?.url ?? ''}
          onFocus={(e) => e.target.select()}
        />
      </Modal>
    </>
  );
}

function BookingActions({
  b,
  onEdit,
  run,
  done,
  fail,
  onLink,
}: {
  b: AdminBooking;
  onEdit: () => void;
  run: ReturnType<typeof usePreviewedAction>['run'];
  done: (t: string) => () => void;
  fail: (e: unknown) => void;
  onLink: (url: string) => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="secondary" onClick={onEdit}>
        Edit / move
      </Button>
      <Button
        size="sm"
        variant="ghost"
        title="Issue a new management link"
        onClick={async () => {
          if (!window.confirm(`Issue a new management link for ${b.groupName}? The old link stops working.`)) return;
          try {
            const r = await api.admin.post<{ managementUrl: string }>(`/admin/bookings/${b.id}/regenerate-link`);
            onLink(r.managementUrl);
          } catch (e) {
            fail(e);
          }
        }}
      >
        Link
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-red-700"
        onClick={() =>
          run({
            title: `Cancel ${b.groupName}`,
            method: 'post',
            path: `/admin/bookings/${b.id}/cancel`,
            body: {},
            danger: true,
            confirmLabel: 'Cancel booking',
            note: 'The representative is notified by email (if configured).',
            onDone: done(`${b.groupName} cancelled.`),
          })
        }
      >
        Cancel
      </Button>
    </div>
  );
}

function BookingModal({
  target,
  detail,
  onClose,
  onSubmit,
}: {
  target: AdminBooking | 'new' | null;
  detail: SessionDetail;
  onClose: () => void;
  onSubmit: (payload: GroupInput & { sessionId: string; sendEmail?: boolean; notify?: boolean }, b: AdminBooking | 'new') => void;
}) {
  const [form, setForm] = useState<GroupInput & { sessionId: string; notify: boolean }>({
    ...emptyGroup(3),
    sessionId: detail.session.id,
    notify: true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  useEffect(() => {
    if (!target) return;
    setErrors({});
    if (target === 'new') setForm({ ...emptyGroup(3), sessionId: detail.session.id, notify: false });
    else
      setForm({
        groupName: target.groupName,
        groupSize: target.groupSize,
        members: [...target.members],
        representativeEmail: target.representativeEmail,
        notes: target.notes,
        sessionId: target.sessionId,
        notify: true,
      });
  }, [target, detail.session.id]);
  const rules = { ...detail.course.rules, minGroupSize: 1, maxGroupSize: 20 };
  const submit = () => {
    const { errors: errs } = validateGroup(form, rules);
    setErrors(errs);
    if (Object.keys(errs).length || !target) return;
    onSubmit(target === 'new' ? { ...form, sendEmail: form.notify } : form, target);
  };
  return (
    <Modal
      open={!!target}
      wide
      title={target === 'new' ? 'Add group manually' : `Edit ${target ? target.groupName : ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Preview change</Button>
        </>
      }
    >
      <div className="space-y-5">
        {target !== 'new' && (
          <Field label="Examination date" htmlFor="bm-session" hint="Moving a group puts it at the end of the queue for the new date.">
            <Select id="bm-session" value={form.sessionId} onChange={(e) => setForm({ ...form, sessionId: e.target.value })}>
              {detail.allSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatDateLong(s.date)} {s.scheduleStatus === 'finalized' ? '(finalized)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <GroupForm
          value={form}
          onChange={(g) => setForm({ ...form, ...g })}
          rules={rules}
          errors={errors}
          maxSize={Math.max(detail.course.rules.maxGroupSize, form.groupSize)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} />
          {target === 'new' ? 'Send a confirmation email with the management link' : 'Notify the representative by email'}
        </label>
      </div>
    </Modal>
  );
}

function SessionSettingsModal({
  open,
  detail,
  onClose,
  run,
  done,
}: {
  open: boolean;
  detail: SessionDetail;
  onClose: () => void;
  run: ReturnType<typeof usePreviewedAction>['run'];
  done: (t: string) => () => void;
}) {
  const s = detail.session;
  const [form, setForm] = useState({
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.title ?? '',
    location: s.location ?? '',
    registrationStatus: s.registrationStatus,
  });
  useEffect(() => {
    if (open)
      setForm({
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        title: s.title ?? '',
        location: s.location ?? '',
        registrationStatus: s.registrationStatus,
      });
  }, [open, s]);
  return (
    <Modal
      open={open}
      title="Date & hours"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onClose();
              run({
                title: 'Update session',
                method: 'put',
                path: `/admin/sessions/${s.id}`,
                body: form,
                onDone: done('Session updated.'),
              });
            }}
          >
            Preview change
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor="ss-date">
          <Input id="ss-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Registration" htmlFor="ss-reg">
          <Select
            id="ss-reg"
            value={form.registrationStatus}
            onChange={(e) => setForm({ ...form, registrationStatus: e.target.value as typeof form.registrationStatus })}
          >
            <option value="draft">Draft (hidden)</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </Select>
        </Field>
        <Field label="Day starts" htmlFor="ss-start">
          <Input id="ss-start" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
        </Field>
        <Field label="Day ends" htmlFor="ss-end">
          <Input id="ss-end" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
        </Field>
        <Field label="Title" htmlFor="ss-title">
          <Input id="ss-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Location" htmlFor="ss-loc">
          <Input id="ss-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function IntervalsEditor({ intervals, onSave }: { intervals: IntervalDTO[]; onSave: (i: IntervalDTO[]) => void }) {
  const [rows, setRows] = useState<IntervalDTO[]>(intervals);
  const dirty = JSON.stringify(rows) !== JSON.stringify(intervals);
  const update = (i: number, patch: Partial<IntervalDTO>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const windows = rows.map((r, i) => [r, i] as const).filter(([r]) => r.kind === 'window');
  const blocks = rows.map((r, i) => [r, i] as const).filter(([r]) => r.kind === 'blocked');
  const row = (r: IntervalDTO, i: number) => (
    <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2">
      {r.kind === 'blocked' && (
        <div className="w-44">
          <Select
            aria-label="Type"
            value={r.blockType ?? 'other'}
            onChange={(e) => update(i, { blockType: e.target.value as IntervalDTO['blockType'] })}
          >
            {BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {BLOCK_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="flex items-center gap-1">
        <div className="w-32">
          <Input aria-label="Start" type="time" value={r.start} onChange={(e) => update(i, { start: e.target.value })} />
        </div>
        <span className="text-slate-400">–</span>
        <div className="w-32">
          <Input aria-label="End" type="time" value={r.end} onChange={(e) => update(i, { end: e.target.value })} />
        </div>
      </div>
      {r.kind === 'blocked' && (
        <div className="min-w-32 flex-1">
          <Input
            aria-label="Label"
            placeholder="Label (optional)"
            value={r.label ?? ''}
            onChange={(e) => update(i, { label: e.target.value })}
          />
        </div>
      )}
      <Button size="sm" variant="ghost" aria-label="Remove interval" onClick={() => setRows(rows.filter((_, k) => k !== i))}>
        ✕
      </Button>
    </li>
  );
  return (
    <Card
      title="Availability"
      actions={
        dirty && (
          <Button size="sm" onClick={() => onSave(rows)}>
            Preview & save
          </Button>
        )
      }
    >
      <div className="space-y-4 text-sm">
        <div>
          <p className="font-medium">Availability windows</p>
          <p className="mb-2 text-xs text-slate-500">
            Leave empty to use the whole day. Add several windows to split the day (e.g. 09:00–12:00 and 15:00–18:00).
          </p>
          <ul className="space-y-2">{windows.map(([r, i]) => row(r, i))}</ul>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={() =>
              setRows([...rows, { kind: 'window', blockType: null, start: '09:00', end: '13:00', label: null, description: null }])
            }
          >
            + Add window
          </Button>
        </div>
        <div>
          <p className="font-medium">Unavailable intervals</p>
          <p className="mb-2 text-xs text-slate-500">
            Lunch, lectures, meetings… No examination is scheduled here. A block of at least the break length also counts as the recovery
            break.
          </p>
          <ul className="space-y-2">{blocks.map(([r, i]) => row(r, i))}</ul>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={() =>
              setRows([...rows, { kind: 'blocked', blockType: 'other', start: '16:00', end: '18:00', label: null, description: null }])
            }
          >
            + Add unavailable interval
          </Button>
        </div>
        {dirty && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onSave(rows)}>
              Preview & save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRows(intervals)}>
              Discard
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
