import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch } from '../hooks';
import { useSection } from '../section';
import { branchName, fileToDataUrl, memberName, todayISO } from '../utils';
import DatePicker from './DatePicker';
import SearchSelect from './SearchSelect';
import {
  Button,
  Dialog,
  Input,
  Label,
  SegmentedControl,
  Select,
  cn,
  useToast,
  IconAlert,
  IconCamera,
} from './ui';

// Kept in step with BLOOD_TYPES on the server, which rejects anything else
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// A function, not a constant: the app stays open for days, and join_date is "today"
const emptyForm = () => ({
  first_name: '',
  father_name: '',
  last_name: '',
  mother_name: '',
  birth_date: '',
  birth_place: '',
  address_abidjan: '',
  address_lebanon: '',
  school: '',
  blood_type: '',
  sex: 'M',
  branch_id: '',
  // الطليعة داخل الفرقة — '' = لم يُوزَّع بعد، و هو حال كل فرقة غير مقسَّمة
  group_id: '',
  member_phone: '',
  father_phone: '',
  mother_phone: '',
  join_date: todayISO(),
  photo: null,
  status: 'active',
});

const memberToForm = (m) => ({
  ...emptyForm(),
  ...Object.fromEntries(Object.keys(emptyForm()).map((k) => [k, m[k] ?? ''])),
  group_id: m.group_id ?? '',
  photo: m.photo || null,
});

/** Server error codes, in words the قائد can act on. */
function describeError(t, err) {
  const code = err.message || '';
  if (code === 'member_duplicate') return { text: t('member.errDuplicate'), memberId: err.body?.member_id };
  if (code === 'branch_change_reason_required') return { text: t('member.errBranchReason') };
  if (code === 'invalid phone') return { text: t('member.errPhone') };
  if (code === 'invalid birth_date') return { text: t('member.errBirthDate') };
  if (code === 'invalid photo') return { text: t('member.errPhoto') };
  if (code === 'invalid name' || code.startsWith('missing field')) return { text: t('common.fillRequired') };
  return { text: code };
}

function Field({ id, label, className, children }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Section({ title, children }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} className="text-sm font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Registration and correction of one عنصر — the same form from the list and from
 * the profile. The save button lives in the dialog's pinned footer, so on a phone
 * it never sits under the fold of a four-section form.
 */
export default function MemberFormDialog({ open, member = null, defaults, onClose, onSaved }) {
  const { t } = useTranslation();
  const formId = useId();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setSaving(false);
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t(member ? 'member.editMember' : 'member.addMember')}
      description={member ? memberName(member) : undefined}
      footer={
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      {open && (
        <MemberFormBody
          key={member?.id ?? 'new'}
          formId={formId}
          member={member}
          defaults={defaults}
          setSaving={setSaving}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function MemberFormBody({ formId, member, defaults, setSaving, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { has } = usePerms();
  // Without members.contact the server never sent phones or addresses, so the form
  // does not offer them either (and the server keeps the stored ones on save)
  const canContact = has('members.contact');
  const branches = useFetch('/branches');
  const lookups = useFetch('/lookups');
  const editing = !!member;
  // حساب محصور في قسم (أو عرض محصور فيه) لا يسجّل إلا من جنس هذا القسم: حساب
  // الفتيات لا يختار «ذكر»، و حساب الفتيان لا يختار «أنثى». الخادم يرفض الآخر أيضًا.
  const { section } = useSection();
  const [form, setForm] = useState(() => {
    const f = editing ? memberToForm(member) : { ...emptyForm(), ...defaults };
    return section ? { ...f, sex: section } : f;
  });
  const [error, setError] = useState(null);
  const errorRef = useRef(null);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const branchList = branches.data || [];

  // A new registration with no فرقة preset lands in the first one, once the list is in
  useEffect(() => {
    if (!form.branch_id && branchList.length) setForm((f) => ({ ...f, branch_id: branchList[0].id }));
  }, [branchList, form.branch_id]);

  // A new عنصر's الجنس follows the قسم of the فرقة picked — a فرقة of الفتيات takes
  // girls — until it is set by hand
  const sexTouched = useRef(false);
  const branchSection = branchList.find((b) => String(b.id) === String(form.branch_id))?.section;
  useEffect(() => {
    if (editing || sexTouched.current || !branchSection) return;
    setForm((f) => (f.sex === branchSection ? f : { ...f, sex: branchSection }));
  }, [editing, branchSection]);

  // The saved-with-error message can sit below the fold of a long form
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  // طلائع الفرقة المختارة. نقل العنصر إلى فرقة أخرى يُخرجه من طليعته: الطليعة
  // تخصّ فرقتها، و الخادم يرفض طليعةً من غيرها.
  const branchGroups = branchList.find((b) => String(b.id) === String(form.branch_id))?.groups || [];
  const setBranch = (e) => setForm((f) => ({ ...f, branch_id: e.target.value, group_id: '' }));

  // تغيير فرقة عنصر مسجَّل يُحفظ في سجلّه، و الخادم يريد سببه: نقلٌ حقيقي (بتاريخه،
  // فحضوره السابق يبقى لفرقته القديمة) أو تصحيحُ فرقةٍ سُجّلت خطأً.
  const [branchChange, setBranchChange] = useState({ reason: '', date: todayISO() });
  const branchChanged = editing && String(form.branch_id) !== String(member.branch_id);

  // The pickers take plain labels; a value retired from a list still shows on the
  // عنصر who carries it, it simply can no longer be picked again.
  const listOf = (kind) => (lookups.data?.[kind] || []).map((v) => v.label);

  // Adding a quartier / école straight from the form. A value someone else added
  // meanwhile comes back as a duplicate: not a failure, pick its stored spelling.
  async function createLookup(kind, label) {
    const wanted = String(label).trim();
    try {
      const row = await api.post('/lookups', { kind, label: wanted });
      lookups.reload({ quiet: true });
      return row.label;
    } catch (err) {
      if (err.message === 'duplicate label') {
        const existing = (lookups.data?.[kind] || []).find((v) => v.label.toLowerCase() === wanted.toLowerCase());
        return existing?.label || wanted;
      }
      toast.error(err.message);
      return null;
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const photo = await fileToDataUrl(file);
    setForm((f) => ({ ...f, photo }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      branch_id: Number(form.branch_id),
      group_id: form.group_id === '' ? null : Number(form.group_id),
      ...(branchChanged && {
        branch_change_reason: branchChange.reason,
        // Without a date the server dates the move today
        branch_change_date: branchChange.reason === 'transfer' ? branchChange.date || undefined : undefined,
      }),
    };
    try {
      const saved = editing ? await api.put(`/members/${member.id}`, payload) : await api.post('/members', payload);
      toast.success(t(editing ? 'member.updated' : 'member.created'));
      onSaved?.(saved);
    } catch (err) {
      setError(describeError(t, err));
      setSaving(false);
    }
  }

  const lookupPicker = (field, kind) => (
    <SearchSelect
      id={field}
      value={form[field] || ''}
      onChange={set(field)}
      options={listOf(kind)}
      placeholder={t('member.pickValue')}
      searchPlaceholder={t('member.searchOrAdd')}
      emptyLabel={t('member.noListValue')}
      clearLabel={t('member.noValue')}
      onCreate={(label) => createLookup(kind, label)}
      createLabel={(v) => t('member.addListValue', { value: v })}
    />
  );

  const phoneInput = (field) => (
    <Input id={field} type="tel" inputMode="tel" dir="ltr" value={form[field] || ''} onChange={set(field)} />
  );

  return (
    <form id={formId} onSubmit={submit} className="space-y-6 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-5">
      <Section title={t('member.sectionIdentity')}>
        <div className="flex items-center gap-4">
          {/* The whole circle is the picker; the input inside it takes the focus */}
          <label className="relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-input bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            {form.photo ? (
              <img src={form.photo} alt="" className="img-outline h-full w-full object-cover" />
            ) : (
              <IconCamera className="h-6 w-6" />
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label={t(form.photo ? 'member.changePhoto' : 'member.addPhoto')}
              onChange={handlePhoto}
              className="sr-only"
            />
          </label>
          <div className="min-w-0 text-sm">
            <p className="font-medium">{t('member.photo')}</p>
            {form.photo ? (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, photo: null }))}
                className="focus-ring -mx-1 min-h-11 rounded px-1 text-xs font-medium text-destructive hover:underline sm:min-h-0"
              >
                {t('member.removePhoto')}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">{t('member.addPhoto')}</p>
            )}
          </div>
        </div>

        {/* Order of the الاسم الثلاثي, as it reads everywhere else */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="first_name" label={t('member.firstName')}>
            <Input id="first_name" required autoComplete="off" value={form.first_name} onChange={set('first_name')} />
          </Field>
          <Field id="father_name" label={t('member.fatherName')}>
            <Input id="father_name" autoComplete="off" value={form.father_name || ''} onChange={set('father_name')} />
          </Field>
          <Field id="last_name" label={t('member.lastName')}>
            <Input id="last_name" required autoComplete="off" value={form.last_name} onChange={set('last_name')} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            {/* Label, not a block span: the same inline line box as its neighbours' labels */}
            <Label>{t('member.sex')}</Label>
            <SegmentedControl
              label={t('member.sex')}
              value={form.sex}
              onChange={(v) => {
                sexTouched.current = true;
                setForm((f) => ({ ...f, sex: v }));
              }}
              className="flex w-full"
              options={[
                { value: 'M', label: t('member.male') },
                { value: 'F', label: t('member.female') },
              ].filter((o) => !section || o.value === section)}
            />
          </div>
          <Field id="birth_date" label={t('member.birthDate')}>
            <DatePicker id="birth_date" toYear={new Date().getFullYear()} value={form.birth_date} onChange={set('birth_date')} />
          </Field>
          <Field id="birth_place" label={t('member.birthPlace')}>
            <Input id="birth_place" autoComplete="off" value={form.birth_place || ''} onChange={set('birth_place')} />
          </Field>
          <Field id="blood_type" label={t('member.bloodType')}>
            <Select id="blood_type" value={form.blood_type || ''} onChange={set('blood_type')}>
              <option value="">{t('member.noValue')}</option>
              {BLOOD_TYPES.map((bt) => (
                <option key={bt} value={bt}>
                  {bt}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      <Section title={t('member.sectionEnrolment')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="branch_id" label={t('member.branch')}>
            <Select id="branch_id" required value={form.branch_id} onChange={setBranch}>
              {branchList.map((b) => (
                <option key={b.id} value={b.id}>
                  {branchName(b, i18n.language)}
                </option>
              ))}
            </Select>
          </Field>
          {/* الطليعة تظهر للفرق المقسَّمة وحدها: توزيع الفرقة كلها يُدار من صفحة الفرق،
              و هنا يُصحَّح توزيع عنصر واحد وهو يُسجَّل أو يُعدَّل. */}
          {branchGroups.length > 0 && (
            <Field id="group_id" label={t('member.group')}>
              <Select id="group_id" value={form.group_id ?? ''} onChange={set('group_id')}>
                <option value="">{t('member.noGroup')}</option>
                {branchGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {branchChanged && (
            <Field id="branch_change_reason" label={t('member.branchChangeReason')}>
              <Select
                id="branch_change_reason"
                required
                value={branchChange.reason}
                onChange={(e) => setBranchChange((c) => ({ ...c, reason: e.target.value }))}
              >
                <option value="" disabled>
                  {t('member.pickReason')}
                </option>
                <option value="transfer">{t('member.branchTransfer')}</option>
                <option value="correction">{t('member.branchCorrection')}</option>
              </Select>
            </Field>
          )}
          {branchChanged && branchChange.reason === 'transfer' && (
            <Field id="branch_change_date" label={t('member.branchChangeDate')}>
              <DatePicker
                id="branch_change_date"
                clearable={false}
                toYear={new Date().getFullYear()}
                value={branchChange.date}
                onChange={(e) => setBranchChange((c) => ({ ...c, date: e.target.value }))}
              />
            </Field>
          )}
          <Field id="join_date" label={t('member.joinDate')}>
            <DatePicker id="join_date" fromYear={2000} value={form.join_date} onChange={set('join_date')} />
          </Field>
        </div>
      </Section>

      <Section title={t(canContact ? 'member.sectionFamily' : 'member.sectionFamilyNoContact')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="mother_name" label={t('member.motherName')} className="sm:col-span-2">
            <Input id="mother_name" autoComplete="off" value={form.mother_name || ''} onChange={set('mother_name')} />
          </Field>
          {canContact && (
            <>
              <Field id="father_phone" label={t('member.fatherPhone')}>
                {phoneInput('father_phone')}
              </Field>
              <Field id="mother_phone" label={t('member.motherPhone')}>
                {phoneInput('mother_phone')}
              </Field>
              <Field id="member_phone" label={t('member.memberPhone')}>
                {phoneInput('member_phone')}
              </Field>
            </>
          )}
        </div>
      </Section>

      {/* Picked from the curated lists, never typed loose: a quartier spelled two ways
          would split its people across two filters. A missing value is added from
          here — it joins the list, so the next تسجيل finds it ready. */}
      <Section title={t(canContact ? 'member.sectionHome' : 'member.school')}>
        <div className="grid gap-3 sm:grid-cols-2">
          {canContact && (
            <>
              <Field id="address_abidjan" label={t('member.addressAbidjan')}>
                {lookupPicker('address_abidjan', 'residence_abidjan')}
              </Field>
              <Field id="address_lebanon" label={t('member.addressLebanon')}>
                {lookupPicker('address_lebanon', 'residence_lebanon')}
              </Field>
            </>
          )}
          <Field id="school" label={t('member.school')}>
            {lookupPicker('school', 'school')}
          </Field>
        </div>
      </Section>

      {error && (
        <div
          ref={errorRef}
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm font-medium text-destructive"
        >
          <IconAlert className="mt-0.5" />
          <p className="flex-1">
            {error.text}
            {error.memberId && (
              <>
                {' '}
                <Link to={`/members/${error.memberId}`} className="focus-ring rounded underline underline-offset-2">
                  {t('member.openExisting')}
                </Link>
              </>
            )}
          </p>
        </div>
      )}
    </form>
  );
}
