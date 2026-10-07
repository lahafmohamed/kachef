// One-shot (2026-10-07): delete the old all-ages «Francophone» branch of قسم الفتيان. The
// francophones now have their own أقسام (FR garçons, FRF filles), so this branch, its plan
// and its four tachkila slots go. The قادة themselves stay. Refuses if a عنصر, نشاط,
// attendance row or promotion still points at it. Matched by name, not id: ids differ on
// the VPS. Usage: node delete-legacy-francophone.js [--apply]
const { db } = require('./db');

const apply = process.argv.includes('--apply');
const b = db
  .prepare("SELECT * FROM branches WHERE name_fr = 'Francophone' AND section = 'M' AND all_ages = 1")
  .get();
if (!b) {
  console.log('No legacy «Francophone» branch — nothing to do.');
  process.exit(0);
}

const count = (sql) => db.prepare(sql).get(b.id, b.id).n;
const blockers = {
  members: count('SELECT COUNT(*) n FROM members WHERE branch_id = ? OR branch_id = ?'),
  sessions: count('SELECT COUNT(*) n FROM sessions WHERE branch_id = ? OR branch_id = ?'),
  attendance: count('SELECT COUNT(*) n FROM attendance WHERE branch_id = ? OR branch_id = ?'),
  promotions: count('SELECT COUNT(*) n FROM promotions WHERE old_branch_id = ? OR new_branch_id = ?'),
  member_branch_history: count(
    'SELECT COUNT(*) n FROM member_branch_history WHERE old_branch_id = ? OR new_branch_id = ?'
  ),
};
const gone = {
  annual_plan: count('SELECT COUNT(*) n FROM annual_plan WHERE branch_id = ? OR branch_id = ?'),
  plan_baseline: count('SELECT COUNT(*) n FROM plan_baseline WHERE branch_id = ? OR branch_id = ?'),
  plan_validations: count('SELECT COUNT(*) n FROM plan_validations WHERE branch_id = ? OR branch_id = ?'),
  branch_groups: count('SELECT COUNT(*) n FROM branch_groups WHERE branch_id = ? OR branch_id = ?'),
  assignments: count('SELECT COUNT(*) n FROM assignments WHERE branch_id = ? OR branch_id = ?'),
};
console.log('Branch', b.id, b.name_fr, '/', b.name_ar);
console.log('Blockers:', blockers);
console.log('Deleted with it:', gone);
if (Object.values(blockers).some((n) => n > 0)) {
  console.error('Still in use — not deleted.');
  process.exit(1);
}
if (!apply) {
  console.log('Dry run. Re-run with --apply to delete.');
  process.exit(0);
}

db.transaction(() => {
  // assignments.branch_id is SET NULL: they would survive as branch-less slots, so they go first
  db.prepare('DELETE FROM assignments WHERE branch_id = ?').run(b.id);
  // The rest (plan, baseline, validations, groups, counts…) cascades
  db.prepare('DELETE FROM branches WHERE id = ?').run(b.id);
  if (db.pragma('foreign_key_check').length) throw new Error('foreign_key_check failed');
})();
console.log('Deleted.');
