import { useId } from 'react';
import type { DurationRules } from '../../shared/types';
import type { FieldErrors, GroupInput } from '../../shared/validation';
import { examDuration } from '../../shared/rules';
import { Field, Input, Select, Textarea } from './ui';

export function emptyGroup(size = 3): GroupInput {
  return { groupName: '', groupSize: size, members: Array(size).fill(''), representativeEmail: '', notes: '' };
}

export function DurationSummary({ rules, size }: { rules: DurationRules; size: number }) {
  const q = rules.questionsPerStudentMinutes * size;
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" aria-live="polite">
      <p>
        <strong>
          {size} student{size === 1 ? '' : 's'}:
        </strong>{' '}
        {rules.presentationMinutes} min presentation + {q} min individual questions ({rules.questionsPerStudentMinutes} min × {size})
      </p>
      <p className="mt-1 text-base font-semibold">Total examination duration: {examDuration(rules, size)} minutes</p>
      <p className="mt-1 text-xs text-blue-900/80">
        A {rules.breakMinutes}-minute recovery break between examinations is accounted for separately.
      </p>
    </div>
  );
}

export function GroupForm({
  value,
  onChange,
  rules,
  errors = {},
  sizeLocked,
  maxSize,
}: {
  value: GroupInput;
  onChange: (v: GroupInput) => void;
  rules: DurationRules;
  errors?: FieldErrors;
  sizeLocked?: boolean;
  maxSize?: number;
}) {
  const id = useId();
  const max = maxSize ?? rules.maxGroupSize;
  const sizes: number[] = [];
  for (let s = rules.minGroupSize; s <= Math.max(max, value.groupSize); s++) sizes.push(s);

  const setSize = (n: number) => {
    const members = [...value.members];
    while (members.length < n) members.push('');
    members.length = n;
    onChange({ ...value, groupSize: n, members });
  };

  return (
    <div className="space-y-5">
      <Field label="Group or project name" htmlFor={`${id}-name`} error={errors.groupName}>
        <Input
          id={`${id}-name`}
          value={value.groupName}
          maxLength={100}
          autoComplete="off"
          aria-invalid={!!errors.groupName}
          onChange={(e) => onChange({ ...value, groupName: e.target.value })}
          placeholder="e.g. Graph Miners"
        />
      </Field>

      <Field
        label="Number of students"
        htmlFor={`${id}-size`}
        error={errors.groupSize}
        hint={sizeLocked ? 'The group size cannot be changed because the schedule is finalized.' : undefined}
      >
        <Select
          id={`${id}-size`}
          value={value.groupSize}
          disabled={sizeLocked}
          onChange={(e) => setSize(Number(e.target.value))}
          className="max-w-40"
        >
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Field>

      <DurationSummary rules={rules} size={value.groupSize} />

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-800">Student names</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {value.members.map((m, i) => (
            <Input
              key={i}
              aria-label={`Student ${i + 1} full name`}
              placeholder={`Student ${i + 1} full name`}
              value={m}
              maxLength={120}
              autoComplete="off"
              aria-invalid={!!errors.members && m.trim().length < 2}
              onChange={(e) => {
                const members = [...value.members];
                members[i] = e.target.value;
                onChange({ ...value, members });
              }}
            />
          ))}
        </div>
        {errors.members && <p className="mt-1 text-sm text-red-700">{errors.members}</p>}
      </fieldset>

      <Field
        label="Representative's email"
        htmlFor={`${id}-email`}
        error={errors.representativeEmail}
        hint="Used only to send the booking confirmation, the management link and schedule updates."
      >
        <Input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          value={value.representativeEmail}
          aria-invalid={!!errors.representativeEmail}
          onChange={(e) => onChange({ ...value, representativeEmail: e.target.value })}
          placeholder="name@studenti.example.it"
        />
      </Field>

      <Field label="Notes (optional)" htmlFor={`${id}-notes`} error={errors.notes} hint="Visible only to the lecturer.">
        <Textarea
          id={`${id}-notes`}
          rows={2}
          maxLength={1000}
          value={value.notes ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </Field>
    </div>
  );
}
