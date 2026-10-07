import { useTranslation } from 'react-i18next';
import { SECTIONS } from '../section';
import { Label, SegmentedControl } from './ui';

/**
 * «القسم»: الفتيان / الفتيات / الفرنكوفون — plus «الكل» where every قسم is a valid
 * answer (an account open on all أقسام). The same segmented look as the الجنس field of
 * a عنصر; two by two once there are more than three choices.
 */
export default function SectionField({ value, onChange, allowBoth = false, hint }) {
  const { t } = useTranslation();
  const options = [
    ...(allowBoth ? [{ value: '', label: t('section.all') }] : []),
    ...SECTIONS.map((s) => ({ value: s, label: t(`section.${s}`) })),
  ];
  return (
    <div className="space-y-1.5">
      <Label>{t('section.label')}</Label>
      <SegmentedControl
        label={t('section.label')}
        value={value}
        onChange={onChange}
        options={options}
        columns={options.length > 3 ? 2 : undefined}
        className="flex w-full"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
