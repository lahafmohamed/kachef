import { useTranslation } from 'react-i18next';
import { Label, SegmentedControl } from './ui';

/**
 * «القسم»: الفتيان / الفتيات — plus «الكل» where both is a valid answer (an account
 * open on both أقسام). The same segmented look as the الجنس field of a عنصر.
 */
export default function SectionField({ value, onChange, allowBoth = false, hint }) {
  const { t } = useTranslation();
  const options = [
    ...(allowBoth ? [{ value: '', label: t('section.all') }] : []),
    { value: 'M', label: t('section.M') },
    { value: 'F', label: t('section.F') },
  ];
  return (
    <div className="space-y-1.5">
      <Label>{t('section.label')}</Label>
      <SegmentedControl
        label={t('section.label')}
        value={value}
        onChange={onChange}
        options={options}
        className="flex w-full"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
