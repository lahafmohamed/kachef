import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import AuthLayout, { AuthHeader } from '../components/AuthLayout';
import DatePicker from '../components/DatePicker';
import { CodeTag } from '../components/MemberParts';
import { fmtDate } from '../utils';
import {
  Button,
  Field,
  Input,
  SegmentedControl,
  Spinner,
  Textarea,
  cn,
  IconAlert,
  IconCheck,
  IconLock,
  IconPencil,
} from '../components/ui';

/*
 * Fiche à compléter — the one page opened without an account. A family (or a قائد, for
 * his own file) reaches it from the WhatsApp link that was sent; the link is its key
 * (server/memberForms.js). Empty fields are there to fill; filled ones show their value,
 * with «Corriger» for one that is wrong. Additions and corrections go to the قيادة, who
 * review them before they land; sending with nothing changed confirms the file as it is.
 */

// The form's order and grouping, per kind of file. A section with nothing to ask is left out.
const SECTIONS = {
  member: [
    ['sectionIdentity', ['birth_date', 'birth_place', 'father_name', 'mother_name', 'school']],
    ['sectionContact', ['address_abidjan', 'member_phone', 'father_phone', 'mother_phone']],
    ['sectionHealth', ['blood_type', 'allergies', 'treatment', 'can_swim', 'emergency_name', 'emergency_phone']],
  ],
  // A new عنصر: the whole file, names first
  signup: [
    ['sectionIdentity', ['first_name', 'last_name', 'sex', 'birth_date', 'birth_place', 'father_name', 'mother_name', 'school']],
    ['sectionContact', ['address_abidjan', 'member_phone', 'father_phone', 'mother_phone']],
    ['sectionHealth', ['blood_type', 'allergies', 'treatment', 'can_swim', 'emergency_name', 'emergency_phone']],
  ],
  // A قائد's own file: he answers for himself
  leader: [
    ['sectionIdentity', ['birth_date', 'birth_place', 'father_name', 'marital_status']],
    ['sectionContact', ['phone', 'address_abidjan', 'address_lebanon']],
    ['sectionPath', ['join_year', 'years_ghadir', 'years_total', 'education']],
    ['sectionHealth', ['blood_type']],
  ],
  // A new قائد: his whole file, names first
  leader_signup: [
    ['sectionIdentity', ['first_name', 'father_name', 'last_name', 'birth_date', 'birth_place', 'marital_status']],
    ['sectionContact', ['phone', 'address_abidjan', 'address_lebanon']],
    ['sectionPath', ['join_year', 'years_ghadir', 'years_total', 'education']],
    ['sectionHealth', ['blood_type']],
  ],
};
const PHONES = ['member_phone', 'father_phone', 'mother_phone', 'emergency_phone', 'phone'];
const MAX = {
  first_name: 80, last_name: 80, birth_place: 120, father_name: 80, mother_name: 120, school: 120, address_abidjan: 200,
  address_lebanon: 200, emergency_name: 120, education: 300,
};

export default function Fiche() {
  const { token } = useParams();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ loading: true });
  // Permanent link: each «Inscrire un autre enfant» starts a new, empty form
  const [round, setRound] = useState(0);
  const langSet = useRef(false);

  async function load() {
    setState({ loading: true });
    try {
      const data = await api.get(`/public/fiche/${encodeURIComponent(token)}`);
      // The language the قائد wrote the message in, unless this phone already chose one
      if (!langSet.current && !localStorage.getItem('lang') && data.lang) i18n.changeLanguage(data.lang);
      langSet.current = true;
      setState({ data });
    } catch (err) {
      setState({ error: err });
    }
  }

  useEffect(() => {
    load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps -- once per link

  useEffect(() => {
    const prev = document.title;
    document.title = `${t('fiche.docTitle')} · ${t('app.name')}`;
    return () => {
      document.title = prev;
    };
  }, [t]);

  const { data, error, loading } = state;
  const name = data ? `${data.person.first_name} ${data.person.last_name}`.trim() : '';
  const branch = !data
    ? ''
    : data.kind === 'leader'
      ? t('fiche.leaderLine')
      : data.kind === 'leader_signup'
        ? t(`section.name${data.person.section}`)
        : i18n.language === 'ar' ? data.person.branch_ar : data.person.branch_fr;

  let body;
  if (loading) body = <div className="flex justify-center py-16 text-muted-foreground"><Spinner className="size-6" /></div>;
  else if (error)
    body =
      error.status === 404 ? (
        <Notice tone="muted" title={t('fiche.notFoundTitle')}>{t('fiche.notFoundBody')}</Notice>
      ) : (
        <Notice
          tone="error"
          title={t('fiche.loadError')}
          action={<Button variant="outline" onClick={load}>{t('error.retry')}</Button>}
        >
          {error.network ? t('error.network') : null}
        </Notice>
      );
  else if (['submitted', 'applied', 'confirmed', 'rejected'].includes(data.status))
    body = <Notice tone="success" title={t('fiche.submittedTitle')}>{t('fiche.submittedBody', { name })}</Notice>;
  else if (data.status === 'disabled')
    body = (
      <Notice tone="muted" title={t('fiche.disabledTitle')}>
        {t(data.kind === 'leader_signup' ? 'fiche.disabledBodyLeader' : 'fiche.disabledBody')}
      </Notice>
    );
  else if (data.status !== 'open')
    body = (
      <Notice tone="muted" title={t('fiche.closedTitle')}>
        {t(data.kind === 'leader' || data.kind === 'leader_signup' ? 'fiche.closedBodyLeader' : 'fiche.closedBody')}
      </Notice>
    );
  else if (!data.fields.length)
    body = <Notice tone="success" title={t('fiche.completeTitle')}>{t('fiche.completeBody')}</Notice>;
  else body = <FicheForm key={round} token={token} data={data} onAnother={data.shared && data.kind === 'signup' ? () => setRound((n) => n + 1) : null} />;

  return (
    <AuthLayout>
      <div className="space-y-7">
        <AuthHeader title={
            !data
              ? t('fiche.docTitle')
              : data.kind === 'signup'
                ? t('fiche.signupTitle')
                : data.kind === 'leader_signup'
                  ? t('fiche.signupTitleLeader')
                  : t('fiche.title', { name })
          }
        >
          {data ? branch : null}
          {data?.person.code && (
            <>
              {' · '}
              <CodeTag code={data.person.code} />
            </>
          )}
        </AuthHeader>
        {body}
      </div>
    </AuthLayout>
  );
}

/** A closed or finished state: one short message, nothing to fill. */
function Notice({ tone, title, children, action }) {
  const Icon = tone === 'success' ? IconCheck : IconAlert;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="space-y-4">
      <div className="flex gap-3">
        <span
          className={
            tone === 'success'
              ? 'flex size-9 shrink-0 items-center justify-center rounded-full bg-success/12 text-success'
              : tone === 'error'
                ? 'flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive'
                : 'flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground'
          }
        >
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 pt-1.5">
          <p className="font-semibold text-foreground">{title}</p>
          {children && <p className="mt-1 text-[0.9375rem] text-muted-foreground">{children}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// Same value as the file: not a correction (the server drops these too)
const sameAs = (current, v) =>
  current !== null && current !== undefined && (typeof v === 'boolean' ? current === v : String(current).trim() === String(v).trim());

function FicheForm({ token, data, onAnother }) {
  const { t, i18n } = useTranslation();
  const asked = new Set(data.fields);
  const missing = new Set(data.missing || data.fields);
  const current = data.values || {};
  // A new قائد is both: he answers for himself, and fills a whole file
  const leaderSignup = data.kind === 'leader_signup';
  const leader = data.kind === 'leader' || leaderSignup;
  const signup = data.kind === 'signup' || leaderSignup;
  const required = new Set(data.required || []);
  const [respondent, setRespondent] = useState('');
  const [values, setValues] = useState({});
  const female = (signup ? values.sex : data.person.sex) === 'F';
  // Filled fields opened for a correction
  const [editing, setEditing] = useState(() => new Set());
  // Allergies and treatment: «non» first, the detail only after «oui»
  const [hasAllergy, setHasAllergy] = useState(null);
  const [hasTreatment, setHasTreatment] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const formRef = useRef(null);
  const open = (key) => missing.has(key) || editing.has(key);
  const noneWord = (key) => t(key === 'allergies' ? 'fiche.noneAllergy' : 'fiche.noneTreatment');

  function startEdit(key) {
    const v = current[key];
    if (key === 'allergies' || key === 'treatment') {
      // An empty health line on a file already filled reads «none»
      const none = v === null || v === undefined || v === noneWord(key);
      (key === 'allergies' ? setHasAllergy : setHasTreatment)(!none);
      if (!none) setValues((s) => ({ ...s, [key]: String(v) }));
    } else if (v !== null && v !== undefined) setValues((s) => ({ ...s, [key]: typeof v === 'boolean' ? v : String(v) }));
    setEditing((s) => new Set(s).add(key));
    // Focus the field once it is rendered
    setTimeout(() => formRef.current?.querySelector(`[data-field="${key}"] :is(input,textarea,button[aria-pressed])`)?.focus(), 0);
  }

  function cancelEdit(key) {
    setEditing((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
    setValues((s) => {
      const next = { ...s };
      delete next[key];
      return next;
    });
    if (key === 'allergies') setHasAllergy(null);
    if (key === 'treatment') setHasTreatment(null);
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  // How a value already on the file reads
  function display(key, v) {
    if ((key === 'allergies' || key === 'treatment') && (v === null || v === undefined)) return noneWord(key);
    if (key === 'can_swim') return t(v ? 'fiche.yes' : 'fiche.no');
    if (key === 'marital_status') return t(`leader.${v}`);
    if (key === 'birth_date') return fmtDate(v);
    if (PHONES.includes(key) || key === 'blood_type' || key === 'join_year')
      return <span dir="ltr" className="tabular-nums">{v}</span>;
    return String(v);
  }

  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const label = (key) =>
    `${t(`fiche.fields.${key === 'can_swim' && female ? 'can_swimF' : key === 'phone' && leader ? 'leader_phone' : key}`)}${required.has(key) ? ' *' : ''}`;

  function answers() {
    const out = {};
    for (const key of data.fields.filter(open)) {
      if (key === 'allergies') {
        if (hasAllergy === false) out.allergies = t('fiche.noneAllergy');
        else if (hasAllergy && values.allergies?.trim()) out.allergies = values.allergies;
      } else if (key === 'treatment') {
        if (hasTreatment === false) out.treatment = t('fiche.noneTreatment');
        else if (hasTreatment && values.treatment?.trim()) out.treatment = values.treatment;
      } else if (key === 'can_swim') {
        if (typeof values.can_swim === 'boolean') out.can_swim = values.can_swim;
      } else if (typeof values[key] === 'string' && values[key].trim()) out[key] = values[key];
    }
    // Only what changes the file
    for (const key of Object.keys(out)) if (sameAs(current[key], out[key])) delete out[key];
    return out;
  }
  const changes = Object.keys(answers()).length;

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    if (!leader && !respondent) {
      setFormError('fiche.whoMissing');
      formRef.current?.querySelector('[data-who] button')?.focus();
      return;
    }
    // «Oui» without saying which: ask for the detail rather than drop the answer
    const vague = {};
    if (asked.has('allergies') && open('allergies') && hasAllergy && !values.allergies?.trim()) vague.allergies = 'detail';
    if (asked.has('treatment') && open('treatment') && hasTreatment && !values.treatment?.trim()) vague.treatment = 'detail';
    if (Object.keys(vague).length) {
      setErrors(vague);
      setFormError(null);
      formRef.current?.querySelector(`[data-field="${Object.keys(vague)[0]}"] textarea`)?.focus();
      return;
    }
    // Nothing changed: the file is confirmed as it is
    const payload = answers();
    // A new عنصر needs his names, sex and birth date
    const lacking = [...required].filter((k) => !(k in payload));
    if (lacking.length) {
      setErrors(Object.fromEntries(lacking.map((k) => [k, 'required'])));
      setFormError('fiche.errRequiredForm');
      formRef.current?.querySelector(`[data-field="${lacking[0]}"] :is(input,button)`)?.focus();
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      const r = await api.post(`/public/fiche/${encodeURIComponent(token)}`, { respondent: leader ? 'self' : respondent, answers: payload });
      setDone(r?.status === 'confirmed' ? 'confirmed' : 'submitted');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setBusy(false);
      if (err.code === 'invalid_answers' && err.body?.fields) {
        setErrors(err.body.fields);
        const first = data.fields.find((k) => err.body.fields[k]);
        formRef.current?.querySelector(`[data-field="${first}"] :is(input,textarea,button)`)?.focus();
      } else if (err.code === 'closed') setFormError(err.body?.status === 'disabled' ? 'fiche.disabledTitle' : 'fiche.closedTitle');
      else if (err.status === 429) setFormError('fiche.errTooMany');
      else setFormError(err.network ? 'error.network' : 'error.requestFailed');
    }
  }

  if (done)
    return (
      <Notice
        tone="success"
        title={t('fiche.doneTitle')}
        action={
          onAnother && (
            <Button variant="outline" className="w-full sm:w-auto" onClick={onAnother}>
              {t('fiche.another')}
            </Button>
          )
        }
      >
        {t(
          done === 'confirmed'
            ? 'fiche.confirmedBody'
            : leaderSignup
              ? 'fiche.doneBodyLeaderSignup'
              : leader ? 'fiche.doneBodyLeader' : signup ? 'fiche.doneBodySignup' : 'fiche.doneBody'
        )}
      </Notice>
    );

  const errorText = (key) =>
    errors[key] === 'required'
      ? t('fiche.errRequired')
      : errors[key] === 'too_long'
      ? t('fiche.errTooLong')
      : errors[key] === 'detail'
        ? t(key === 'allergies' ? 'fiche.allergiesDetail' : 'fiche.treatmentDetail')
        : errors[key]
          ? t('fiche.errInvalid')
          : null;
  const yesNo = [
    { value: 'no', label: t('fiche.no') },
    { value: 'yes', label: t('fiche.yes') },
  ];

  function control(key, f) {
    if (key === 'birth_date')
      return (
        <DatePicker
          {...f}
          fromYear={1950}
          toYear={new Date().getFullYear()}
          value={values.birth_date || ''}
          onChange={set('birth_date')}
        />
      );
    if (PHONES.includes(key))
      return (
        <Input
          {...f}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          placeholder={t('fiche.phonePlaceholder')}
          value={values[key] || ''}
          onChange={set(key)}
          maxLength={40}
        />
      );
    if (key === 'blood_type')
      return (
        // Tapping the chosen group again clears it: «je ne sais pas» is no answer
        <SegmentedControl
          label={label(key)}
          columns={4}
          options={data.blood_types.map((b) => ({ value: b, label: <span dir="ltr">{b}</span> }))}
          value={values.blood_type || ''}
          onChange={(v) => setValues((s) => ({ ...s, blood_type: s.blood_type === v ? '' : v }))}
          className="w-full"
        />
      );
    if (key === 'sex')
      return (
        <SegmentedControl
          label={label(key)}
          options={[
            { value: 'M', label: t('member.male') },
            { value: 'F', label: t('member.female') },
          ]}
          value={values.sex || ''}
          onChange={(v) => {
            setValues((s) => ({ ...s, sex: v }));
            setErrors((e) => ({ ...e, sex: undefined }));
          }}
          className="flex w-full"
        />
      );
    if (key === 'marital_status')
      return (
        <SegmentedControl
          label={label(key)}
          options={[
            { value: 'single', label: t('leader.single') },
            { value: 'married', label: t('leader.married') },
          ]}
          value={values.marital_status || ''}
          onChange={(v) => setValues((s) => ({ ...s, marital_status: s.marital_status === v ? '' : v }))}
          className="flex w-full"
        />
      );
    if (key === 'join_year' || key === 'years_ghadir' || key === 'years_total')
      return (
        <Input
          {...f}
          inputMode="numeric"
          dir="ltr"
          maxLength={key === 'join_year' ? 4 : 2}
          placeholder={key === 'join_year' ? '2015' : '0'}
          value={values[key] || ''}
          onChange={(e) => setValues((s) => ({ ...s, [key]: e.target.value.replace(/\D/g, '') }))}
          className="max-w-32 sm:h-11"
        />
      );
    if (key === 'education')
      return <Textarea {...f} rows={2} value={values.education || ''} onChange={set('education')} maxLength={300} />;
    if (key === 'can_swim')
      return (
        <SegmentedControl
          label={label(key)}
          options={yesNo}
          value={values.can_swim === true ? 'yes' : values.can_swim === false ? 'no' : ''}
          onChange={(v) => setValues((s) => ({ ...s, can_swim: v === 'yes' }))}
          className="flex w-full"
        />
      );
    if (key === 'allergies' || key === 'treatment') {
      const has = key === 'allergies' ? hasAllergy : hasTreatment;
      const setHas = key === 'allergies' ? setHasAllergy : setHasTreatment;
      return (
        <div className="space-y-2.5">
          <SegmentedControl
            label={label(key)}
            options={yesNo}
            value={has === true ? 'yes' : has === false ? 'no' : ''}
            onChange={(v) => setHas(v === 'yes')}
            className="flex w-full"
          />
          {has && (
            <Textarea
              {...f}
              rows={2}
              autoFocus
              aria-label={t(key === 'allergies' ? 'fiche.allergiesDetail' : 'fiche.treatmentDetail')}
              placeholder={t(key === 'allergies' ? 'fiche.allergiesDetail' : 'fiche.treatmentDetail')}
              value={values[key] || ''}
              onChange={set(key)}
              maxLength={1000}
            />
          )}
        </div>
      );
    }
    return (
      <Input
        {...f}
        value={values[key] || ''}
        onChange={set(key)}
        maxLength={MAX[key]}
        autoComplete="off"
        className="sm:h-11"
      />
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-8">
      <p className="text-[0.9375rem] text-muted-foreground">
        {t(leaderSignup ? 'fiche.introLeaderSignup' : leader ? 'fiche.introLeader' : signup ? 'fiche.introSignup' : 'fiche.intro')}
      </p>

      {!leader && (
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t('fiche.who')}</legend>
        <div data-who>
          <SegmentedControl
            label={t('fiche.who')}
            columns={2}
            options={[
              { value: 'self', label: t(female ? 'fiche.whoSelfF' : 'fiche.whoSelf') },
              { value: 'father', label: t('fiche.whoFather') },
              { value: 'mother', label: t('fiche.whoMother') },
              { value: 'other', label: t('fiche.whoOther') },
            ]}
            value={respondent}
            onChange={(v) => {
              setRespondent(v);
              if (formError === 'fiche.whoMissing') setFormError(null);
            }}
            className="w-full"
          />
        </div>
      </fieldset>
      )}

      {SECTIONS[data.kind in SECTIONS ? data.kind : 'member'].map(([title, keys]) => {
        const shown = keys.filter((k) => asked.has(k));
        if (!shown.length) return null;
        return (
          <section key={title} className="space-y-4">
            <h2 className="border-b border-border pb-2 text-base font-semibold">{t(`fiche.${title}`)}</h2>
            {shown.map((key) =>
              open(key) ? (
                <div key={key} data-field={key} className={cn(editing.has(key) && 'rounded-xl border border-primary/25 bg-primary/5 p-3')}>
                  <Field
                    label={label(key)}
                    hint={
                      editing.has(key)
                        ? null
                        : key === 'blood_type' ? t(leader ? 'fiche.bloodHintLeader' : 'fiche.bloodHint') : null
                    }
                    error={errorText(key)}
                  >
                    {(f) => control(key, f)}
                  </Field>
                  {editing.has(key) && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{t('fiche.currentValue')} {display(key, current[key])}</span>
                      <Button variant="ghost" size="sm" onClick={() => cancelEdit(key)}>
                        {t('fiche.cancelCorrection')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                // Already on the file: read it, and open it only to correct it
                <div key={key} data-field={key} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-medium">{label(key)}</p>
                    <p className="mt-0.5 break-words text-[0.9375rem] text-muted-foreground" lang={i18n.language}>
                      {display(key, current[key])}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0 text-primary" onClick={() => startEdit(key)}>
                    <IconPencil className="h-3.5 w-3.5" />
                    {t('fiche.correct')}
                  </Button>
                </div>
              )
            )}
          </section>
        );
      })}

      <div className="space-y-4 border-t border-border pt-6">
        <p className="flex gap-2.5 text-sm text-muted-foreground">
          <IconLock className="mt-0.5 shrink-0" />
          <span>
            {t(leaderSignup ? 'fiche.privacyLeaderSignup' : leader ? 'fiche.privacyLeader' : 'fiche.privacy')}
            {/* A permanent link has no end date */}
            {data.expires_at && ` ${t('fiche.validUntil', { date: fmtDate(data.expires_at.slice(0, 10)) })}`}
          </span>
        </p>
        {formError && (
          <div
            role="alert"
            className="animate-fade-up flex gap-2.5 rounded-lg bg-destructive/10 px-3.5 py-3 text-sm font-medium text-destructive"
          >
            <IconAlert className="mt-0.5" />
            <p>{t(formError)}</p>
          </div>
        )}
        <Button type="submit" variant="brand" className="w-full sm:h-11" loading={busy}>
          {signup ? t('fiche.submitSignup') : changes ? t('fiche.submit') : t('fiche.confirm')}
        </Button>
      </div>
    </form>
  );
}
