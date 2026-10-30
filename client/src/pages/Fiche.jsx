import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import AuthLayout, { AuthHeader } from '../components/AuthLayout';
import DatePicker from '../components/DatePicker';
import { fmtDate } from '../utils';
import {
  Button,
  Field,
  Input,
  SegmentedControl,
  Spinner,
  Textarea,
  IconAlert,
  IconCheck,
  IconLock,
} from '../components/ui';

/*
 * Fiche à compléter — the one page opened without an account. A family reaches it from
 * the WhatsApp link a قائد sent; the link is its key (server/memberForms.js). It asks
 * only what the عنصر's file lacks and never shows what the file already holds, then
 * sends the answers to the قائد, who reviews them before they land.
 */

// The form's order and grouping. A section with nothing to ask is left out.
const SECTIONS = [
  ['sectionIdentity', ['birth_date', 'birth_place', 'father_name', 'mother_name', 'school']],
  ['sectionContact', ['address_abidjan', 'member_phone', 'father_phone', 'mother_phone']],
  ['sectionHealth', ['blood_type', 'allergies', 'treatment', 'can_swim', 'emergency_name', 'emergency_phone']],
];
const PHONES = ['member_phone', 'father_phone', 'mother_phone', 'emergency_phone'];
const MAX = { birth_place: 120, father_name: 80, mother_name: 120, school: 120, address_abidjan: 200, emergency_name: 120 };

export default function Fiche() {
  const { token } = useParams();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ loading: true });
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
  const name = data ? `${data.member.first_name} ${data.member.last_name}`.trim() : '';
  const branch = data ? (i18n.language === 'ar' ? data.member.branch_ar : data.member.branch_fr) : '';

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
  else if (data.status === 'submitted' || data.status === 'applied' || data.status === 'rejected')
    body = <Notice tone="success" title={t('fiche.submittedTitle')}>{t('fiche.submittedBody', { name })}</Notice>;
  else if (data.status !== 'open')
    body = <Notice tone="muted" title={t('fiche.closedTitle')}>{t('fiche.closedBody')}</Notice>;
  else if (!data.fields.length)
    body = <Notice tone="success" title={t('fiche.completeTitle')}>{t('fiche.completeBody')}</Notice>;
  else body = <FicheForm token={token} data={data} />;

  return (
    <AuthLayout>
      <div className="space-y-7">
        <AuthHeader title={data ? t('fiche.title', { name }) : t('fiche.docTitle')}>
          {data ? branch : null}
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

function FicheForm({ token, data }) {
  const { t } = useTranslation();
  const asked = new Set(data.fields);
  const female = data.member.sex === 'F';
  const [respondent, setRespondent] = useState('');
  const [values, setValues] = useState({});
  // Allergies and treatment: «non» first, the detail only after «oui»
  const [hasAllergy, setHasAllergy] = useState(null);
  const [hasTreatment, setHasTreatment] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useRef(null);

  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const label = (key) => t(`fiche.fields.${key === 'can_swim' && female ? 'can_swimF' : key}`);

  function answers() {
    const out = {};
    for (const key of data.fields) {
      if (key === 'allergies') {
        if (hasAllergy === false) out.allergies = t('fiche.noneAllergy');
        else if (hasAllergy && values.allergies?.trim()) out.allergies = values.allergies;
      } else if (key === 'treatment') {
        if (hasTreatment === false) out.treatment = t('fiche.noneTreatment');
        else if (hasTreatment && values.treatment?.trim()) out.treatment = values.treatment;
      } else if (key === 'can_swim') {
        if (typeof values.can_swim === 'boolean') out.can_swim = values.can_swim;
      } else if (values[key]?.trim()) out[key] = values[key];
    }
    return out;
  }

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    if (!respondent) {
      setFormError('fiche.whoMissing');
      formRef.current?.querySelector('[data-who] button')?.focus();
      return;
    }
    // «Oui» without saying which: ask for the detail rather than drop the answer
    const vague = {};
    if (asked.has('allergies') && hasAllergy && !values.allergies?.trim()) vague.allergies = 'detail';
    if (asked.has('treatment') && hasTreatment && !values.treatment?.trim()) vague.treatment = 'detail';
    if (Object.keys(vague).length) {
      setErrors(vague);
      setFormError(null);
      formRef.current?.querySelector(`[data-field="${Object.keys(vague)[0]}"] textarea`)?.focus();
      return;
    }
    const payload = answers();
    if (!Object.keys(payload).length) {
      setFormError('fiche.errEmpty');
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      await api.post(`/public/fiche/${encodeURIComponent(token)}`, { respondent, answers: payload });
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setBusy(false);
      if (err.code === 'invalid_answers' && err.body?.fields) {
        setErrors(err.body.fields);
        const first = data.fields.find((k) => err.body.fields[k]);
        formRef.current?.querySelector(`[data-field="${first}"] :is(input,textarea,button)`)?.focus();
      } else if (err.code === 'closed') setFormError('fiche.closedTitle');
      else setFormError(err.network ? 'error.network' : 'error.requestFailed');
    }
  }

  if (done) return <Notice tone="success" title={t('fiche.doneTitle')}>{t('fiche.doneBody')}</Notice>;

  const errorText = (key) =>
    errors[key] === 'too_long'
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
      <p className="text-[0.9375rem] text-muted-foreground">{t('fiche.intro')}</p>

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

      {SECTIONS.map(([title, keys]) => {
        const shown = keys.filter((k) => asked.has(k));
        if (!shown.length) return null;
        return (
          <section key={title} className="space-y-4">
            <h2 className="border-b border-border pb-2 text-base font-semibold">{t(`fiche.${title}`)}</h2>
            {shown.map((key) => (
              <div key={key} data-field={key}>
                <Field
                  label={label(key)}
                  hint={key === 'blood_type' ? t('fiche.bloodHint') : null}
                  error={errorText(key)}
                >
                  {(f) => control(key, f)}
                </Field>
              </div>
            ))}
          </section>
        );
      })}

      <div className="space-y-4 border-t border-border pt-6">
        <p className="flex gap-2.5 text-sm text-muted-foreground">
          <IconLock className="mt-0.5 shrink-0" />
          <span>
            {t('fiche.privacy')} {t('fiche.validUntil', { date: fmtDate(data.expires_at.slice(0, 10)) })}
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
          {t('fiche.submit')}
        </Button>
      </div>
    </form>
  );
}
