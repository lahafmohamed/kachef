const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.SCOUT_DB || path.join(__dirname, 'scout.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Decided before the CREATE below runs: the curated lists are seeded from the old
// free-text values exactly once, on the boot that introduces them. Re-seeding later
// would resurrect entries an admin deleted on purpose, and emptying a list on purpose
// must stay emptied.
const lookupsTableIsNew = !db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lookup_values'")
  .get();
// Same rule for the evaluation forms: the default one is copied in on the boot that
// creates the tables, never again — a form the admin deleted stays deleted.
let evalTablesAreNew = !db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'eval_forms'")
  .get();

// ---------- الأقسام ----------
// كل قسم يُدار وحده: فرقه و قادته و حساباته و تشكيلته و صناديقه و أنشطته. code هو ما
// يُخزَّن في عمود section من كل جدول. gender: جنس عناصر القسم (null = مختلط)، و به
// تُؤنَّث التوصيفات (قائدة)؛ lang: لغة التوصيفات التي يولّدها قالب التشكيلة. 'M' هو
// الفوج نفسه: أماناته في القالب، و القيمة الافتراضية لكل ما سبق الأقسام.
// التوأم في client/src/api.js. قسم جديد = سطر هنا و سطر هناك، و اسماه في ملفّي
// الترجمة (section.<code> و section.name<code>) — لا تغيير في الجداول.
const SECTION_DEFS = [
  { code: 'M', gender: 'M', lang: 'ar' },
  { code: 'F', gender: 'F', lang: 'ar' },
  { code: 'FR', gender: 'M', lang: 'fr' },
  { code: 'FRF', gender: 'F', lang: 'fr' },
];
const sectionDef = (code) => SECTION_DEFS.find((s) => s.code === code) || null;

db.exec(`
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  min_age INTEGER NOT NULL,
  max_age INTEGER,
  sort_order INTEGER NOT NULL,
  total_requirements INTEGER NOT NULL DEFAULT 0,
  -- فرقة خاصة لكل الأعمار: خارج سلّم السنّ، لا ترفيع منها و لا إليها
  all_ages INTEGER NOT NULL DEFAULT 0,
  -- القسم (SECTION_DEFS): 'M' الفتيان، 'F' الفتيات، 'FR' الفرنكوفون الفتيان، 'FRF' الفرنكوفونيات. حساب مقيَّد بقسم
  -- لا يرى فرق غيره و لا عناصرها، و الترفيع يصعد في سلّم قسمه وحده. لا CHECK على
  -- القيم: الخادم يتحقّق منها، فقسمٌ جديد لا يحتاج إعادة بناء الجداول.
  section TEXT NOT NULL DEFAULT 'M'
);

-- مجموعات الفرقة: الفرقة الكبيرة تُقسَّم إلى مجموعات، لأن الحصّة الواحدة لا تسع
-- عناصرها كلهم، و لأن المجموعة قد يعطيها قائد آخر نشاطًا مختلفًا. التوزيع يدوي
-- (members.group_id)، و المجموعة اختيارية: فرقة بلا مجموعات تبقى تعمل كما كانت.
CREATE TABLE IF NOT EXISTS branch_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  -- NOCASE so "Groupe A" and "groupe a" collide instead of becoming two groups
  name TEXT NOT NULL COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- الفئة العمرية للطليعة، اختيارية: «من ٥ إلى ٦» = age_from 5، age_to 6 (الحدّ الأعلى
  -- غير داخل). السنّ هنا سنّ السنة: ما يبلغه العنصر في السنة الميلادية التي تبدأ فيها
  -- السنة الكشفية، أي سنة ميلاده — فمواليد السنة الواحدة في طليعة واحدة طوال السنة،
  -- و يصعدون معًا كل أيلول. NULL = طليعة بلا سنّ (اختصاص، مستوى): توزيعها يدوي.
  age_from INTEGER,
  age_to INTEGER,
  UNIQUE(branch_id, name)
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  father_name TEXT,
  mother_name TEXT,
  birth_date TEXT,
  birth_place TEXT,
  address_abidjan TEXT,
  address_lebanon TEXT,
  school TEXT,
  sex TEXT NOT NULL CHECK (sex IN ('M', 'F')),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  member_phone TEXT,
  father_phone TEXT,
  mother_phone TEXT,
  join_date TEXT,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  archived_at TEXT,
  archived_by TEXT
);

-- مطالب added or cancelled by hand for one عنصر. Attendance stays the normal way a
-- مطلب is earned; a row here overrides it in one direction or the other.
CREATE TABLE IF NOT EXISTS member_matalib (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('granted', 'revoked')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  UNIQUE(member_id, branch_id, number)
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  old_branch_id INTEGER NOT NULL REFERENCES branches(id),
  new_branch_id INTEGER NOT NULL REFERENCES branches(id),
  promoted_at TEXT NOT NULL,
  matalib TEXT NOT NULL DEFAULT '[]',
  reversed_at TEXT,
  reversed_by TEXT,
  reversal_reason TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  -- NULL for a نشاط قادة or a نشاط عام للفوج: they belong to the فوج, not to one فرقة
  branch_id INTEGER REFERENCES branches(id),
  leader TEXT,
  leader_id INTEGER,
  fee REAL,
  matalib TEXT NOT NULL DEFAULT '[]',
  -- زمان و مكان النشاط, filled by the قائد alongside the title
  start_time TEXT,
  place TEXT,
  -- طبيعة النشاط: weekly | cultural | ashura | ramadan | summer_clubs
  activity_type TEXT,
  -- نشاط عام للفوج only: عدد حضور القادة (a count, there is no قادة roster to mark)
  leaders_count INTEGER,
  -- بند الخطة السنوية الذي ينفّذه هذا النشاط، يختاره القائد عند الإنشاء.
  -- SET NULL: حذف بند من الخطة لا يحذف النشاط، يفكّ الربط فقط.
  plan_item_id INTEGER REFERENCES annual_plan(id) ON DELETE SET NULL,
  -- 'activity' = نشاط فرقة, 'visit' = زيارة الأهل (présence = who was visited),
  -- 'leaders' = نشاط قادة (présence is the قادة themselves; فرق مدعوّة اختيارية في
  --   session_branches تضيف عناصرها إلى اللائحة، و الضيوف في session_guests),
  -- 'group' = نشاط عام للفوج (حضور مسجّل بالعدد لكل فرقة, لا بالأسماء)
  kind TEXT NOT NULL DEFAULT 'activity' CHECK (kind IN ('activity', 'visit', 'leaders', 'group')),
  attendance_finalized_at TEXT,
  attendance_finalized_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- قسم النشاط: قسم فرقه، أو القسم الذي أُنشئ فيه نشاط القادة / النشاط العام بلا فرق
  section TEXT NOT NULL DEFAULT 'M'
);

-- نشاط عام للفوج: عدد الحضور لكل فرقة بالتفصيل
CREATE TABLE IF NOT EXISTS session_branch_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(session_id, branch_id)
);

-- الفرق التي يشملها نشاط واحد: نفس الحصّة تُعطى أحيانًا لفرقتين أو أكثر معًا، فتُسجَّل
-- مرّة واحدة و تُحتسب لكل فرقة. sessions.branch_id يبقى الفرقة الرئيسية (الأولى): هي التي
-- تحمل اسم الفرقة في القوائم، و كل صفوف الجدول هنا تشملها.
-- الثابت: كل نشاط له branch_id غير NULL له صف هنا على الأقل.
CREATE TABLE IF NOT EXISTS session_branches (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, branch_id)
);

-- ضيوف نشاط القادة: أسماء حرّة لمن حضر من خارج البرنامج (قائد من فوج آخر، مدرّب،
-- وليّ أمر...). لا ملفّ لهم و لا يدخلون أي معدّل: الاسم وحده يُحفظ، و وجوده يعني الحضور.
CREATE TABLE IF NOT EXISTS session_guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_guests_session ON session_guests(session_id);

-- صور النشاط و ملفاته (PDF، Excel): الملف نفسه على القرص في uploads/sessions/<id>/،
-- و هنا اسمه الأصلي و نوعه. thumb_name: مصغّر JPEG للصورة، يُرسل مع الأصل.
CREATE TABLE IF NOT EXISTS session_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'excel')),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  thumb_name TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id);

-- صور المخيم أو التكوين و ملفاته: شكل session_files نفسه، في uploads/events/<id>/
CREATE TABLE IF NOT EXISTS event_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'excel')),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  thumb_name TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_files_event ON event_files(event_id);

-- مجموعات الفرقة التي تشارك في نشاط. الفرقة التي لها صف هنا لا يشارك منها إلا
-- عناصر تلك المجموعات؛ و الفرقة التي لا صف لها تشارك كاملةً — و هي الحالة الوحيدة
-- قبل وجود المجموعات، فكل نشاط قديم يبقى نشاط فرقة كاملة بلا تعديل.
CREATE TABLE IF NOT EXISTS session_groups (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES branch_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, group_id)
);

-- بنود الخطة التي ينفّذها نشاط. البند يخصّ فرقة واحدة، و النشاط المشترك يشمل عدّة
-- فرق، فقد ينفّذ بندًا من خطة كل فرقة يشملها — بند واحد لكل فرقة على الأكثر.
-- sessions.plan_item_id يبقى بند الفرقة الرئيسية، مرآةً لصف من هنا.
CREATE TABLE IF NOT EXISTS session_plan_items (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  plan_item_id INTEGER NOT NULL REFERENCES annual_plan(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, plan_item_id)
);

-- ملفّ القائد. كل ما بعد الاسم و الهاتف اختياري: القادة المسجَّلون قبل توسيع
-- الاستمارة يبقون صالحين، و تُملأ حقولهم حين يُعدَّل ملفّهم.
-- «التوصيف الحالي» ليس عمودًا هنا عن قصد: هو في assignments (التشكيلة)، سنةً سنة،
-- و نسخه هنا يخلق مرجعين يتناقضان أول ما تتغيّر التشكيلة.
CREATE TABLE IF NOT EXISTS leaders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  father_name TEXT,
  last_name TEXT NOT NULL,
  birth_date TEXT,
  phone TEXT,
  address_abidjan TEXT,
  address_lebanon TEXT,
  -- 'single' | 'married'
  marital_status TEXT,
  -- سنة الانتساب إلى كشافة الغدير، أربعة أرقام
  join_year TEXT,
  -- سنوات الخدمة كقائد: في فوج الغدير، ثم في الأفواج كلها. الثانية ليست محسوبة من
  -- الأولى: قائد قد يكون خدم في فوج آخر قبل أن ينتسب إلى الغدير.
  years_ghadir INTEGER,
  years_total INTEGER,
  -- المستوى العلمي و الاختصاص الجامعي، نصًّا حرًّا
  education TEXT,
  -- الدورات التدريبية التي خضع لها، مصفوفة JSON من رموز قائمة مغلقة. قائمةٌ لأن
  -- القائد قد يكون خضع لأكثر من دورة، و مغلقةٌ لأن الدورات معروفة بأسمائها.
  training_level TEXT NOT NULL DEFAULT '[]',
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  archived_at TEXT,
  archived_by TEXT,
  -- قسم القائد (القائدة في قسم الفتيات): القائد بلا فرقة، فقسمه هو ما يحصره في قسمه
  section TEXT NOT NULL DEFAULT 'M'
);

-- فرقة القادة: the مطالب list a قائد is followed on. Its content is agreed with
-- السيد علي, so the catalog is data an admin edits, not something hard-coded here.
CREATE TABLE IF NOT EXISTS leader_matalib (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- اشتراك القادة الشهري: صفّ = شهر دفعه قائد. غياب الصف = لم يدفع ذلك الشهر.
-- month = 'YYYY-MM'؛ السنة الكشفية من أيلول إلى آب، فتُستخرج من الشهر و لا تُخزَّن.
-- amount يُحفظ مع كل دفعة: تغيّر قيمة الاشتراك لاحقًا لا يغيّر ما دُفع قبلها.
CREATE TABLE IF NOT EXISTS leader_dues (
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by TEXT,
  PRIMARY KEY (leader_id, month)
);

-- بطاقة تقدم القائد: one row = one مطلب this قائد achieved in that سنة.
-- The card is yearly, so the same مطلب can be followed again the next year.
CREATE TABLE IF NOT EXISTS leader_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  matlab_id INTEGER NOT NULL REFERENCES leader_matalib(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  achieved_at TEXT NOT NULL DEFAULT (date('now')),
  note TEXT,
  UNIQUE(leader_id, matlab_id, year)
);

-- التشكيلة: yearly role assignments (قائد فرقة أو أمانة). One row = one توصيف.
-- leader_id is nullable: a توصيف exists as an empty slot until a قائد is assigned to it.
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT NOT NULL,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  -- توصيفٌ قد يخصّ مجموعةً من مجموعات الفرقة لا الفرقة كلها (قائد مجموعة بحارة).
  -- NULL = توصيف الفرقة كلها. حذف المجموعة يُفرِّغه يدويًا في نقطة الحذف، فيعود
  -- توصيفًا عاديًا للفرقة بدل أن يضيع.
  group_id INTEGER REFERENCES branch_groups(id) ON DELETE SET NULL,
  -- الأمانة فريقٌ لا منصبَ فرد: الأمين و معه قادة يساعدونه، بلا عناصر. توصيفُ
  -- مساعدةٍ يتبع توصيف أمينه عبر هذا العمود — مستوى واحد فقط، و للأمانات وحدها.
  -- حذف الأمين يُفرِّغه يدويًا في نقطة الحذف، فيعود المساعد توصيفًا مستقلًّا.
  parent_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
  role_type TEXT NOT NULL DEFAULT 'amana' CHECK (role_type IN ('branch', 'amana')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- قسم التوصيف: قسم فرقته إن كان توصيف فرقة (يتبعها إن تغيّر)، و إلا فقسم الأمانة
  section TEXT NOT NULL DEFAULT 'M'
);

-- قفل التشكيلة: while a row exists for a year, that year's assignments are frozen.
-- Only an admin can add or remove the row.
CREATE TABLE IF NOT EXISTS tachkila_locks (
  year TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_by TEXT
);

-- A year exists independently from its assignments, including an intentionally
-- empty composition that must survive a refresh.
CREATE TABLE IF NOT EXISTS tachkila_years (
  year TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT
);

-- Animators of a session: one main (animateur principal) + helpers, with their own présence
CREATE TABLE IF NOT EXISTS session_leaders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'helper' CHECK (role IN ('main', 'helper')),
  status TEXT CHECK (status IN ('present', 'absent')),
  UNIQUE(session_id, leader_id)
);

-- Login accounts. branches is a JSON array of branch ids the user may see;
-- NULL means every فرقة (no restriction). Admins always see everything.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  branches TEXT,
  -- JSON array of page keys the account may open (members, sessions, branches,
  -- promotions); NULL = every page. Admins ignore it.
  perms TEXT,
  -- القائد صاحب الحساب، إن وُلّد الحساب من صفحة القادة. حذف القائد يفكّ الربط
  -- يدويًا في نقطة الحذف و يُبقي الحساب — قرار حذفه للأدمن.
  leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  -- القسم الذي يُحصر فيه الحساب ('M' الفتيان، 'F' الفتيات)؛ NULL = القسمان. الأدمن يتجاهله.
  section TEXT
);

-- One row per active login; deleting it logs the device out
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Touched on every authenticated request: the idle timeout is measured from here
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- A roster row exists before pointage. This must not count as an absence.
  status TEXT NOT NULL DEFAULT 'unmarked' CHECK (status IN ('unmarked', 'present', 'absent', 'excused')),
  -- Snapshot the organisational position at the time of the session.
  branch_id INTEGER REFERENCES branches(id),
  group_id INTEGER,
  -- الاشتراك المالي الذي دفعه هذا العنصر في هذا النشاط. NULL = لم يدفع (أو لم يُسجَّل بعد)،
  -- و الرقم هو المبلغ المدفوع فعلًا — قد يخالف sessions.fee (دفعة جزئية أو إعفاء).
  paid REAL,
  UNIQUE(session_id, member_id)
);

CREATE TABLE IF NOT EXISTS member_branch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  old_branch_id INTEGER NOT NULL REFERENCES branches(id),
  new_branch_id INTEGER NOT NULL REFERENCES branches(id),
  effective_date TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('promotion', 'transfer', 'correction', 'reversal')),
  changed_by TEXT,
  source_promotion_id INTEGER REFERENCES promotions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- إشعارات للأدمن: قائد أضاف نشاطًا أو عدّل حضوره/منشّطيه/أعداده. Rows are written only
-- for non-admin actors. session_title is a snapshot so the line still reads after the
-- نشاط itself changes; the FK only nulls the link.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('session_create', 'attendance', 'counts', 'animators')),
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  session_title TEXT,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  kind TEXT,
  actor TEXT,
  actor_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "آخر اطّلاع" لكل أدمن — everything newer than seen_at counts as unread for him
CREATE TABLE IF NOT EXISTS notification_seen (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL
);

-- الخطة السنوية للفوج، مفصّلة فرقةً فرقة: كل صف = يوم مبرمج و اسم النشاط المتوقع فيه،
-- ضمن سنة كشفية ("2025-2026" = أيلول حتى آب). عادةً كل سبت فيه نشاط، و يمكن برمجة أي
-- يوم آخر. A row is only the intent: achievement is derived from the أنشطة, never stored.
CREATE TABLE IF NOT EXISTS annual_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT NOT NULL,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT NOT NULL
);

-- اعتماد الخطة السنوية: كل فرقة تكتب خطتها أول السنة، ثم يعتمدها المسؤول. الاعتماد
-- يحفظ نسخة ثابتة من الخطة (plan_baseline)، و كل تغيير بعده يُقرأ بالمقارنة معها:
-- بند معدَّل (يوم أو اسم)، بند محذوف، بند مضاف — لمعرفة هل التزمت الفرقة بخطتها.
CREATE TABLE IF NOT EXISTS plan_validations (
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  validated_at TEXT NOT NULL DEFAULT (datetime('now')),
  validated_by TEXT,
  PRIMARY KEY (branch_id, year)
);

CREATE TABLE IF NOT EXISTS plan_baseline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL
);

-- Referential lists an admin curates (quartiers d'Abidjan, régions du Liban, écoles).
-- Registration picks from them instead of typing free text, so "Zone 4" is always
-- spelled the same way and filtering on it actually returns everybody.
-- The members columns stay plain TEXT: the list constrains new input, it does not
-- own the data, so deleting an entry never rewrites a member's file.
-- بطاقة التحضير: يعدّها القائد قبل نشاط السبت — تفاصيل مسبقة عن النشاط (زمان، مكان،
-- أهداف، فقرات و طرق تدريبية، وسائل، ملاحظات). مستقلة عن جدول الأنشطة عمدًا: تُكتب قبل
-- أن يوجد النشاط نفسه. تُؤرشف بلا حذف و تبقى قابلة للتعديل في أي وقت، و تُحسب في سجلّ
-- القائد الذي أعدّها.
CREATE TABLE IF NOT EXISTS prep_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  -- النشاط الذي حُضِّرت له، إن سُجِّل: البطاقة تُكتب قبل السبت و النشاط قد يُنشأ
  -- بعدها، فالربط اختياري و يُضاف في أي وقت. حذف النشاط يفكّ الربط و يُبقي البطاقة.
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  -- Name snapshot, like sessions.leader: the card still reads after the قائد is deleted
  leader TEXT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  place TEXT,
  -- أرقام المطالب التي سيعمل عليها النشاط، مصفوفة JSON كما في sessions.matalib
  matalib TEXT NOT NULL DEFAULT '[]',
  -- الأهداف، الفقرات والطرق التدريبية بالتفصيل، وسائل تدريبية، ملاحظات — نص حر
  goals TEXT,
  segments TEXT,
  tools TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- من أنشأها (اسم الحساب) — للأرشيف، لا للصلاحيات
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS lookup_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('residence_abidjan', 'residence_lebanon', 'school')),
  -- NOCASE so "Zone 4" and "zone 4" collide on the UNIQUE index instead of
  -- becoming two entries that split the same people across two filters
  label TEXT NOT NULL COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(kind, label)
);

-- المخيمات و الدورات: نشاط يمتدّ يومًا أو أيامًا و فيه جلسات عدّة، لمجموعة ثابتة من
-- المشاركين، بأجرة اشتراك و مصاريف. مستقلّ عن جدول الأنشطة عمدًا: المشاركة فيه
-- اختيارية و مدفوعة، فجلساته لا تدخل في معدّلات حضور الفرق، و لائحته من سُجِّل فيه
-- لا عناصر الفرقة كلهم. kind و فئة المصروف بلا CHECK: قائمتان قد تطولان، و توسيع
-- CHECK في SQLite يعني إعادة بناء الجدول — التحقّق في الخادم.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'camp' مخيم، 'course' دورة، 'trip' رحلة، 'other' غير ذلك
  kind TEXT NOT NULL DEFAULT 'camp',
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  place TEXT,
  -- قيمة الاشتراك المطلوبة من كل مشارك؛ NULL = مجّاني
  fee REAL,
  -- الخطة: الأهداف و البرنامج العام نصًّا حرًّا. الجلسات بتفاصيلها في event_sessions
  plan TEXT,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  -- قسم المخيم: قسم فرقه، أو القسم الذي أُنشئ فيه. لا يتغيّر بعد الإنشاء: مشاركوه منه
  section TEXT NOT NULL DEFAULT 'M',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الفرق المعنية بالمخيم؛ لا صف = الفوج كله. تحصر من يُختار من العناصر، و تحصر رؤية
-- المخيم على الحساب المقيَّد بفرق — كفرق النشاط تمامًا.
CREATE TABLE IF NOT EXISTS event_branches (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, branch_id)
);

-- المشاركون: عنصر، أو قائد، أو ضيف من خارج البرنامج (اسمه فقط) — واحد من الثلاثة.
-- paid تراكمي: كل ما دفعه حتى الآن، NULL = لم يدفع شيئًا. amount_due ما يُطلب منه إن
-- خالف قيمة الاشتراك (0 = معفى، NULL = القيمة نفسها). «دفع» و «جزئي» لا يُخزَّنان:
-- يُستخرجان من المبلغين، فتصحيح قيمة الاشتراك يصحّح حال الجميع.
CREATE TABLE IF NOT EXISTS event_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE CASCADE,
  guest_name TEXT,
  amount_due REAL,
  paid REAL,
  paid_at TEXT,
  recorded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((member_id IS NOT NULL) + (leader_id IS NOT NULL) + (guest_name IS NOT NULL) = 1),
  UNIQUE(event_id, member_id),
  UNIQUE(event_id, leader_id)
);

-- البرنامج: جلسات المخيم أو الدورة بيومها و ساعتها. يومها داخل أيام المخيم.
CREATE TABLE IF NOT EXISTS event_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  -- من يقدّمها: قائد، أو مدرّب من خارج الفوج في دورة — فالاسم نصّ حرّ
  responsible TEXT,
  -- مضمونها: الفقرات، الوسائل، الملاحظات
  notes TEXT
);

-- حضور المشاركين في كل جلسة. لا صف = لم يُسجَّل بعد.
CREATE TABLE IF NOT EXISTS event_attendance (
  session_id INTEGER NOT NULL REFERENCES event_sessions(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES event_participants(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),
  PRIMARY KEY (session_id, participant_id)
);

-- المصاريف: كل صف مبلغ صُرف على المخيم. الرصيد = المحصَّل من المشاركين ناقص مجموعها.
CREATE TABLE IF NOT EXISTS event_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  -- transport | food | gear | venue | other
  category TEXT NOT NULL DEFAULT 'other',
  date TEXT,
  -- من دفعها: الصندوق، أو قائد سلّف المبلغ — نصّ حرّ
  paid_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الهيئة القيادية للمخيم أو الدورة: قائد التجمع، أمين السر، أمين الإعلام، أمين الصندوق،
-- المدرّبون و المعاونون… — كهيئة التدريب في دورات الجمعية. قائد المخيم نفسه يبقى في
-- events.leader_id. الشخص قائد من الفوج، أو اسم من خارجه (مدرّب من الجمعية) — واحد منهما.
-- role: gathering | secretary | media | treasurer | gear | trainer | assistant | medic | other
CREATE TABLE IF NOT EXISTS event_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  -- اسم المسؤولية حين لا تكون في اللائحة (role = other)
  title TEXT,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE CASCADE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((leader_id IS NOT NULL) + (name IS NOT NULL) = 1),
  CHECK (role != 'other' OR title IS NOT NULL)
);

-- التبرعات: مبلغ وصل المخيم من فاعل خير. لا اسم للمتبرّع عن قصد — يُضاف إلى الرصيد فقط.
CREATE TABLE IF NOT EXISTS event_donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  date TEXT,
  -- ما يفيد الحساب: نقدًا، لشراء الخيم… — نصّ حرّ اختياري
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الصندوق: ما يُكتب فيه باليد — مصروف (out)، أو تبرّع أو مدخول آخر (in). اشتراكات
-- الأنشطة (attendance.paid) و اشتراك القادة (leader_dues) و العناصر (member_dues) لا تُنسخ هنا: تُقرأ من
-- مصدرها عند الحساب، فتصحيح خانة دفع يصحّح الصندوق معه. المخيمات خارجه: حسابها في
-- صفحتها. category بلا CHECK كفئات مصاريف المخيم — التحقّق في الخادم.
CREATE TABLE IF NOT EXISTS treasury_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  -- out: gear | food | transport | venue | uniform | other — in: donation | other
  category TEXT NOT NULL DEFAULT 'other',
  -- البيان: ما هو المصروف (إلزامي له)، أو ملاحظة التبرّع و المدخول (اختيارية)
  label TEXT,
  amount REAL NOT NULL CHECK (amount > 0),
  -- يوم المصروف (الشراء)، أو يوم دخول المال
  date TEXT NOT NULL,
  -- يوم خروج المال من الصندوق: يُحسب فيه إن لم يسبق يوم افتتاحه. NULL = مصروف لم
  -- يُدفع بعد (قائد سلّف ثمنه، أو دكّان باع بالدَّين): لا ينقص الصندوق حتى يُسدَّد.
  -- المداخيل: يوم دخولها نفسه.
  paid_on TEXT,
  -- صاحب الدَّين: القائد الذي سلّف أو الدكّان. يبقى بعد التسديد: إلى من دُفع
  owed_to TEXT,
  -- مصروف نشاط: ما اشتُري له. حذف النشاط يفكّ الربط و يُبقي المصروف — المال صُرف فعلًا
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  -- الصندوق: صندوق الفرقة، أو NULL = صندوق الفوج في قسمه. مصروف النشاط من صندوق فرقة
  -- نشاطه ما دام مربوطًا به، و تُحفظ هنا لتبقى إن حُذف النشاط.
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  -- صندوق كل قسم وحده: مصروف النشاط من قسم نشاطه
  section TEXT NOT NULL DEFAULT 'M',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT
);

-- افتتاح صندوق: المبلغ الذي عُدّ فيه صباح ذلك اليوم. لا يُحسب قبله شيء — اشتراكات
-- قديمة صُرفت بلا أثر كانت ستجعل الرصيد كاذبًا. صفّ لكل صندوق: الفوج في قسمه
-- (branch_id NULL) أو فرقة. صندوق فرقة بلا صفّ يبدأ فارغًا يوم افتتاح صندوق الفوج؛
-- صندوق الفوج بلا صفّ لم يُفتح. صفّ واحد للصندوق: فهرس فريد بعد الترحيل.
CREATE TABLE IF NOT EXISTS treasury_openings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  set_by TEXT,
  set_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- تحويل مال من صندوق إلى آخر في القسم نفسه. NULL = صندوق الفوج. لا يغيّر مجموع
-- الصناديق: يخرج من واحد و يدخل الآخر في يومه.
CREATE TABLE IF NOT EXISTS treasury_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  from_branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  to_branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  date TEXT NOT NULL,
  label TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT
);

-- مال بين صندوق و مخيم أو دورة: يُؤخذ من صندوق الفوج أو صندوق فرقة للمخيم (to_event)،
-- أو يُعاد منه إلى صندوق (from_event). يخرج من الصندوق و يدخل حساب المخيم، أو العكس.
-- حذف المخيم يُبقي الحركة في الصندوق: المال خرج منه فعلًا.
CREATE TABLE IF NOT EXISTS event_fundings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  section TEXT NOT NULL,
  -- الصندوق: NULL = صندوق الفوج في قسمه
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('to_event', 'from_event')),
  amount REAL NOT NULL CHECK (amount > 0),
  date TEXT NOT NULL,
  label TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT
);

-- مطابقة صندوق: عُدّ ما فيه فعلًا (counted) و كان السجلّ يقول expected في آخر ذلك
-- اليوم. الفرق (counted − expected) سطر في الصندوق: فائض يدخله أو عجز يخرج منه، فيصير
-- رصيده ما عُدّ. reason إلزامي: لماذا لم يطابق (مصروف نُسي، خطأ في العدّ…). الفرق
-- ثابت بعد الحفظ: ما يُكتب بعدها لا يغيّره، و لا تُحفظ مطابقة بلا فرق.
CREATE TABLE IF NOT EXISTS treasury_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  -- الصندوق: NULL = صندوق الفوج في قسمه
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  counted REAL NOT NULL CHECK (counted >= 0),
  expected REAL NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT
);

-- اشتراك العناصر الشهري: صفّ = دفعة لشهر من عنصر. month = 'YYYY-MM'. الشهر قد يُدفع
-- على دفعات (500 ثم 1500…): يُسدَّد متى بلغ مجموع دفعاته القيمة الشهرية؛ لا صفّ = لم يُدفع
-- منه شيء. يُدفع عادةً في نشاط (session_id: يُفكّ إن حُذف النشاط و تبقى الدفعة) أو يُسجَّل
-- من ملفّ العنصر. amount ما دُفع فعلًا في هذه الدفعة. paid_on: يوم دخول المال، يوم
-- النشاط حين يُدفع فيه. branch_id و section: صندوق فرقة العنصر يوم الدفع، فترفيعه بعدها
-- لا ينقل مالًا دخل صندوقًا. حذف العنصر يُبقي الدفعة في الصندوق (member_id NULL): المال
-- دخل فعلًا.
CREATE TABLE IF NOT EXISTS member_dues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  month TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  paid_on TEXT NOT NULL,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  section TEXT NOT NULL DEFAULT 'M',
  recorded_by TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الاجتماعات: محضر كل اجتماع — موضوعه و سببه، من حضر و من غاب، ما دار في كل بند من
-- جدول الأعمال، و ما تقرّر و من ينفّذه و متى. مستقلّ عن الأنشطة: لا عناصر فيه و لا
-- يدخل أي معدّل حضور. kind بلا CHECK كأنواع المخيمات — التحقّق في الخادم.
-- بأسماء الجمعية: leaders مجلس قيادة الفوج، branch اجتماع الفرقة، amana جلسة أمانة، prep
-- جلسة تحضيرية، review جلسة تقييمية، parents لقاء الأهل، other غير ذلك.
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'leaders',
  -- الموضوع، ثم سبب الاجتماع إن احتاج إلى شرح
  title TEXT NOT NULL,
  purpose TEXT,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  place TEXT,
  -- اجتماع فرقة بعينها؛ NULL = اجتماع الفوج. حذف الفرقة يُبقي المحضر للفوج
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  -- قسم الاجتماع: قسم فرقته، أو القسم الذي عُقد فيه. ثابت بعد الإنشاء: حضوره منه
  section TEXT NOT NULL DEFAULT 'M',
  -- رئيس الاجتماع و أمين السر (من كتب المحضر): قائد من القسم، أو اسم من خارجه. الاسم
  -- يُحفظ مع القائد أيضًا، فيبقى المحضر مقروءًا إن حُذف القائد
  chair_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  chair_name TEXT,
  secretary_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  secretary_name TEXT,
  notes TEXT,
  -- موعد الاجتماع المقبل، إن حُدِّد
  next_date TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الحضور: قائد من القسم (حاضر، غائب، غائب بعذر)، أو ضيف من خارج الفوج (ولي أمر، مفوّض
-- من الجمعية) باسمه — الضيف حاضر دائمًا. لا صف لقائد = لم يُدعَ. name نسخة الاسم: حذف
-- القائد يُبقي اسمه في المحضر.
CREATE TABLE IF NOT EXISTS meeting_attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  guest INTEGER NOT NULL DEFAULT 0,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'excused')),
  CHECK (guest = 0 OR (leader_id IS NULL AND status = 'present')),
  UNIQUE(meeting_id, leader_id)
);

-- جدول الأعمال: البنود بترتيبها، و ما دار في كل بند من نقاش
CREATE TABLE IF NOT EXISTS meeting_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  discussion TEXT
);

-- القرارات: ما تقرّر، و المسؤول عن تنفيذه (قائد، أو جهة باسمها: أمانة، الأهل…)، و المهلة.
-- status: open قيد التنفيذ، done نُفِّذ، dropped أُلغي. owner نسخة اسم القائد كالحضور.
CREATE TABLE IF NOT EXISTS meeting_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  owner TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
  status_at TEXT,
  status_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- تقييم الأنشطة ----------
-- استمارات التقييم: يختارها المسؤول من النماذج الجاهزة (server/evalPresets.js، من منتدى
-- مهدي الكشفي) أو يبنيها بنفسه. الاسم بالعربية و الفرنسية — القسم الفرنكوفوني يقرؤها
-- بلغته — و يكفي أحدهما. preset: النموذج الذي نُسخت منه، NULL = مبنيّة يدويًا.
-- archived: حُذفت بعد أن قُيِّم بها نشاط — تختفي من الإعدادات، و تبقى نتائج تلك الأنشطة.
CREATE TABLE IF NOT EXISTS eval_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT,
  name_fr TEXT,
  preset TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- بنود الاستمارة بترتيبها: axis عنوان محور يجمع ما تحته، score مؤشر علامته من 1 إلى 5،
-- text سؤال مفتوح. البند الذي أُجيب عنه لا يُحذف: يُؤرشف، فيغيب عن التقييمات المقبلة و يبقى
-- في نتائج ما سبقها.
CREATE TABLE IF NOT EXISTS eval_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES eval_forms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('axis', 'score', 'text')),
  label_ar TEXT,
  label_fr TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);

-- الاستمارة المعتمدة لكل نوع من الأنشطة (activity، leaders، group، visit): استمارة واحدة
-- للنوع. لا صف = نوع لا يُقيَّم.
CREATE TABLE IF NOT EXISTS eval_kind_forms (
  kind TEXT PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES eval_forms(id) ON DELETE CASCADE
);

-- تقييم قائد شارك في النشاط: واحد لكل قائد في كل نشاط، يعدّله متى شاء. كل تقييمات النشاط
-- بالاستمارة نفسها (form_id)، و لو تغيّرت استمارة نوعه بعد أوّلها. average معدّل علاماته،
-- محفوظًا لتقرأه القوائم بلا حساب. leader_name نسخة الاسم: حذف القائد يُبقي تقييمه.
-- المسؤول يقيّم أيّ نشاط: بقائده إن رُبط حسابه بقائد، و إلّا بحسابه (leader_id NULL، و
-- user_id حسابه — واحد لكل حساب في كل نشاط). user_id: الحساب الذي كتب التقييم.
CREATE TABLE IF NOT EXISTS session_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  form_id INTEGER REFERENCES eval_forms(id) ON DELETE SET NULL,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  leader_name TEXT NOT NULL,
  average REAL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, leader_id)
);

-- الإجابات: علامة من 1 إلى 5 لمؤشر، أو نصّ لسؤال مفتوح
CREATE TABLE IF NOT EXISTS session_evaluation_answers (
  evaluation_id INTEGER NOT NULL REFERENCES session_evaluations(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES eval_items(id) ON DELETE CASCADE,
  score INTEGER CHECK (score BETWEEN 1 AND 5),
  text TEXT,
  PRIMARY KEY (evaluation_id, item_id)
);

-- ---------- الإشعارات (server/push.js) ----------
-- صندوق إشعارات كل حساب: الجرس في الواجهة، و منه يخرج الإشعار إلى أجهزته (Web Push).
-- text: الإشعار مكتوبًا باللغتين عند إرساله، {"ar": {title, body}, "fr": {…}} — الجهاز يتلقّى
-- لغته و الجرس يعرض لغة القارئ. url: الصفحة التي يفتحها النقر. read_at NULL = لم يُقرأ.
CREATE TABLE IF NOT EXISTS user_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id, id);

-- جهاز قَبِل الإشعارات لحساب: عنوان خدمة الدفع (Google، Mozilla، Apple)، مفتاحا تشفير
-- الرسائل، و المفتاح العام VAPID الذي اشترك به. رسالة موقّعة بمفتاح آخر ترفضها الخدمة،
-- فلا يُرسَل إلا إلى اشتراكات المفتاح الحالي: نسخة من قاعدة الـVPS على حاسوب لا تصل إلى
-- هواتف القادة. الجهاز الواحد قد يخدم حسابين (أخوان على هاتف واحد)، فالفرادة للزوج.
-- lang: لغة الواجهة على ذلك الجهاز، و بها يُكتب إشعاره.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  vapid_key TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar', 'fr')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sent_at TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  UNIQUE(endpoint, user_id)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- ما اختاره كل حساب من أنواع الإشعارات: صفٌّ لنوعٍ غيّره عن قيمته الافتراضية وحده، فنوعٌ
-- يُضاف لاحقًا يصل بقيمته الافتراضية إلى من لم يختر شيئًا.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (user_id, type)
);

-- التذكيرات تخرج مرّة واحدة: مفتاحٌ لكل تذكير ('attendance:<session_id>')
CREATE TABLE IF NOT EXISTS notification_reminders (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Default مطالب (requirements) totals per branch, from the scout program reference
const REQUIREMENT_DEFAULTS = { 'البراعم': 99, 'الأشبال': 144, 'الكشافة': 166, 'الجوالة': 174 };

// ---------- نموذج التشكيلة ----------
// The standard توصيفات of a فوج. Opening a new تشكيلة year creates every one of them as an
// empty slot, so the whole organigram is visible from the start. Rows stay editable afterwards:
// titles can be renamed, extra مساعدين added, and unused ones deleted.
const AMANAT_TEMPLATE = [
  'عميد الفوج',
  'نائب عميد الفوج',
  'أمين السر',
  'أمين المال',
  'أمين الأنشطة',
  'أمين التدريب',
  'أمين الإعلام',
  'أمين التجهيزات',
  // توصيفات فوجية لا علاقة لها بالفرق: يعملون مع الأمانة المعنية
  'إعلامي',
  'أنشطة',
  'تدريب',
  'تجهيزات',
];

// Applied to every فرقة, using its Arabic name: قائد الجوالة، مساعد قائد الجوالة.
// توصيفا الفرقة هما هذان لا غير — قالب الأساسي/المتقدم/الأول القديم كان نقلًا عن
// نموذج لا يعمل به الفوج، و migrateBranchRoles يصحّح ما وُلّد منه.
const BRANCH_ROLES_TEMPLATE = [
  (b) => `قائد ${b}`,
  (b) => `مساعد قائد ${b}`,
];

// فرق قسم الفتيات تقودها قائدات: التوصيفان نفسهما بصيغة المؤنث
const BRANCH_ROLES_TEMPLATE_F = [
  (b) => `قائدة ${b}`,
  (b) => `مساعدة قائدة ${b}`,
];

// قسمٌ لغته الفرنسية (الفرنكوفون) يقرأ تشكيلته بالفرنسية، باسم الفرقة الفرنسي: Chef Baraem
const BRANCH_ROLES_TEMPLATE_FR = [
  (b) => `Chef ${b}`,
  (b) => `Chef adjoint ${b}`,
];
const BRANCH_ROLES_TEMPLATE_FR_F = [
  (b) => `Cheffe ${b}`,
  (b) => `Cheffe adjointe ${b}`,
];

// توصيفا فرقةٍ من هذا القسم: لغتهما لغة القسم، و صيغتهما جنسه
function branchRoles(b) {
  const def = sectionDef(b.section);
  const feminine = def?.gender === 'F';
  if (def?.lang === 'fr')
    return (feminine ? BRANCH_ROLES_TEMPLATE_FR_F : BRANCH_ROLES_TEMPLATE_FR).map((make) => make(b.name_fr));
  return (feminine ? BRANCH_ROLES_TEMPLATE_F : BRANCH_ROLES_TEMPLATE).map((make) => make(b.name_ar));
}

// [{ title, branch_id, role_type, sort_order, section }] — الأمانات first, then فرقة by فرقة in age order.
// Branch slots start at 100 so أمانات always sort ahead of them and a whole فرقة keeps its block.
// The أمانات template is the فوج's own, i.e. قسم الفتيان: the other أقسام build their أمانات by hand.
// `section` keeps one قسم only; the sort orders stay those of the full template either way.
function tachkilaTemplate(section = null) {
  const rows = (!section || section === 'M' ? AMANAT_TEMPLATE : []).map((title, i) => ({
    title,
    branch_id: null,
    role_type: 'amana',
    sort_order: i,
    section: 'M',
  }));
  const branches = db.prepare('SELECT id, name_ar, name_fr, section FROM branches ORDER BY sort_order, id').all();
  branches.forEach((b, bi) => {
    if (section && b.section !== section) return;
    branchRoles(b).forEach((title, ri) => {
      rows.push({
        title,
        branch_id: b.id,
        role_type: 'branch',
        sort_order: 100 + bi * 10 + ri,
        section: b.section,
      });
    });
  });
  return rows;
}

// Addresses and schools were free text before the curated lists existed. Their distinct
// values become the first version of each list, so nothing typed so far is lost when the
// fields turn into pickers.
function seedLookupsFromMembers() {
  if (!lookupsTableIsNew) return;
  const insert = db.prepare('INSERT OR IGNORE INTO lookup_values (kind, label) VALUES (?, ?)');
  const seed = (kind, col) => {
    const rows = db
      .prepare(
        `SELECT DISTINCT TRIM(${col}) AS v FROM members
          WHERE ${col} IS NOT NULL AND TRIM(${col}) != '' ORDER BY v`
      )
      .all();
    for (const r of rows) insert.run(kind, r.v);
  };
  db.transaction(() => {
    seed('residence_abidjan', 'address_abidjan');
    seed('residence_lebanon', 'address_lebanon');
    seed('school', 'school');
  })();
}

// The evaluation feature opens with one form ready: «مؤشرات نجاح النشاط», for the فرق's,
// the قادة's and the فوج's أنشطة. Copied once, on the boot that creates the tables.
function seedEvalForms() {
  if (!evalTablesAreNew) return;
  evalTablesAreNew = false;
  const { EVAL_PRESETS, DEFAULT_EVAL_PRESET, DEFAULT_EVAL_KINDS } = require('./evalPresets');
  const preset = EVAL_PRESETS.find((p) => p.key === DEFAULT_EVAL_PRESET);
  db.transaction(() => {
    const formId = db
      .prepare("INSERT INTO eval_forms (name_ar, name_fr, preset, created_by) VALUES (?, ?, ?, 'seed')")
      .run(preset.name_ar, preset.name_fr, preset.key).lastInsertRowid;
    const insertItem = db.prepare(
      'INSERT INTO eval_items (form_id, position, type, label_ar, label_fr) VALUES (?, ?, ?, ?, ?)'
    );
    preset.items.forEach((it, i) => insertItem.run(formId, i, it.type, it.label_ar, it.label_fr));
    const map = db.prepare('INSERT OR IGNORE INTO eval_kind_forms (kind, form_id) VALUES (?, ?)');
    for (const kind of DEFAULT_EVAL_KINDS) map.run(kind, formId);
  })();
}

function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// Empty توصيف slots need a nullable leader_id, and deleting a قائد must free his slot instead of
// destroying it. SQLite cannot relax NOT NULL or change a foreign key in place: rebuild the table.
function migrateAssignments() {
  ensureColumn('assignments', 'sort_order', 'sort_order INTEGER NOT NULL DEFAULT 0');
  const leaderCol = db.prepare('PRAGMA table_info(assignments)').all().find((c) => c.name === 'leader_id');
  if (!leaderCol || leaderCol.notnull === 0) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE assignments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year TEXT NOT NULL,
        leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
        role_type TEXT NOT NULL DEFAULT 'amana' CHECK (role_type IN ('branch', 'amana')),
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO assignments_new (id, year, leader_id, title, branch_id, role_type, sort_order)
        SELECT id, year, leader_id, title, branch_id, role_type, sort_order FROM assignments;
      DROP TABLE assignments;
      ALTER TABLE assignments_new RENAME TO assignments;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// Two things SQLite cannot change in place, both needing a full rebuild:
//   - branch_id must be nullable (a نشاط قادة / نشاط عام belongs to no فرقة)
//   - the kind CHECK must accept 'group' (نشاط عام للفوج)
// Called after the new columns are added, so every row keeps all its data.
function migrateSessions() {
  const cols = db.prepare('PRAGMA table_info(sessions)').all();
  const branchCol = cols.find((c) => c.name === 'branch_id');
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()?.sql || '';
  if (branchCol && branchCol.notnull === 0 && ddl.includes("'group'")) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE sessions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        branch_id INTEGER REFERENCES branches(id),
        leader TEXT,
        leader_id INTEGER,
        fee REAL,
        matalib TEXT NOT NULL DEFAULT '[]',
        start_time TEXT,
        place TEXT,
        activity_type TEXT,
        leaders_count INTEGER,
        kind TEXT NOT NULL DEFAULT 'activity' CHECK (kind IN ('activity', 'visit', 'leaders', 'group'))
      );
      INSERT INTO sessions_new
        (id, title, date, branch_id, leader, leader_id, fee, matalib, start_time, place, activity_type, leaders_count, kind)
        SELECT id, title, date, branch_id, leader, leader_id, fee, matalib, start_time, place, activity_type, leaders_count, kind
        FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// Attendance doubles as the immutable session roster. Older databases only allowed
// three final states and did not remember the member's branch/group at the session.
// Rebuild once so future sessions can start as genuinely unmarked.
function migrateAttendanceRoster() {
  const cols = db.prepare('PRAGMA table_info(attendance)').all().map((c) => c.name);
  const ddl =
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'attendance'").get()?.sql || '';
  if (cols.includes('branch_id') && cols.includes('group_id') && ddl.includes("'unmarked'")) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE attendance_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'unmarked'
          CHECK (status IN ('unmarked', 'present', 'absent', 'excused')),
        branch_id INTEGER REFERENCES branches(id),
        group_id INTEGER,
        UNIQUE(session_id, member_id)
      );
      INSERT INTO attendance_new (id, session_id, member_id, status, branch_id, group_id)
        SELECT a.id, a.session_id, a.member_id, a.status, m.branch_id, m.group_id
        FROM attendance a JOIN members m ON m.id = a.member_id;
      DROP TABLE attendance;
      ALTER TABLE attendance_new RENAME TO attendance;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// الخطة كانت بالشهر، صارت باليوم: كل سبت (أو أي يوم) صف مستقل. الصفوف القديمة تُنقل
// إلى أول يوم من شهرها — the month is the only thing that version ever knew.
function migrateAnnualPlan() {
  const cols = db.prepare('PRAGMA table_info(annual_plan)').all().map((c) => c.name);
  if (!cols.includes('month')) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE annual_plan_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year TEXT NOT NULL,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        title TEXT NOT NULL
      );
      INSERT INTO annual_plan_new (id, year, branch_id, date, title)
        SELECT id, year, branch_id,
          -- أيلول..كانون الأول تقع في السنة الأولى من السنة الكشفية، والباقي في الثانية
          (CASE WHEN month >= 9 THEN substr(year, 1, 4) ELSE substr(year, 6, 4) END)
            || '-' || substr('0' || month, -2) || '-01',
          title
        FROM annual_plan;
      DROP TABLE annual_plan;
      ALTER TABLE annual_plan_new RENAME TO annual_plan;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// تسجيل عنصر لا يطلب إلا الاسم و الشهرة: تاريخ الميلاد و تاريخ الانتساب كثيرًا ما
// يُجهلان يوم يُحضَر الولد أول مرة. SQLite cannot relax NOT NULL in place, so the table
// is rebuilt — from its own stored DDL, because ensureColumn appended columns over the
// years and their order differs from the CREATE above: nothing is listed, nothing is lost.
function migrateMemberOptionalDates() {
  const cols = db.prepare('PRAGMA table_info(members)').all();
  if (!cols.some((c) => (c.name === 'birth_date' || c.name === 'join_date') && c.notnull)) return;
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'members'").get().sql;
  const relaxed = ddl
    .replace(/\b(birth_date|join_date)(\s+TEXT)\s+NOT\s+NULL/gi, '$1$2')
    .replace(/^CREATE TABLE\s+("?)members\1\s*\(/i, 'CREATE TABLE members_new (');
  if (!relaxed.startsWith('CREATE TABLE members_new (')) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(relaxed);
    db.exec(`
      INSERT INTO members_new SELECT * FROM members;
      DROP TABLE members;
      ALTER TABLE members_new RENAME TO members;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// القالب القديم ولّد خمسة توصيفات لكل فرقة (أساسي، متقدم و مساعده، أول و مساعده)
// و الفوج لا يعرف إلا قائد الفرقة و مساعده. التصحيح: «الأساسي» يُعاد تسميته
// «قائد الفرقة» (هو رأسها، و يحتفظ بمن عُيّن فيه)، و الفارغ من البقية يُحذف،
// و «مساعد قائد الفرقة» يُستكمل حيث ينقص. صفٌّ قديم عُيّن فيه قائد لا يُمسّ:
// نقله قرار أدمن لا قرار كود. آمنة التكرار، فتُنفَّذ عند كل إقلاع.
function migrateBranchRoles() {
  const branches = db.prepare('SELECT id, name_ar, section FROM branches').all();
  const rename = db.prepare('UPDATE assignments SET title = ? WHERE branch_id = ? AND title = ?');
  const removeEmpty = db.prepare(
    'DELETE FROM assignments WHERE branch_id = ? AND title = ? AND leader_id IS NULL'
  );
  const years = db.prepare('SELECT DISTINCT year FROM assignments').all().map((r) => r.year);
  db.transaction(() => {
    for (const b of branches) {
      rename.run(`قائد ${b.name_ar}`, b.id, `قائد ${b.name_ar} الأساسي`);
      for (const t of [
        `قائد ${b.name_ar} المتقدم`,
        `مساعد قائد ${b.name_ar} المتقدم`,
        `قائد ${b.name_ar} الأول`,
        `مساعد قائد ${b.name_ar} الأول`,
      ])
        removeEmpty.run(b.id, t);
      for (const y of years) {
        // المساعد يُستكمل فقط في سنة للفرقة فيها صفوف أصلًا: سنةٌ بلا هذه الفرقة تبقى بلا
        const head = db
          .prepare('SELECT sort_order FROM assignments WHERE year = ? AND branch_id = ? AND title = ?')
          .get(y, b.id, `قائد ${b.name_ar}`);
        if (!head) continue;
        const helper = db
          .prepare('SELECT id FROM assignments WHERE year = ? AND branch_id = ? AND title = ?')
          .get(y, b.id, `مساعد قائد ${b.name_ar}`);
        if (!helper)
          db.prepare(
            "INSERT INTO assignments (year, leader_id, title, branch_id, role_type, sort_order, section) VALUES (?, NULL, ?, ?, 'branch', ?, ?)"
          ).run(y, `مساعد قائد ${b.name_ar}`, b.id, head.sort_order + 1, b.section);
      }
    }
  })();
}

// توصيفات المساعدة في القالب (إعلامي، أنشطة، تدريب، تجهيزات) وُلدت صفوفًا مستقلة
// قبل أن يوجد parent_id، و التعليق فوقها كان يقول أصلًا «يعملون مع الأمانة المعنية».
// تُربط بأمينها متى وُجد الاثنان في السنة نفسها. آمنة التكرار: صفٌّ رُبط لا يُربط ثانية،
// و رابطٌ فكّه الأدمن عمدًا لا يُعاد (الشرط parent_id IS NULL يمسّ غير المربوط فقط...
// فكُّ الربط يعيده NULL و قد يُعاد ربطه عند الإقلاع — مقبول: هذه صفوف القالب بعينها).
// One صندوق per قسم became one per قسم and per فرقة: the قسم's opening, keyed by its
// section, is now its فوج box's row. SQLite cannot change a primary key in place.
function migrateTreasuryOpenings() {
  const cols = db.prepare('PRAGMA table_info(treasury_openings)').all().map((c) => c.name);
  if (!cols.includes('branch_id')) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE treasury_openings_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          section TEXT NOT NULL,
          branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          amount REAL NOT NULL CHECK (amount >= 0),
          set_by TEXT,
          set_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO treasury_openings_new (section, branch_id, date, amount, set_by, set_at)
          SELECT section, NULL, date, amount, set_by, set_at FROM treasury_openings;
        DROP TABLE treasury_openings;
        ALTER TABLE treasury_openings_new RENAME TO treasury_openings;
      `);
    })();
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_treasury_openings_box ON treasury_openings(section, IFNULL(branch_id, 0))');
  db.exec('CREATE INDEX IF NOT EXISTS idx_treasury_transfers_section_date ON treasury_transfers(section, date)');
}

// An عنصر's month took one row, paid in full; it now takes one row per payment, so that
// 500 given one week and 1500 the next each enter the box on their own day. SQLite cannot
// drop a UNIQUE constraint in place: the table is rebuilt, its rows kept as they are.
function migrateMemberDues() {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'member_dues'").get();
  if (/UNIQUE\s*\(\s*member_id\s*,\s*month\s*\)/i.test(sql))
    db.transaction(() => {
      db.exec(`
        CREATE TABLE member_dues_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
          month TEXT NOT NULL,
          amount REAL NOT NULL CHECK (amount > 0),
          paid_on TEXT NOT NULL,
          session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
          branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
          section TEXT NOT NULL DEFAULT 'M',
          recorded_by TEXT,
          recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO member_dues_new SELECT id, member_id, month, amount, paid_on, session_id, branch_id, section,
          recorded_by, recorded_at FROM member_dues;
        DROP TABLE member_dues;
        ALTER TABLE member_dues_new RENAME TO member_dues;
      `);
    })();
  db.exec('CREATE INDEX IF NOT EXISTS idx_member_dues_member_month ON member_dues(member_id, month)');
}

function migrateAmanaHelpers() {
  const PAIRS = [
    ['إعلامي', 'أمين الإعلام'],
    ['أنشطة', 'أمين الأنشطة'],
    ['تدريب', 'أمين التدريب'],
    ['تجهيزات', 'أمين التجهيزات'],
  ];
  const years = db.prepare('SELECT DISTINCT year FROM assignments').all().map((r) => r.year);
  // داخل القسم الواحد: أمانة في قسم الفتيات لا تتبع أمينًا من قسم الفتيان بتشابه الاسم
  const find = db.prepare(
    "SELECT id, parent_id FROM assignments WHERE year = ? AND title = ? AND role_type = 'amana' AND section = ?"
  );
  db.transaction(() => {
    for (const y of years)
      for (const { code: section } of SECTION_DEFS)
        for (const [child, parent] of PAIRS) {
          const c = find.get(y, child, section);
          const a = find.get(y, parent, section);
          if (c && a && c.parent_id === null)
            db.prepare('UPDATE assignments SET parent_id = ? WHERE id = ?').run(a.id, c.id);
        }
  })();
}

// Every section column used to carry CHECK (section IN ('M', 'F')), which turns a third قسم
// away. SQLite cannot change a CHECK in place, so each table that has it is rebuilt from its
// own stored CREATE statement minus that clause — same columns in the same order, every
// other constraint kept — then gets its indexes and its AUTOINCREMENT counter back (ids of
// deleted rows are never handed out again). The values are checked by the server against
// SECTION_DEFS. Safe to run on every boot: a table without the clause is left alone.
const SECTION_CHECK = /\s*CHECK\s*\(\s*section\s+IN\s*\(\s*'M'\s*,\s*'F'\s*\)\s*\)/gi;

function dropSectionChecks() {
  const tables = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%section IN%'")
    .all()
    .filter((t) => new RegExp(SECTION_CHECK.source, 'i').test(t.sql));
  if (!tables.length) return;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const seqOf = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?');
      for (const { name, sql } of tables) {
        const indexes = db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL")
          .all(name)
          .map((r) => r.sql);
        const seq = seqOf.get(name)?.seq ?? null;
        const rebuilt = sql
          .replace(SECTION_CHECK, '')
          .replace(/^CREATE TABLE\s+("?)\w+\1\s*\(/i, `CREATE TABLE ${name}_new (`);
        if (!rebuilt.startsWith(`CREATE TABLE ${name}_new (`)) throw new Error(`cannot rebuild ${name}`);
        db.exec(rebuilt);
        db.exec(`INSERT INTO ${name}_new SELECT * FROM ${name}`);
        db.exec(`DROP TABLE ${name}`);
        db.exec(`ALTER TABLE ${name}_new RENAME TO ${name}`);
        for (const ix of indexes) db.exec(ix);
        if (seq !== null)
          db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(seq, name);
      }
      // Every reference into the rebuilt tables must still resolve, or nothing is kept
      if (db.pragma('foreign_key_check').length) throw new Error('foreign_key_check failed after dropping section CHECKs');
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// قسما الفرنكوفون (الفتيان ثم الفتيات) يولدان بسلّم الفوج: الفرق الأربع نفسها، بأعمارها و مطالبها، بأسماء فرنسية
// (و الاسم العربي يقول لمن هي). مرّة واحدة (user_version): فرقة حُذفت بعدها عمدًا تبقى
// محذوفة. فرقة «Francophone» القديمة (كل الأعمار) لا تُمسّ: خطّتها و قادتها في التشكيلة
// قرارٌ للأدمن، يُنقلان بيده.
const FR_LADDER = [
  { ar: 'البراعم', fr: 'Baraem' },
  { ar: 'الأشبال', fr: 'Achbal' },
  { ar: 'الكشافة', fr: 'Kachafa' },
  { ar: 'الجوالة', fr: 'Jawala' },
];

function seedFrancophoneSection() {
  const version = db.pragma('user_version', { simple: true });
  if (version >= 2) return;
  const twin = db.prepare("SELECT * FROM branches WHERE section = 'M' AND all_ages = 0 AND name_ar = ?");
  const seedLadder = (section, suffix) => {
    if (db.prepare('SELECT 1 FROM branches WHERE section = ? LIMIT 1').get(section)) return;
    const insert = db.prepare(
      `INSERT INTO branches (name_fr, name_ar, min_age, max_age, sort_order, total_requirements, all_ages, section)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    );
    for (const { ar, fr } of FR_LADDER) {
      const b = twin.get(ar);
      if (b) insert.run(fr, `${ar} (${suffix})`, b.min_age, b.max_age, b.sort_order, b.total_requirements, section);
    }
  };
  db.transaction(() => {
    // 1: الفرنكوفون (الفتيان)؛ 2: الفرنكوفونيات، بالسلّم نفسه
    if (version < 1) seedLadder('FR', 'فرنكوفون');
    seedLadder('FRF', 'فرنكوفونيات');
    db.pragma('user_version = 2');
  })();
}

// Upgrade databases created before the مطالب / activity-details feature
function migrate() {
  ensureColumn('branches', 'total_requirements', 'total_requirements INTEGER NOT NULL DEFAULT 0');
  ensureColumn('branches', 'all_ages', 'all_ages INTEGER NOT NULL DEFAULT 0');
  // قسم الفتيات جاء بعد الفوج كله: كل ما وُجد قبله من فرق و قادة و أنشطة و توصيفات
  // هو قسم الفتيان، فالقيمة الافتراضية 'M' هي الهجرة نفسها
  ensureColumn('branches', 'section', "section TEXT NOT NULL DEFAULT 'M'");
  // Idle-timeout bookkeeping. ALTER TABLE cannot take datetime('now') as a default,
  // so the column lands nullable and old rows inherit their creation time.
  ensureColumn('auth_tokens', 'last_seen_at', 'last_seen_at TEXT');
  db.exec("UPDATE auth_tokens SET last_seen_at = created_at WHERE last_seen_at IS NULL");
  // هاتف ولي الأمر split into father's and mother's numbers; the old single value
  // was the father's in practice, so it lands there
  ensureColumn('members', 'father_phone', 'father_phone TEXT');
  ensureColumn('members', 'mother_phone', 'mother_phone TEXT');
  if (db.prepare('PRAGMA table_info(members)').all().some((c) => c.name === 'parent_phone')) {
    db.exec(`
      UPDATE members SET father_phone = COALESCE(father_phone, parent_phone);
      ALTER TABLE members DROP COLUMN parent_phone;
    `);
  }
  ensureColumn('sessions', 'leader', 'leader TEXT');
  ensureColumn('sessions', 'fee', 'fee REAL');
  ensureColumn('sessions', 'matalib', "matalib TEXT NOT NULL DEFAULT '[]'");
  // زيارة الأهل shares the sessions table but must stay out of every attendance rate
  ensureColumn('sessions', 'kind', "kind TEXT NOT NULL DEFAULT 'activity'");
  // Plain INTEGER (no FK): leader deletion nulls it manually, keeping the name snapshot in `leader`
  ensureColumn('sessions', 'leader_id', 'leader_id INTEGER');
  // زمان، مكان، طبيعة النشاط — filled by the قائد next to the title
  ensureColumn('sessions', 'start_time', 'start_time TEXT');
  ensureColumn('sessions', 'place', 'place TEXT');
  ensureColumn('sessions', 'activity_type', 'activity_type TEXT');
  // نشاط عام للفوج: عدد حضور القادة
  ensureColumn('sessions', 'leaders_count', 'leaders_count INTEGER');
  migrateSessions();
  ensureColumn('sessions', 'attendance_finalized_at', 'attendance_finalized_at TEXT');
  ensureColumn('sessions', 'attendance_finalized_by', 'attendance_finalized_by TEXT');
  ensureColumn('sessions', 'updated_at', 'updated_at TEXT');
  db.exec("UPDATE sessions SET updated_at = datetime('now') WHERE updated_at IS NULL");
  // After migrateSessions on purpose: its rebuild only knows the older column set
  ensureColumn('sessions', 'section', "section TEXT NOT NULL DEFAULT 'M'");
  migrateAttendanceRoster();
  // الاشتراك المدفوع لكل عنصر في كل نشاط — بعد إعادة بناء الجدول أعلاه، فالبناء
  // ينسخ الأعمدة التي يعرفها وحدها و كان ليسقط هذا العمود لو زِيد قبله
  ensureColumn('attendance', 'paid', 'paid REAL');
  // Added after migrateSessions on purpose: its rebuild only knows the older column set
  ensureColumn(
    'sessions',
    'plan_item_id',
    'plan_item_id INTEGER REFERENCES annual_plan(id) ON DELETE SET NULL'
  );
  migrateAnnualPlan();
  // بند الخطة كما اعتُمد؛ NULL = أُضيف بعد الاعتماد (أو الخطة لم تُعتمد بعد)
  ensureColumn(
    'annual_plan',
    'baseline_id',
    'baseline_id INTEGER REFERENCES plan_baseline(id) ON DELETE SET NULL'
  );
  // الأنشطة القديمة كانت لفرقة واحدة و ببند خطة واحد: تُنسخ إلى الجدولين ليصيرا هما
  // المرجع لسؤالَي «أي فرق يخصّ؟» و «أي بنود ينفّذ؟». يُعاد التنفيذ بلا ضرر بفضل OR IGNORE.
  db.exec(`
    INSERT OR IGNORE INTO session_branches (session_id, branch_id)
      SELECT id, branch_id FROM sessions WHERE branch_id IS NOT NULL;
    INSERT OR IGNORE INTO session_plan_items (session_id, plan_item_id)
      SELECT id, plan_item_id FROM sessions WHERE plan_item_id IS NOT NULL;
  `);
  ensureColumn('promotions', 'matalib', "matalib TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('promotions', 'reversed_at', 'reversed_at TEXT');
  ensureColumn('promotions', 'reversed_by', 'reversed_by TEXT');
  ensureColumn('promotions', 'reversal_reason', 'reversal_reason TEXT');
  migrateAssignments();
  // Added after migrateAssignments on purpose: its rebuild only knows the older column set
  ensureColumn('assignments', 'group_id', 'group_id INTEGER REFERENCES branch_groups(id) ON DELETE SET NULL');
  ensureColumn('assignments', 'parent_id', 'parent_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL');
  // Before migrateAmanaHelpers, which pairs a أمانة with its أمين inside one قسم
  ensureColumn('assignments', 'section', "section TEXT NOT NULL DEFAULT 'M'");
  migrateAmanaHelpers();
  // Registration form fields added after the first release — all nullable so old rows stay valid
  ensureColumn('members', 'father_name', 'father_name TEXT');
  ensureColumn('members', 'mother_name', 'mother_name TEXT');
  ensureColumn('members', 'birth_place', 'birth_place TEXT');
  ensureColumn('members', 'address_abidjan', 'address_abidjan TEXT');
  ensureColumn('members', 'address_lebanon', 'address_lebanon TEXT');
  ensureColumn('members', 'member_phone', 'member_phone TEXT');
  // المدرسة: added for the school filter, nullable so old rows stay valid
  ensureColumn('members', 'school', 'school TEXT');
  // فصيلة الدم: optional like every field but the name, so nullable in SQL
  ensureColumn('members', 'blood_type', 'blood_type TEXT');
  // مجموعة العنصر داخل فرقته. NULL = لم يُوزَّع بعد، و هو حال كل العناصر قبل هذه
  // الميزة. الحذف يُفرَّغ يدويًا قبل DELETE: عمود مُضاف بـ ALTER لا يُعتمد عليه في
  // تنفيذ ON DELETE SET NULL.
  ensureColumn('members', 'group_id', 'group_id INTEGER REFERENCES branch_groups(id) ON DELETE SET NULL');
  // الفئة العمرية للطليعة — كل طليعة قائمة تبقى بلا سنّ، أي يدوية كما كانت
  ensureColumn('branch_groups', 'age_from', 'age_from INTEGER');
  ensureColumn('branch_groups', 'age_to', 'age_to INTEGER');
  ensureColumn('members', 'archived_at', 'archived_at TEXT');
  ensureColumn('members', 'archived_by', 'archived_by TEXT');
  // After every members column exists, before the members indexes are (re)created below
  migrateMemberOptionalDates();
  // ربط بطاقة التحضير بنشاطها — added after the table's first release
  ensureColumn(
    'prep_cards',
    'session_id',
    'session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL'
  );
  ensureColumn('prep_cards', 'updated_by', 'updated_by TEXT');
  seedLookupsFromMembers();
  // Old count-based column: counts cannot be mapped to specific numbers, drop it
  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (sessionCols.includes('requirements')) db.exec('ALTER TABLE sessions DROP COLUMN requirements');

  const setTotal = db.prepare(
    'UPDATE branches SET total_requirements = ? WHERE name_ar = ? AND total_requirements = 0'
  );
  for (const [ar, total] of Object.entries(REQUIREMENT_DEFAULTS)) setTotal.run(total, ar);

  // Sessions created before session_leaders: register the linked leader as main animator
  db.exec(`
    INSERT OR IGNORE INTO session_leaders (session_id, leader_id, role)
    SELECT s.id, s.leader_id, 'main' FROM sessions s
    WHERE s.leader_id IS NOT NULL AND EXISTS (SELECT 1 FROM leaders l WHERE l.id = s.leader_id)
  `);

  // استمارة القائد وُسّعت بعد الإصدار الأول — كلها اختيارية، فالملفّات القائمة تبقى صالحة
  for (const [col, ddl] of [
    ['father_name', 'father_name TEXT'],
    ['birth_date', 'birth_date TEXT'],
    ['address_abidjan', 'address_abidjan TEXT'],
    ['address_lebanon', 'address_lebanon TEXT'],
    ['marital_status', 'marital_status TEXT'],
    ['join_year', 'join_year TEXT'],
    ['years_ghadir', 'years_ghadir INTEGER'],
    ['years_total', 'years_total INTEGER'],
    ['education', 'education TEXT'],
    ['training_level', "training_level TEXT NOT NULL DEFAULT '[]'"],
  ])
    ensureColumn('leaders', col, ddl);
  ensureColumn('leaders', 'archived_at', 'archived_at TEXT');
  ensureColumn('leaders', 'archived_by', 'archived_by TEXT');
  ensureColumn('leaders', 'section', "section TEXT NOT NULL DEFAULT 'M'");

  ensureColumn('users', 'perms', 'perms TEXT');
  ensureColumn('users', 'leader_id', 'leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL');
  ensureColumn('users', 'active', 'active INTEGER NOT NULL DEFAULT 1');
  ensureColumn('users', 'must_change_password', 'must_change_password INTEGER NOT NULL DEFAULT 0');
  // The accounts that exist when the قسم arrives are قادة of the فوج as it was, i.e. of
  // قسم الفتيان. Left NULL (both sections) they would see the first قائدات and their
  // أنشطة — so they are pinned to it, once, on the boot that adds the column.
  const usersHadSection = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'section');
  ensureColumn('users', 'section', "section TEXT");
  if (!usersHadSection) db.exec("UPDATE users SET section = 'M' WHERE role != 'admin'");
  // A الصندوق line written before «not paid yet» existed left the box the day it was written
  const entriesHadPaidOn = db
    .prepare('PRAGMA table_info(treasury_entries)')
    .all()
    .some((c) => c.name === 'paid_on');
  ensureColumn('treasury_entries', 'paid_on', 'paid_on TEXT');
  ensureColumn('treasury_entries', 'owed_to', 'owed_to TEXT');
  if (!entriesHadPaidOn) db.exec('UPDATE treasury_entries SET paid_on = date');
  // Expenses per فرقة: a نشاط's expenses written before that belong to its فرقة
  const entriesHadBranch = db
    .prepare('PRAGMA table_info(treasury_entries)')
    .all()
    .some((c) => c.name === 'branch_id');
  ensureColumn('treasury_entries', 'branch_id', 'branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL');
  if (!entriesHadBranch)
    db.exec(
      'UPDATE treasury_entries SET branch_id = (SELECT s.branch_id FROM sessions s WHERE s.id = treasury_entries.session_id) WHERE session_id IS NOT NULL'
    );
  migrateTreasuryOpenings();
  migrateMemberDues();
  // First run: an admin must exist or nobody can log in. Default credentials
  // admin / admin123 — change them from the admin page right away.
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, branches, must_change_password) VALUES ('admin', ?, 'Admin', 'admin', NULL, 1)"
    ).run(`${salt}:${hash}`);
    console.log('Created default admin account: admin / admin123 — change the password!');
  }

  const hasBranches = db.prepare('SELECT COUNT(*) AS n FROM branches').get().n > 0;
  const hasBaraem = db.prepare('SELECT id FROM branches WHERE name_ar = ?').get('البراعم');
  if (hasBranches && !hasBaraem) {
    db.prepare(
      'INSERT INTO branches (name_fr, name_ar, min_age, max_age, sort_order, total_requirements) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('Baraem', 'البراعم', 6, 7, 0, 99);
  }

  // Existing compositions become explicit years. Promotion history is mirrored into
  // the generic movement log without changing the original rows.
  db.exec(`
    INSERT OR IGNORE INTO tachkila_years (year)
      SELECT DISTINCT year FROM assignments WHERE year IS NOT NULL AND TRIM(year) != '';
    INSERT INTO member_branch_history
      (member_id, old_branch_id, new_branch_id, effective_date, reason, source_promotion_id)
      SELECT p.member_id, p.old_branch_id, p.new_branch_id, p.promoted_at, 'promotion', p.id
      FROM promotions p
      WHERE p.reversed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM member_branch_history h WHERE h.source_promotion_id = p.id);

    CREATE INDEX IF NOT EXISTS idx_members_branch_status_name
      ON members(branch_id, status, last_name, first_name);
    CREATE INDEX IF NOT EXISTS idx_members_birth_date ON members(birth_date);
    CREATE INDEX IF NOT EXISTS idx_sessions_date_kind ON sessions(date, kind);
    CREATE INDEX IF NOT EXISTS idx_sessions_branch_date ON sessions(branch_id, date);
    CREATE INDEX IF NOT EXISTS idx_attendance_member_session ON attendance(member_id, session_id);
    -- مجموع اشتراكات العنصر يُقرأ في كل فتح لملفّه: صفوف الدفع وحدها
    CREATE INDEX IF NOT EXISTS idx_attendance_member_paid ON attendance(member_id) WHERE paid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_attendance_session_status ON attendance(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_attendance_branch_session ON attendance(branch_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_promotions_member_date ON promotions(member_id, promoted_at);
    CREATE INDEX IF NOT EXISTS idx_assignments_year_branch ON assignments(year, branch_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_leader_year ON assignments(leader_id, year);
    CREATE INDEX IF NOT EXISTS idx_prep_cards_branch_date ON prep_cards(branch_id, date);
    CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at, id);
    CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_date);
    CREATE INDEX IF NOT EXISTS idx_event_participants_event ON event_participants(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_sessions_event_date ON event_sessions(event_id, date);
    CREATE INDEX IF NOT EXISTS idx_event_attendance_participant ON event_attendance(participant_id);
    CREATE INDEX IF NOT EXISTS idx_event_expenses_event ON event_expenses(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_donations_event ON event_donations(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_staff_event ON event_staff(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_staff_leader ON event_staff(leader_id);
    CREATE INDEX IF NOT EXISTS idx_treasury_entries_section_paid ON treasury_entries(section, paid_on);
    CREATE INDEX IF NOT EXISTS idx_treasury_entries_session ON treasury_entries(session_id);
    CREATE INDEX IF NOT EXISTS idx_treasury_entries_branch ON treasury_entries(branch_id);
    CREATE INDEX IF NOT EXISTS idx_event_fundings_event ON event_fundings(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_fundings_box ON event_fundings(section, branch_id, date);
    CREATE INDEX IF NOT EXISTS idx_treasury_counts_box ON treasury_counts(section, branch_id, date);
    CREATE INDEX IF NOT EXISTS idx_member_dues_box ON member_dues(section, branch_id, paid_on);
    CREATE INDEX IF NOT EXISTS idx_member_dues_session ON member_dues(session_id);
    CREATE INDEX IF NOT EXISTS idx_meetings_section_date ON meetings(section, date);
    CREATE INDEX IF NOT EXISTS idx_meeting_attendees_meeting ON meeting_attendees(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_meeting_attendees_leader ON meeting_attendees(leader_id);
    CREATE INDEX IF NOT EXISTS idx_meeting_items_meeting ON meeting_items(meeting_id, position);
    CREATE INDEX IF NOT EXISTS idx_meeting_decisions_meeting ON meeting_decisions(meeting_id, position);
    CREATE INDEX IF NOT EXISTS idx_meeting_decisions_status ON meeting_decisions(status, due_date);
    CREATE INDEX IF NOT EXISTS idx_eval_items_form ON eval_items(form_id, position);
    CREATE INDEX IF NOT EXISTS idx_session_evaluations_session ON session_evaluations(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_evaluations_leader ON session_evaluations(leader_id);
    CREATE INDEX IF NOT EXISTS idx_session_evaluation_answers_item ON session_evaluation_answers(item_id);
  `);
  // L'admin évalue aussi, sans chef lié à son compte: une évaluation par compte et par séance
  ensureColumn('session_evaluations', 'user_id', 'user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_session_evaluations_user
       ON session_evaluations(session_id, user_id) WHERE leader_id IS NULL`
  );
  seedEvalForms();

  migrateBranchRoles();
  // Last: every table has its final columns by now, and the FR فرق need the CHECK gone
  dropSectionChecks();
  seedFrancophoneSection();
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM branches').get().n;
  if (count > 0) return;

  const insertBranch = db.prepare(
    'INSERT INTO branches (name_fr, name_ar, min_age, max_age, sort_order, total_requirements) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertBranch.run('Baraem', 'البراعم', 6, 7, 0, 99);
  insertBranch.run('Louveteaux', 'الأشبال', 8, 11, 1, 144);
  insertBranch.run('Scouts', 'الكشافة', 12, 16, 2, 166);
  insertBranch.run('Routiers', 'الجوالة', 17, null, 3, 174);
}

// The empty تشكيلة organigram for the current year. Every slot starts unassigned — the
// leaders themselves are entered by hand, so no names are seeded here.
function seedLeaders() {
  const year = '2025-2026';
  db.prepare('INSERT OR IGNORE INTO tachkila_years (year, created_by) VALUES (?, ?)').run(year, 'seed');
  const count = db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE year = ?').get(year).n;
  if (count > 0) return;

  const insertAssignment = db.prepare(
    'INSERT INTO assignments (year, leader_id, title, branch_id, role_type, sort_order, section) VALUES (?, NULL, ?, ?, ?, ?, ?)'
  );
  const run = db.transaction(() => {
    for (const r of tachkilaTemplate())
      insertAssignment.run(year, r.title, r.branch_id, r.role_type, r.sort_order, r.section);
  });
  run();
  // الصفوف وُلدت للتوّ مسطّحة: الربط بالأمين يجري الآن لا في الإقلاع القادم
  migrateAmanaHelpers();
}

module.exports = { db, seed, seedLeaders, migrate, migrateAmanaHelpers, tachkilaTemplate, SECTION_DEFS, sectionDef };
