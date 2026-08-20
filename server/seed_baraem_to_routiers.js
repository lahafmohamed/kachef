const { db } = require('./db');

function getRandomMatalib(total, count) {
  const set = new Set();
  while (set.size < count && set.size < total) {
    const num = Math.floor(Math.random() * total) + 1;
    set.add(num);
  }
  return [...set].sort((a, b) => a - b);
}

function seedBaraemToRoutiers() {
  const branches = db.prepare('SELECT * FROM branches ORDER BY sort_order').all();
  const baraem = branches.find((b) => b.sort_order === 0 || b.name_fr === 'Baraem');
  const louveteaux = branches.find((b) => b.sort_order === 1 || b.name_fr === 'Louveteaux');
  const scouts = branches.find((b) => b.sort_order === 2 || b.name_fr === 'Scouts');
  const routiers = branches.find((b) => b.sort_order === 3 || b.name_fr === 'Routiers');

  if (!baraem || !louveteaux || !scouts || !routiers) {
    console.error('Missing standard scout branches in database!');
    return;
  }

  const membersToInsert = [
    {
      first_name: 'Mehdi',
      last_name: 'Amari',
      birth_date: '2005-04-12',
      sex: 'M',
      father_phone: '+216 21 456 789',
      join_date: '2011-09-10',
      promotions: [
        { old: baraem, new: louveteaux, date: '2013-09-15', count: 85 },
        { old: louveteaux, new: scouts, date: '2017-09-20', count: 130 },
        { old: scouts, new: routiers, date: '2022-09-25', count: 155 },
      ],
    },
    {
      first_name: 'Sarrah',
      last_name: 'Ben Mahmoud',
      birth_date: '2006-02-18',
      sex: 'F',
      father_phone: '+216 98 123 456',
      join_date: '2012-10-01',
      promotions: [
        { old: baraem, new: louveteaux, date: '2014-09-10', count: 90 },
        { old: louveteaux, new: scouts, date: '2018-09-15', count: 138 },
        { old: scouts, new: routiers, date: '2023-09-20', count: 160 },
      ],
    },
    {
      first_name: 'Youssef',
      last_name: 'Triki',
      birth_date: '2005-11-05',
      sex: 'M',
      father_phone: '+216 50 789 012',
      join_date: '2011-10-15',
      promotions: [
        { old: baraem, new: louveteaux, date: '2013-10-01', count: 92 },
        { old: louveteaux, new: scouts, date: '2017-10-10', count: 125 },
        { old: scouts, new: routiers, date: '2022-10-15', count: 150 },
      ],
    },
    {
      first_name: 'Ines',
      last_name: 'Karray',
      birth_date: '2007-01-22',
      sex: 'F',
      father_phone: '+216 26 345 678',
      join_date: '2013-09-01',
      promotions: [
        { old: baraem, new: louveteaux, date: '2015-09-15', count: 88 },
        { old: louveteaux, new: scouts, date: '2019-09-20', count: 140 },
        { old: scouts, new: routiers, date: '2024-09-25', count: 158 },
      ],
    },
    {
      first_name: 'Bilel',
      last_name: 'Saidi',
      birth_date: '2006-08-30',
      sex: 'M',
      father_phone: '+216 97 654 321',
      join_date: '2012-09-15',
      promotions: [
        { old: baraem, new: louveteaux, date: '2014-09-20', count: 95 },
        { old: louveteaux, new: scouts, date: '2018-09-25', count: 142 },
        { old: scouts, new: routiers, date: '2023-09-30', count: 162 },
      ],
    },
    {
      first_name: 'Meriem',
      last_name: 'Jaziri',
      birth_date: '2007-06-14',
      sex: 'F',
      father_phone: '+216 22 890 123',
      join_date: '2013-10-10',
      promotions: [
        { old: baraem, new: louveteaux, date: '2015-10-05', count: 82 },
        { old: louveteaux, new: scouts, date: '2019-10-12', count: 132 },
        { old: scouts, new: routiers, date: '2024-10-15', count: 152 },
      ],
    },
    {
      first_name: 'Rayen',
      last_name: 'Elloumi',
      birth_date: '2008-02-10',
      sex: 'M',
      father_phone: '+216 53 112 233',
      join_date: '2014-09-01',
      promotions: [
        { old: baraem, new: louveteaux, date: '2016-09-10', count: 94 },
        { old: louveteaux, new: scouts, date: '2020-09-15', count: 136 },
        { old: scouts, new: routiers, date: '2025-09-20', count: 164 },
      ],
    },
  ];

  const insertMember = db.prepare(`
    INSERT INTO members (first_name, last_name, birth_date, sex, branch_id, father_phone, join_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `);

  const insertPromotion = db.prepare(`
    INSERT INTO promotions (member_id, old_branch_id, new_branch_id, promoted_at, matalib)
    VALUES (?, ?, ?, ?, ?)
  `);

  const checkMemberExists = db.prepare(`
    SELECT id FROM members WHERE first_name = ? AND last_name = ?
  `);

  const insertedMemberIds = [];

  const runTx = db.transaction(() => {
    for (const mData of membersToInsert) {
      let existing = checkMemberExists.get(mData.first_name, mData.last_name);
      let memberId;

      if (!existing) {
        const result = insertMember.run(
          mData.first_name,
          mData.last_name,
          mData.birth_date,
          mData.sex,
          routiers.id,
          mData.father_phone,
          mData.join_date
        );
        memberId = result.lastInsertRowid;
        console.log(`Created member: ${mData.first_name} ${mData.last_name} (ID: ${memberId})`);
      } else {
        memberId = existing.id;
        console.log(`Member ${mData.first_name} ${mData.last_name} already exists (ID: ${memberId})`);
      }

      insertedMemberIds.push(memberId);

      // Check existing promotions for this member
      const existingPromotionsCount = db
        .prepare('SELECT COUNT(*) as cnt FROM promotions WHERE member_id = ?')
        .get(memberId).cnt;

      if (existingPromotionsCount === 0) {
        for (const p of mData.promotions) {
          const matalibList = getRandomMatalib(p.old.total_requirements, p.count);
          insertPromotion.run(
            memberId,
            p.old.id,
            p.new.id,
            p.date,
            JSON.stringify(matalibList)
          );
        }
        console.log(`Added 3 promotions for ${mData.first_name} ${mData.last_name}`);
      }
    }
  });

  runTx();

  // Create some sessions for Routiers branch if none exist or to populate attendance
  const routiersSessions = db.prepare('SELECT id FROM sessions WHERE branch_id = ?').all(routiers.id);
  let sessionId;
  if (routiersSessions.length === 0) {
    const res = db.prepare(`
      INSERT INTO sessions (title, date, branch_id, leader, fee, matalib)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'نشاط إجتماعي للجوالة - خدمة المجتمع',
      '2026-07-20',
      routiers.id,
      'القائد أحمد',
      10,
      JSON.stringify([1, 2, 5, 8, 12, 15, 20])
    );
    sessionId = res.lastInsertRowid;
    console.log(`Created Routiers session ID: ${sessionId}`);
  } else {
    sessionId = routiersSessions[0].id;
  }

  // Record attendance for the created members in the Routiers session
  const upsertAttendance = db.prepare(`
    INSERT INTO attendance (session_id, member_id, status)
    VALUES (?, ?, 'present')
    ON CONFLICT(session_id, member_id) DO NOTHING
  `);

  db.transaction(() => {
    for (const mId of insertedMemberIds) {
      upsertAttendance.run(sessionId, mId);
    }
  })();

  console.log('Successfully seeded data for people who started from Baraem up to Routiers!');
}

if (require.main === module) {
  seedBaraemToRoutiers();
}

module.exports = { seedBaraemToRoutiers };
