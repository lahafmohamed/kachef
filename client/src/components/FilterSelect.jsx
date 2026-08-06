import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './shadcn/select';

/**
 * Thin wrapper over the shadcn Select for the common filter case:
 * a flat option list plus an "all" entry. Radix has no empty-string value,
 * so '' is mapped to a sentinel internally.
 */
const ALL = '__all__';

export default function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  placeholder,
  icon,
  className,
  ariaLabel,
}) {
  return (
    <Select value={value === '' ? ALL : String(value)} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger className={className} aria-label={ariaLabel} icon={icon}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
