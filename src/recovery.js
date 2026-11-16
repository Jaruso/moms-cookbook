// Local-only safety net for unsaved form entries (never stores credentials or photos).
// A new recipe has one recovery slot; each existing recipe has its own slot.
export const RECOVERY_PREFIX = 'moms-cookbook:unsaved:v1:';

const FIELDS = ['title', 'description', 'category', 'prepMinutes', 'cookMinutes', 'servings', 'steps'];

export function recoveryKey(editing) {
  if (!editing) return null;
  return RECOVERY_PREFIX + (editing === 'new' ? 'new' : 'recipe:' + editing.id);
}

export function cleanForm(form) {
  const output = {};
  for (const field of FIELDS) {
    output[field] = String(form?.[field] ?? '');
  }
  output.ingredients = (Array.isArray(form?.ingredients) ? form.ingredients : []).slice(0, 60)
    .map(row => ({
      amount: String(row?.amount ?? ''),
      unit: String(row?.unit ?? ''),
      customUnit: String(row?.customUnit ?? ''),
      name: String(row?.name ?? ''),
    }));
  return output;
}

export function formSignature(form, removePhoto = false) {
  return JSON.stringify({ form: cleanForm(form), removePhoto: removePhoto === true });
}

export function createRecovery(editing, form, removePhoto, hadPhoto, now = Date.now()) {
  return {
    version: 1,
    savedAt: now,
    id: editing === 'new' ? null : editing.id,
    sha: editing === 'new' ? null : editing.sha,
    form: cleanForm(form),
    removePhoto: removePhoto === true,
    hadPhoto: hadPhoto === true,
  };
}

export function readRecovery(storage, key) {
  if (!storage || !key || !key.startsWith(RECOVERY_PREFIX)) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.version !== 1 || !record.form || typeof record.form !== 'object' ||
        !Array.isArray(record.form.ingredients) || record.form.ingredients.length < 1 ||
        record.form.ingredients.length > 60 ||
        FIELDS.some(field => typeof record.form[field] !== 'string') ||
        record.form.ingredients.some(row => !row || ['amount', 'unit', 'customUnit', 'name']
          .some(field => typeof row[field] !== 'string')) ||
        (record.id !== null && typeof record.id !== 'string') ||
        typeof record.savedAt !== 'number') return null;
    if (key !== RECOVERY_PREFIX + (record.id === null ? 'new' : 'recipe:' + record.id)) return null;
    return record;
  } catch { return null; }
}

export function writeRecovery(storage, key, record) {
  try {
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch { return false; }
}

export function removeRecovery(storage, key) {
  try { if (key) storage.removeItem(key); } catch { /* storage may be blocked */ }
}

export function listRecoveries(storage) {
  const result = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(RECOVERY_PREFIX)) continue;
      const record = readRecovery(storage, key);
      if (record) result.push({ key, record });
    }
  } catch { return []; }
  return result.sort((a, b) => b.record.savedAt - a.record.savedAt);
}
