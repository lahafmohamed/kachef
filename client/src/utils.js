// ISO (AAAA-MM-JJ) -> JJ/MM/AAAA
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 'today' | 'tomorrow' | null for a YYYY-MM-DD birth date.
 * Month-day only, so it matches every year; the window stops at one day ahead.
 */
export function birthdayWhen(birthDate) {
  if (!birthDate) return null;
  const md = (d) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = birthDate.slice(5);
  if (target === md(now)) return 'today';
  if (target === md(tomorrow)) return 'tomorrow';
  return null;
}

// Works for objects carrying either name_fr/name_ar or branch_name_fr/branch_name_ar
export function branchName(obj, lng) {
  if (!obj) return '';
  return lng === 'ar'
    ? obj.name_ar ?? obj.branch_name_ar ?? ''
    : obj.name_fr ?? obj.branch_name_fr ?? '';
}

// Downscale an image file to a small JPEG data URL (avatar-sized)
export function fileToDataUrl(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
