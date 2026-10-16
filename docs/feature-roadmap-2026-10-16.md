# Feuille de route fonctionnelle — 16/10/2026

## Introduction et sources

Ce document regroupe le travail de **16 analystes**, un par page de l'application : shell/auth, tableau de bord, الفرق, العناصر, fiche عنصر, séances, fiche séance, بطاقات التحضير, camps/دورات, fiche camp, محاضر, trésorerie, ترفيع, القادة, réglages/admin et exports. Chaque analyste a lu le code de sa page (client + `server/index.js`, `server/db.js`, `server/push.js`) et a croisé ses propositions avec la documentation officielle de **Kachef al Mahdi** (montadamahdi.net : مراحل, مطالب القبول, مراتب, سجل التقدم, أوسمة, نظام الجماعات الصغيرة, gestion des réunions, rapports, sécurité en camp, دورات قادة الجماعات).

Méthode de consolidation :

1. **Fusion** : une même idée proposée sur plusieurs pages devient une seule feature transverse. Par exemple, « période d'essai » apparaissait sur 6 pages et « fiche santé » sur 4.
2. **Retrait** de ce qui est cosmétique ou existe déjà. La liste des retraits est donnée à la fin de la section des thèmes.
3. **Classement** par valeur de gestion et par effort. Les dépendances suivent l'ordre « modèle de données d'abord ».
4. **Lot 1** : les 10 features qui servent le plus le groupe dès maintenant.

Effort : **S** ≈ 1 jour, **M** ≈ 2–4 jours, **L** ≈ 1 semaine ou plus. Valeur : haute, moyenne ou basse, du point de vue de la gestion de l'unité.

Lexique : on suit la mémoire du projet. On écrit ترفيع, عنصر, مسؤولية, مطالب, الفرقة et الطليعة. Les termes سداسي et رهط n'apparaissent que comme libellés possibles, et un renommage n'est fait qu'avec l'accord du responsable.

Points vérifiés dans le code pendant la consolidation :
- `sessions.attendance_finalized_at/by` sont déclarées dans `db.js` (l.144 et l.1535) mais aucune route ne les écrit.
- `outstanding` est calculé par `GET /api/events` (index.js l.6459) mais n'est pas affiché dans `Events.jsx`.
- Il n'existe aucune table pour les مراتب, les أوسمة ou l'admission.

---

## Lot 1 — à construire maintenant

L'ordre suit les dépendances : d'abord fiabiliser la donnée de présence, ensuite les modèles de parcours, enfin les rapports.

| # | Feature | Pages touchées | Effort | Pourquoi maintenant | Base montadamahdi |
|---|---|---|---|---|---|
| 1 | **Clôture du pointage + file « À régulariser »** (A1) | séances, fiche séance, العناصر, fiche عنصر, tableau de bord | M | Aujourd'hui, une séance jamais pointée compte toute la فرقة absente. Taux, séries d'absences, مطالب et alertes sont donc faux. Toutes les autres features s'appuient sur la présence. | 4 réunions consécutives (مطالب القبول) ; signature du قائد dans le سجل التقدم |
| 2 | **Suivi des absences : alerte push + journal des contacts parents + motif d'absence** (A2) | fiche séance, العناصر, fiche عنصر, tableau de bord, notifications, réglages | M | Le seuil de 3 absences est calculé à 4 endroits, mais personne n'est prévenu et aucun appel n'est tracé. C'est la cause directe du décrochage. | Assiduité exigée par les مطالب القبول ; lien avec les familles (تنمية المجتمع) |
| 3 | **Admission : période d'essai, check-list des مطالب القبول, date du تكريس** (B1) | العناصر, fiche عنصر, الفرق, réglages, ترفيع, tableau de bord | M | Les nouveaux sont « actifs » dès leur saisie. Personne ne sait qui doit recevoir le فولار. Les rosters viennent d'être importés (≈ 250 éléments), donc il y a beaucoup d'admissions à suivre. | مطالب القبول par مرحلة (1 ou 2 mois, 4/5/7 بنود, 2/4 réunions, 3/5 صرخات) |
| 4 | **Catalogue des مطالب par فرقة (libellé + مجال + قبول/تقدم) et seuil de ترفيع** (B2) | réglages, fiche عنصر, الفرق, ترفيع, séances, بطاقات التحضير | M | Aujourd'hui « مطلب 37 » n'a pas de sens. C'est le socle des مراتب, de la couverture des مجالات et du contrôle « prêt au ترفيع ». | سجل التقدم, المجالات العشرة, 60 % / 70 % pour le ترفيع |
| 5 | **مسؤوليات datées des عناصر (عريف, مساعد, rôle libre) + alertes d'effectif des طلائع** (C1) | الفرق, العناصر, fiche عنصر, camps, محاضر, tableau de bord | M | Le عريف est le contact de la طليعة en camp et au مجلس, mais il n'est enregistré nulle part. Cette donnée est nécessaire aux مجالس, aux équipes de camp et aux دورات. | نظام الجماعات الصغيرة (5–8 éléments, قائد + مساعد) ; كتفية عريف أول/عريف/مساعد |
| 6 | **Camp prêt à partir : fiche santé, autorisation parentale, check-list sécurité** (E1) | fiche عنصر, camps, fiche camp, tableau de bord, notifications | M | Des camps partent avec des enfants alors que seul le groupe sanguin est stocké. Les informations santé du formulaire جوالة ont été perdues. C'est un risque réel. | Sécurité en camp : trousse définie avec un médecin, extincteur, خطة إخلاء, نقطة التجمع, infos médicales |
| 7 | **Dossier de camp exportable + relance des impayés** (E2) | camps, fiche camp, exports | M | C'est le seul gros module sans export. `outstanding` est déjà calculé mais n'est pas affiché. Il manque la liste d'appel par طليعة avec les téléphones des parents. | Règlement de camp (le عريف comme contact), التقرير الجيد |
| 8 | **Arriérés de cotisations par فرقة + tarifs configurables + exonérations** (G1) | trésorerie, العناصر, fiche عنصر, tableau de bord, réglages, exports | M | 2000 F/mois sans aucune vue « qui doit combien ». Le tarif est codé en dur et modifié rétroactivement, et les dettes disparaissent à l'archivage. | pratique |
| 9 | **Rapport périodique à la قيادة (mois/trimestre) avec en-tête normalisé** (I1) | tableau de bord, الفرق, séances, trésorerie, exports | M–L | Cinq pages proposaient chacune « leur » rapport mensuel. Un seul rapport agrégé suffit, avec la grille de présence en annexe. Il dépend des points 1 et 8. | التقرير الجيد : objet, émetteur, date, destinataire, signature ; « un rapport en retard perd son utilité » |
| 10 | **Synchroniser les accès des comptes avec la التشكيلة** (I4) | admin, القادة, notifications | S | `users.branches` est saisi à la main. Après un changement de تشكيلة, un قائد ne voit pas sa nouvelle فرقة et ne reçoit pas ses notifications. Petit effort, effet immédiat. | Hiérarchie فوج → فرقة |

**Ordre de construction conseillé :**

1. Points 1 et 10 : fiabilité de la donnée et des accès.
2. Point 4 (catalogue) et point 5 (مسؤوليات) : deux modèles de données.
3. Point 3 (admission, qui réutilise 1 et 4) et point 2 (suivi des absences, qui réutilise 1).
4. Point 6, puis 7 (le dossier de camp affiche les données santé de 6).
5. Point 8, puis 9 (le rapport agrège 1, 2 et 8).

---

## Thèmes et features

Légende des dépendances : « → dépend de ».

### Thème A — Assiduité et suivi des عناصر (4 features)

#### A1. Clôture du pointage + file « À régulariser » ★ Lot 1
- **Problème** : chaque séance `activity` est créée avec tous les عناصر « absent » (index.js ~4546). Une séance passée jamais pointée compte donc toute la فرقة absente dans `attendanceStats`, `consecutive_absences`, les مطالب acquis et les alertes. La séance du jour compte déjà comme absence avant tout pointage (`s.date <= today`). Le rappel `attendance_missing` ne vise que le jour J. Enfin, les colonnes `attendance_finalized_at/by` sont mortes : elles sont lues par PrintReport et l'export Excel, mais jamais écrites.
- **Proposition** :
  - Bouton « تثبيت الحضور / Valider la présence », qui enregistre qui a validé et quand, puis verrouille la saisie.
  - « Rouvrir » réservé à `sessions.edit` et tracé dans l'Historique.
  - Seules les séances validées comptent dans les statistiques. Une séance passée non validée est montrée comme « présence non confirmée ».
  - Onglet ou filtre « À régulariser » dans le journal : séances passées non validées, évaluation manquante, finances non saisies alors qu'un frais existe.
  - Rappel push à J+1 et J+3.
  - Bouton « Mettre à jour la liste » : ajoute les عناصر actifs arrivés après la création de la séance et signale ceux qui sont archivés ou transférés. Le roster est aujourd'hui figé.
- **Données** : écrire `attendance_finalized_at/by`, avec `POST /api/sessions/:id/finalize` et `/reopen`. Filtrer `attendanceRowsStmt` et `statsFromRows` sur les séances validées. Ajouter `POST /api/sessions/:id/roster/sync`. Ajouter deux clés de rappel dans `notification_reminders`.
- **Pages** : séances, fiche séance, العناصر, fiche عنصر, tableau de bord, notifications.
- **Effort** : M. **Valeur** : haute (préalable à tout le reste).

#### A2. Suivi des absences : alerte push, motif, journal des contacts parents ★ Lot 1
- **Problème** : la série de 3 absences (`FOLLOW_UP_STREAK`, en dur) n'apparaît que sur le tableau de bord et dans un filtre. Aucune notification ne part, le statut « excusé » n'a pas de motif, et rien ne garde la trace d'un appel aux parents. Plusieurs chefs appellent la même famille, ou personne ne l'appelle.
- **Proposition** :
  - Type push `absence_streak` envoyé aux قادة de la فرقة après la validation de la présence (A1). Une seule alerte par palier : 3, puis 6 avec escalade à l'admin. Seuil réglable.
  - Motif court sur chaque absent ou excusé : مرض، سفر، دراسة، عائلة، آخر.
  - « سجل المتابعة » sur la fiche عنصر : date, chef, canal (appel, WhatsApp, visite), motif, note, relance prévue. Les visites familiales (`sessions.kind='visit'`) apparaissent dans le même fil.
  - Les listes de suivi (tableau de bord, العناصر, nouvel onglet « متابعة » de la فرقة) affichent « contacté il y a X jours par Y ». La ligne passe en second plan tant que la relance n'est pas échue. Le motif « انقطاع » propose l'archivage.
  - Bouton WhatsApp avec un message pré-rempli (`waHref` existe déjà).
- **Données** : `attendance.reason`. Table `member_contacts(id, member_id, contacted_at, contacted_by, channel, reason, note, next_date)`. Table `app_settings(key, value)` pour le seuil. Type `absence_streak` dans `push.js`, avec la clé `absence:<member>:<n>`.
- **Pages** : fiche séance, العناصر, fiche عنصر, الفرق (onglet متابعة), tableau de bord, notifications, réglages.
- **Dépend de** : A1.
- **Effort** : M. **Valeur** : haute.

#### A3. Qualité des données : fiches incomplètes et éléments « hors cadre »
- **Problème** : `pendingPromotions` ignore en silence les عناصر sans date de naissance (`continue`), qui ne seront jamais proposés au ترفيع. Les éléments trop jeunes pour leur فرقة, ceux qui sont dans une طليعة d'âge qui ne correspond plus, ou ceux qui n'ont pas de téléphone parent ne sont signalés nulle part.
- **Proposition** : un seul calcul « À vérifier », affiché à trois endroits. Sur le tableau de bord, des compteurs : sans date de naissance, sans téléphone parent, sans طليعة, sans photo. Dans la fiche فرقة, l'onglet « متابعة ». Sur la page ترفيع, une carte « anomalies » avec un bouton « réaffecter selon l'âge » (`ageGroupIdFor`). Dans العناصر, le filtre `?check=age|group|promo`.
- **Données** : aucune table. Route `GET /api/members/anomalies` qui réutilise `memberMissingSQL`, `calcAge` et `branch_groups.age_from/to`.
- **Pages** : tableau de bord, العناصر, الفرق, ترفيع.
- **Effort** : S. **Valeur** : haute.

#### A4. Registre de présence mensuel (grille عناصر × séances) + feuille d'appel vierge
- **Problème** : il n'existe pas de registre classique pour archiver ou contrôler la présence, ni de feuille papier pour une séance sans téléphone.
- **Proposition** : kind d'export `attendance-grid` (فرقة, période, طليعة) avec ✓/✗/E, les taux, et les séries de 3 absences ou plus en rouge. Avec `?blank=1`, la grille sort vide pour les séances à venir.
- **Données** : aucune, `GET /api/branches/:id/sessions` suffit. Ajouter le kind à `PDF_KINDS` et à `excelReports`.
- **Pages** : exports, الفرق.
- **Dépend de** : A1, pour que la grille soit juste.
- **Effort** : S. **Valeur** : moyenne. Elle sert aussi d'annexe au rapport I1.

### Thème B — Parcours de l'عنصر : admission, سجل التقدم, مراتب, أوسمة, ترفيع (7 features)

#### B1. Admission : période d'essai, مطالب القبول, تكريس ★ Lot 1
- **Problème** : un nouvel élément est « actif » dès sa création. Personne ne suit le mois d'essai, le وعد, les بنود du قانون, les réunions consécutives ou les صرخات. Personne ne sait qui est prêt pour le حفل القبول/التكريس et la remise du فولار.
- **Proposition** :
  - Statut « في فترة التجربة » puis « مكرَّس » avec date.
  - Check-list de 6 items par élément : طلب الانتساب، التحية، الوعد، N بنود، N réunions consécutives، N صرخات. Chaque case garde qui l'a validée et quand.
  - Le critère « réunions consécutives » est calculé à partir de la présence validée (A1).
  - Badge « جاهز للتكريس » quand la durée d'essai et la check-list sont complètes.
  - Saisie groupée de la date du تكريس pour plusieurs éléments.
  - Un élément promu en interne (براعم→أشبال, il a déjà une ligne `promotions`) saute l'essai.
  - Listes « En essai (J+x) » et « Prêts pour le تكريس » sur le tableau de bord et sur la page ترفيع.
- **Données** :
  - Sur `branches` : `trial_months`, `law_items_required`, `consecutive_meetings_required`, `cries_required`, `internal_skip_trial`. Pré-remplir avec les valeurs montadamahdi.
  - Sur `members` : `admission_status`, `invested_at`.
  - Table `member_admission(member_id, item, done_at, done_by)`.
  - Routes `GET/POST /api/members/:id/admission`, `POST /api/members/investiture` (lot) et `GET /api/admissions/pending`.
- **Pages** : العناصر, fiche عنصر, الفرق, réglages, ترفيع, tableau de bord.
- **Dépend de** : A1.
- **Effort** : M. **Valeur** : haute.

#### B2. Catalogue des مطالب par فرقة, avec مجال et type, + seuil de ترفيع ★ Lot 1
- **Problème** : `member_matalib` ne contient que des numéros (1..`total_requirements`), alors que `leader_matalib` a déjà des libellés. Le chef coche des numéros sans savoir ce qu'ils désignent. Aucun suivi par مجال n'est possible. Le ترفيع se fait sur l'âge seul, même avec 0 % du سجل.
- **Proposition** :
  - Dans les réglages, pour chaque فرقة : numéro, libellé, مجال (liste fixe des 10), type (قبول / تقدم). Import par copier-coller depuis un tableau, et copie d'une فرقة vers son équivalent (filles ou FR).
  - Seuil de ترفيع (%) par فرقة : 60 pour les أشبال, 70 pour les كشافة et les جوالة.
  - La page ترفيع affiche « مطالب X/Y (Z %) » et sépare « prêts » de « âge atteint, seuil non atteint ». Un ترفيع sous le seuil reste possible, mais comme dérogation avec un motif.
  - La fiche عنصر affiche des libellés et un pourcentage par مجال.
- **Données** :
  - Table `branch_matalib(id, branch_id, number, label, majal, kind, sort_order, UNIQUE(branch_id, number))`.
  - `branches.promotion_threshold`.
  - `promotions.override`, `override_reason`.
  - `/promotions/pending` renvoie `earned_count`, `pct` et `ready`.
  - Les données existantes restent valides grâce au numéro.
- **Pages** : réglages, fiche عنصر, الفرق, ترفيع, séances, بطاقات التحضير.
- **Effort** : M. **Valeur** : haute.

#### B3. سجل التقدم numérique tracé
- **Problème** : `POST /members/:id/matalib` n'appelle pas `auditEvent`, et l'état « auto » supprime la ligne. On perd donc qui a accordé puis retiré un مطلب. Les مطالب remplis en camp sont validés plus tard, ou oubliés.
- **Proposition** :
  - Chaque مطلب coché garde le chef qui l'a validé, la date et la source : séance, camp ou manuel. La permission « valider مطالب » est réservée aux قادة.
  - Action « Valider des مطالب » en masse sur une séance du programme d'un camp, pour les présents.
  - Ajouter l'audit.
- **Données** : `member_matalib.validated_by`, `source`, `event_session_id`. Route `POST /events/:id/sessions/:sid/matalib`. Ajouter `auditEvent`.
- **Pages** : fiche عنصر, fiche camp, ترفيع.
- **Dépend de** : B2.
- **Effort** : M. **Valeur** : moyenne.

#### B4. مراتب à l'intérieur de la مرحلة
- **Problème** : seul le changement de فرقة (environ tous les 3 ans) existe. Le passage annuel de مرتبة (المبتدئ/الثاني/الأول ; الإعداد/التدريب/الخدمة العامة), qui rythme les cérémonies, n'existe pas.
- **Proposition** :
  - Pour chaque فرقة, une liste ordonnée de مراتب : durée minimale, % cumulé requis, nombre de أوسمة هوايات. Un bouton « charger le modèle montadamahdi » la remplit.
  - Sur la fiche, la مرتبة actuelle, une barre vers la suivante et une alerte « مرتبة متأخرة ».
  - Sur la page ترفيع, un onglet « مراتب » : éligibles, en retard, validation groupée avec historique.
- **Données** : `branch_ranks(id, branch_id, ordinal, name_ar, name_fr, min_months, pct_required, hobby_badges_required)` et `member_ranks(member_id, rank_id, granted_at, granted_by, reversed_at)`. Seed dans `db.js` (user_version 5).
- **Pages** : réglages, fiche عنصر, ترفيع, الفرق.
- **Dépend de** : B2.
- **Effort** : L. **Valeur** : haute (Lot 2).

#### B5. أوسمة : catalogue par مرحلة et circuit chef → عميد
- **Problème** : les أوسمة n'existent nulle part. On ne sait pas qui prépare quel وسام, et le circuit d'approbation se fait sur papier.
- **Proposition** :
  - Catalogue pré-rempli : 27 أوسمة هوايات pour les كشافة, 32 pour les أشبال/زهرات, en 4 groupes (الهداية، المواهب، الفتوة، الوطنية والاجتماعية), plus les أوسمة الكفايات. Il est modifiable.
  - Onglet « الأوسمة » sur la fiche : demande par le chef, approbation par le عميد via la file d'approbations I3, date de remise.
  - Filtre « وسام » dans العناصر, pour savoir qui le prépare et organiser les ateliers.
  - Les أوسمة approuvés alimentent le compteur des مراتب.
- **Données** : `badges(id, branch_id, group_key, name_ar, kind, needs_dean_approval, archived)` et `member_badges(member_id, badge_id, status, requested_by, approved_by, awarded_at, event_id)`.
- **Pages** : réglages, fiche عنصر, العناصر, ترفيع, notifications.
- **Dépend de** : I3 (approbations). B4 peut se faire en parallèle.
- **Effort** : L. **Valeur** : moyenne à haute (Lot 2).

#### B6. محفل : cérémonie de ترفيع, مراتب, أوسمة et تكريس
- **Problème** : le ترفيع est daté du jour du clic (`todayISO`). On ne peut pas antidater, ni rattacher le ترفيع à une cérémonie. Il n'y a ni liste de cérémonie ni شهادة à imprimer.
- **Proposition** :
  - « Date effective » libre lors d'une validation groupée.
  - Rattachement à un event de type « محفل », qui regroupe ترفيعات, مراتب, أوسمة et تكريس.
  - PDF « liste de passage + une شهادة par élément », signé par le قائد et le عميد. Les présents sont les participants de l'event.
- **Données** : `promotions.ceremony_event_id`, `effective_date` libre. Kind PDF `promotion-certificates`.
- **Pages** : ترفيع, camps, exports.
- **Dépend de** : E3 (catégorie d'event). Plus utile après B4 et B5.
- **Effort** : M. **Valeur** : moyenne.

#### B7. Notification « ترفيع à préparer » et vue de fin d'année
- **Problème** : aucune notification n'est liée au ترفيع. Les éligibilités apparaissent au fil des anniversaires, ce qui rend difficile la préparation du ترفيع groupé de la rentrée.
- **Proposition** : type push `promotion_due`, envoyé en résumé hebdomadaire aux قادة de la فرقة quittée. Sélecteur « âge calculé au » : aujourd'hui ou fin d'année scoute.
- **Données** : `?ref=YYYY-MM-DD` sur `/promotions/pending`. Table `promotion_notified`.
- **Pages** : ترفيع, notifications.
- **Effort** : S. **Valeur** : moyenne.

### Thème C — Petits groupes et encadrement des طلائع (4 features)

#### C1. مسؤوليات datées des عناصر + alertes d'effectif ★ Lot 1
- **Problème** : une طليعة n'a qu'un nom et une tranche d'âge. On ne sait pas qui est son عريف (رئيس السداسي chez les أشبال, رائد الرهط chez les جوالة) ni son adjoint. Les `assignments` ne concernent que les adultes. Une réaffectation écrase `members.group_id` sans laisser de trace. Aucune alerte ne signale une طليعة de 2 ou de 12 éléments.
- **Proposition** :
  - Sur chaque carte de طليعة, des sélecteurs عريف et مساعد avec une date de début. Rôles possibles : العريف الأول، عريف، مساعد, plus un rôle libre (مصوّر، منشد، خطاط…).
  - L'historique est conservé. Le serveur ferme automatiquement la ligne quand l'élément quitte la طليعة (affectation, by-age, ترفيع).
  - Un badge de rôle s'affiche dans العناصر et sur la fiche.
  - Alertes : طليعة sans عريف, effectif hors 5–8, فرقة au-delà de 33 (suggestion de dédoublement), actifs sans طليعة. Les seuils sont réglables par فرقة.
- **Données** : table `member_responsibilities(id, member_id, group_id, role, start_date, end_date, assigned_by)`. Colonnes `branches.group_min/group_max/unit_max` (5/8/33 par défaut). Comptage par `group_id` dans `/api/branches/overview`.
- **Pages** : الفرق, العناصر, fiche عنصر, tableau de bord. Les données sont reprises par camps et محاضر.
- **Effort** : M. **Valeur** : haute.

#### C2. مجلس الطليعة / مجلس الفرقة planifiés
- **Problème** : le module محاضر ne connaît pas les مجالس. Aucune réunion n'est rattachée à une طليعة, et rien ne rappelle le مجلس bimensuel.
- **Proposition** :
  - Types `majlis_group` (مجلس الطليعة, toutes les 14 jours par défaut) et `majlis_branch`.
  - Bouton « مجلس الطليعة » sur la carte de la طليعة, avec participants pré-remplis : عريف, مساعد et chef.
  - Alerte « pas tenu depuis N jours ».
  - Création en un clic de la réunion suivante à partir de `next_date`, qui reprend les تكاليف ouverts.
- **Données** : `meetings.group_id`, nouveaux kinds dans `MEETING_KINDS` (serveur et `lib/meetings.js`), `cadence_days`.
- **Pages** : محاضر, الفرق.
- **Dépend de** : C1.
- **Effort** : M. **Valeur** : moyenne.

#### C3. Inspection (التفتيش) et classement des طلائع, en séance et en camp
- **Problème** : l'émulation entre طلائع (tenue, propreté, ordre) se note sur papier. Il n'y a pas d'historique de المجلي الأول.
- **Proposition** : grille par طليعة avec 5 critères notés de 1 à 5. Le serveur désigne المجلي الأول et الثاني. Classement cumulé par trimestre, ou par jour au camp. Critères réglables. Une seule table sert aux séances et aux camps.
- **Données** : `inspections(context 'session'|'event', context_id, date, group_id|team_id, criterion, score, by)`. Route `/api/branches/:id/inspection-ranking`.
- **Pages** : fiche séance, fiche camp, الفرق.
- **Effort** : M. **Valeur** : moyenne (Lot 3).

#### C4. Compte-rendu du عريف par طليعة après l'activité
- **Problème** : le قائد الجماعة doit remettre un rapport après chaque activité, mais la séance n'a que l'évaluation des chefs.
- **Proposition** : un court compte-rendu par طليعة (réalisé, difficultés, besoins), saisi par le chef ou le عريف. Badge « 2/3 » dans le journal. Repris dans le rapport I1.
- **Données** : `session_group_reports(session_id, group_id, author, content, created_at)`.
- **Pages** : fiche séance, séances, exports.
- **Dépend de** : C1.
- **Effort** : S. **Valeur** : basse à moyenne.

### Thème D — Formation et vivier de cadres (4 features)

#### D1. Catégorie officielle des camps et دورات + résultat par participant
- **Problème** : les 4 types d'event ne disent pas quelle دورة a été suivie. Personne ne sait qui a fait la دورة عريف طليعة, رئيس سداسي ou رائد رهط avant qu'on lui confie une مسؤولية. Les camps عاشوراء, قيادي, etc. ne peuvent pas être filtrés.
- **Proposition** :
  - Champ `category` selon le type. Camp : كشفي، قيادي، تدريبي، ديني، فني، إعلامي، تنمية المجتمع، عاشوراء، محفل. Formation : عريف طليعة، رئيس سداسي، رائد رهط، قادة الجماعات، autre.
  - Filtre et badge dans la liste.
  - Colonne « résultat » (réussi, à reprendre, absent) pour les formations.
  - L'onglet camps du profil devient un historique de formations.
- **Données** : `events.category`, `event_participants.result`, `?category=`.
- **Pages** : camps, fiche camp, fiche عنصر, fiche قائد.
- **Effort** : S. **Valeur** : haute (Lot 2, en tête).

#### D2. Historique daté des دورات des قادة et contrôle de qualification dans la تشكيلة
- **Problème** : `training_level` est une liste de codes sans date ni preuve. Une دورة suivie dans /events ne le met jamais à jour. `TRAINING_COURSES` est dupliqué à trois endroits. N'importe quel قائد peut recevoir une مسؤولية sans la qualification requise.
- **Proposition** :
  - Onglet « الدورات » sur la fiche قائد : دورة, date, event, résultat, note, certificat.
  - Bouton « Valider la دورة pour les participants » à la clôture d'un event de type course.
  - Chaque مسؤولية du modèle de تشكيلة porte une دورة minimale. Badge « non qualifié » et compteur dans la تشكيلة.
  - Export « besoins de formation ».
- **Données** : `leader_trainings(id, leader_id, course_code, date, event_id, result, score, file, recorded_by)`, avec migration de `training_level`. `assignments.required_course`. Une constante unique partagée entre client et serveur.
- **Pages** : القادة, fiche قائد, camps.
- **Dépend de** : D1.
- **Effort** : M. **Valeur** : haute.

#### D3. Évaluation des دورات sur 50 points (plusieurs évaluateurs)
- **Problème** : l'onglet Évaluation ne recueille que l'avis des chefs sur le camp, pas la note de chaque stagiaire.
- **Proposition** : chaque formateur (staff `trainer`) note chaque participant sur la grille أداء تدريبي + سلوكي (50 points). La note finale est la moyenne des formateurs. Export PDF du relevé.
- **Données** : `event_results(event_id, participant_id, outcome, final_score)` et `event_result_scores(result_id, evaluator_leader_id, criterion, score)`.
- **Pages** : fiche camp, fiche عنصر, fiche قائد.
- **Dépend de** : D1.
- **Effort** : L. **Valeur** : moyenne.

#### D4. Vivier : passerelle جوالة → قائد
- **Problème** : les tables `members` et `leaders` ne sont pas liées. Un جوال qui devient قائد est ressaisi à la main et perd son historique. En fin de parcours, la seule action proposée est « archiver ».
- **Proposition** : liste « المرشحون » (جوالة de 16 ans et plus, avec présence, camps, مسؤوليات et دورات). Action « Promouvoir en قائد », qui crée la fiche pré-remplie et garde le lien `member_id`.
- **Données** : `leaders.member_id`. Route `POST /api/members/:id/to-leader`.
- **Pages** : ترفيع, القادة, fiche عنصر.
- **Dépend de** : C1 et D1 pour les indicateurs.
- **Effort** : M. **Valeur** : moyenne.

### Thème E — Camps et دورات : préparation et sécurité (6 features)

#### E1. Fiche santé, autorisation parentale, check-list sécurité ★ Lot 1
- **Problème** : seul `blood_type` existe. Il n'y a ni allergies, ni traitement, ni contact d'urgence, ni autorisation parentale, ni check-list sécurité. Le rappel `event_reminder` ne porte que sur la date.
- **Proposition** :
  - Section « الصحة » sur la fiche عنصر : allergies, traitement, contre-indications, sait nager, contact d'urgence. Lecture réservée à la permission `members.health`, au rôle `medic` du camp et aux chefs du camp.
  - Case « autorisation parentale reçue le… par… » par participant, avec un scan optionnel.
  - Check-list sécurité par camp : trousse, extincteur + seau de sable, plan d'évacuation, point de rassemblement, site vérifié, secouriste désigné. Chaque point a un responsable (parmi `event_staff`) et garde qui l'a coché et quand.
  - Badge « Prêt / 2 autorisations manquantes / sécurité 3/5 » sur /events et dans la carte « Prochains camps » du tableau de bord.
  - Rappel à J-3 qui liste ce qui manque.
- **Données** :
  - Sur `members` : `allergies`, `treatment`, `medical_notes`, `can_swim`, `emergency_name`, `emergency_phone`.
  - Sur `event_participants` : `consent_at`, `consent_by`.
  - Table `event_checklist(event_id, label, staff_id, done_at, done_by)`, avec un modèle par défaut dans `lookup_values`.
  - Permission `members.health`.
- **Pages** : fiche عنصر, camps, fiche camp, tableau de bord, notifications.
- **Effort** : M. **Valeur** : haute.

#### E2. Dossier de camp exportable + relance des impayés ★ Lot 1
- **Problème** : /events et EventDetail n'ont aucun export. `outstanding` est calculé (index.js l.6459) mais n'est jamais affiché.
- **Proposition** :
  - Kind `event` en PDF et Excel. La liste d'appel regroupe les participants par فرقة et طليعة, avec le عريف en tête, l'âge, les téléphones des parents, le groupe sanguin, les alertes santé et l'état du paiement. Le dossier contient aussi la هيئة قيادية, le programme, le bilan et la check-list à signer.
  - Variante « rapport de camp à la قيادة » avec l'en-tête normalisé (I1).
  - « Reste dû X F · N familles » sur /events et filtre « impayés ».
  - Liste des restes à payer avec téléphones.
- **Données** : ajouter `event` et `event-unpaid` à `PDF_KINDS`, à PrintReport et à `excelReports`. Ajouter `unpaid_count` au SELECT.
- **Pages** : camps, fiche camp, exports.
- **Dépend de** : E1, pour les colonnes santé.
- **Effort** : M. **Valeur** : haute.

#### E3. Fiche de planification et budget prévisionnel des camps (approbation de la قيادة)
- **Problème** : `events.plan` est un texte libre. Il n'y a ni budget prévu, ni frais suggérés, ni accord préalable.
- **Proposition** :
  - Objectif, participants prévus, budget par catégorie (mêmes catégories que les dépenses), activité de secours.
  - Écart entre prévu et réel par catégorie.
  - Frais suggérés = (budget − financements − dons attendus) / participants prévus.
  - Statut « approuvé par la قيادة » (permission `events.approve`, via la file I3).
- **Données** : `event_budget_lines(event_id, category, amount)`. Sur `events` : `objective`, `expected_participants`, `backup_activity`, `approved_by`, `approved_at`.
- **Pages** : camps, fiche camp, trésorerie.
- **Effort** : M. **Valeur** : moyenne.

#### E4. Historique des versements de camp
- **Problème** : `paid` est cumulatif et `PUT /participants/:pid` écrase `paid_at` et `recorded_by`. Le détail des acomptes est perdu.
- **Proposition** : une ligne par versement, comme dans `member_dues`. `paid` est recalculé à partir de ces lignes. L'historique s'affiche dans PaymentDialog, avec annulation possible.
- **Données** : `event_payments(participant_id, amount, date, recorded_by)`. Migration du `paid` existant en une ligne.
- **Pages** : fiche camp, trésorerie.
- **Effort** : M. **Valeur** : moyenne.

#### E5. Vie de camp : équipes, tableau de خدمة, inspection quotidienne
- **Problème** : on ne peut ni former des équipes ou tentes propres au camp, ni répartir les corvées, ni noter l'inspection du matin.
- **Proposition** :
  - Équipes de camp, avec alerte si l'effectif sort de 5–8. Un عريف et un مساعد par équipe.
  - Grille jour × équipe × tâche (cuisine, ترتيب، خدمة، رفع العلم).
  - Inspection quotidienne (C3). Affiche PDF.
- **Données** : `event_teams`, `event_team_members`, `event_duties`, et la table `inspections` (C3).
- **Pages** : fiche camp.
- **Dépend de** : C3.
- **Effort** : L. **Valeur** : moyenne (Lot 3).

#### E6. Filtres année/فرقة et rapport annuel des camps
- **Problème** : l'archive des camps grossit sans filtre ni pagination. On ne peut pas chercher par participant.
- **Proposition** : filtres année scoute et فرقة côté serveur, recherche par participant, ligne de totaux, export « rapport des camps ».
- **Données** : `?year=&branch_id=&member=`. Kind `events-report`.
- **Pages** : camps.
- **Effort** : S à M. **Valeur** : moyenne.

### Thème F — Planification et programme (5 features)

#### F1. بطاقة خطة النشاط structurée : prévu, puis réalisé
- **Problème** : la بطاقة تحضير est surtout du texte libre. Il manque les participants prévus, le budget, l'activité de secours et le matériel. On ne peut pas comparer avec ce qui a été réalisé.
- **Proposition** :
  - Champs structurés, dont le déroulé en فقرات : durée et قائد responsable pour chacune.
  - Bloc « Prévu / Réalisé » une fois la séance liée : présents, dépenses, مطالب, évaluation.
  - La charge d'animation de chaque قائد s'affiche sur sa fiche.
- **Données** : sur `prep_cards` : `expected_count`, `budget_planned`, `backup_activity`, `materials` (JSON). Table `prep_segments(card_id, sort_order, minutes, title, leader_id, majal)`.
- **Pages** : بطاقات التحضير, fiche séance, fiche قائد.
- **Effort** : M. **Valeur** : moyenne à haute.

#### F2. Circuit d'approbation des fiches (brouillon → soumise → approuvée / à revoir)
- **Problème** : la fiche n'a pas de statut. Le rédacteur n'a aucun retour, et la قيادة ne sait pas ce qu'elle a déjà relu.
- **Proposition** : bouton « Soumettre ». Un compte avec `prep.approve` approuve ou renvoie avec un commentaire, et une push part dans les deux sens. La fiche passe par la file d'approbations I3. `prep_missing` tient aussi compte d'une fiche non approuvée la veille.
- **Données** : sur `prep_cards` : `status`, `reviewed_by`, `reviewed_at`, `review_note`. Types push `prep_submitted` et `prep_reviewed`.
- **Pages** : بطاقات التحضير, notifications, admin.
- **Dépend de** : I3, conseillé.
- **Effort** : M. **Valeur** : moyenne à haute.

#### F3. Plan annuel → préparé → réalisé
- **Problème** : une fiche n'est rattachée au plan annuel que par la date. Aucun taux ne dit, par فرقة, quelle part du plan a été préparée à temps puis réalisée. L'alerte `prep_missing` se trompe si la fiche est datée la veille.
- **Proposition** : `plan_item_id` sur la fiche, et bouton « Préparer » dans l'onglet Plan. Rapport trimestriel par فرقة : items du plan, items préparés au moins 2 jours avant, items réalisés. L'alerte s'appuie sur ce lien plutôt que sur la date exacte.
- **Données** : `prep_cards.plan_item_id`. Route `GET /api/reports/prep-rate`.
- **Pages** : بطاقات التحضير, الفرق (Plan), fiche قائد, exports.
- **Effort** : M. **Valeur** : moyenne à haute.

#### F4. Couverture des المجالات العشرة
- **Problème** : on ne voit pas qu'une فرقة n'a travaillé ni الصحة ni البيئة depuis trois mois.
- **Proposition** : le مجال est déduit des مطالب du catalogue (B2), avec un tag manuel optionnel sur la séance ou la fiche. Vue trimestrielle « مجالات couverts / négligés » par فرقة, et filtre par مجال dans le journal.
- **Données** : `sessions.majalat` et `prep_cards.domains` (JSON) si on garde un tag manuel. Sinon, calcul via `branch_matalib.majal`.
- **Pages** : séances, fiche séance, بطاقات التحضير, الفرق.
- **Dépend de** : B2.
- **Effort** : S. **Valeur** : moyenne à haute.

#### F5. Réutilisation : dupliquer une séance ou une fiche, série hebdomadaire, modèles par occasion
- **Problème** : chaque samedi, le chef ressaisit la même فرقة, les mêmes طلائع, les mêmes chefs et le même lieu. Des séances oubliées ne sont donc jamais pointées. Les bonnes fiches (عاشوراء، رمضان، الغدير) ne servent pas de base pour la suite.
- **Proposition** :
  - « Dupliquer » une séance (date +7 jours) et option « répéter chaque semaine jusqu'au… ».
  - « Dupliquer » une fiche, case « Modèle » avec le tag occasion et la référence du دليل (semestre, n° d'activité).
  - « Partir d'un modèle » parmi les modèles de la même مرحلة.
  - Alerte de régularité : فرقة ou طليعة sans séance depuis 14 jours (réglable).
- **Données** : `repeat_until` dans `POST /api/sessions`. Sur `prep_cards` : `is_template`, `occasion`, `program_ref`. Route `GET /api/sessions/gaps`. Type push `branch_idle`.
- **Pages** : séances, بطاقات التحضير, tableau de bord.
- **Effort** : S. **Valeur** : moyenne.

### Thème G — Finances (6 features)

#### G1. Arriérés de cotisations par فرقة, tarifs configurables, exonérations ★ Lot 1
- **Problème** :
  - Les mois en retard ne se voient que fiche par fiche, et aucune route n'agrège `member_dues`.
  - `MEMBER_DUE_MONTHLY=2000` et `LEADER_DUE_MONTHLY=5000` sont codés en dur (index.js ~3509 et ~3367). Changer le tarif recalcule rétroactivement les mois passés.
  - Aucune exonération n'est possible (fratrie, cas social).
  - `memberLateMonths` renvoie `[]` pour un élément non actif : la dette disparaît à l'archivage.
- **Proposition** :
  - Un seul calcul d'arriérés, affiché à quatre endroits. Panneau « Cotisations en retard » dans /treasury, par فرقة : mois dus, montant, dernier paiement, téléphone parent. Entrée « À faire » sur le tableau de bord. Filtre et puce « x أشهر » dans العناصر. Export de relance PDF/Excel.
  - Tarifs par date d'effet dans les réglages.
  - Tarif personnel ou exonération avec motif sur la fiche.
  - Dettes des archivés gardées dans une section « soldées / abandonnées ».
- **Données** : table `due_rates(kind, amount, effective_month)`. Sur `members` : `dues_monthly`, `dues_note`. Route `GET /api/member-dues/arrears?branch=&year=`. Kind `dues-arrears`.
- **Pages** : trésorerie, العناصر, fiche عنصر, fiche séance, tableau de bord, réglages, exports.
- **Effort** : M. **Valeur** : haute.

#### G2. Rapport financier par période
- **Problème** : les chiffres de la caisse sont toujours cumulés depuis l'ouverture. Aucun bilan mensuel ou annuel n'est possible.
- **Proposition** : sélecteur de période (mois, trimestre, année scoute, dates libres) qui affiche le solde d'ouverture, les entrées par source, les sorties par catégorie, les transferts, les camps financés et le solde de clôture. Export avec l'en-tête normalisé. Il alimente la partie finances de I1.
- **Données** : `from`/`to` sur `GET /api/treasury`, avec `bookBalanceOn` pour le solde d'ouverture. Kind `treasury-period`.
- **Pages** : trésorerie, exports.
- **Effort** : M. **Valeur** : haute (Lot 2, en tête, ou à faire avec I1).

#### G3. Justificatifs de dépenses
- **Problème** : une dépense n'est qu'un texte et un montant. Rien ne permet de la contrôler ni de rembourser sur preuve.
- **Proposition** : photo ou PDF joint, prise avec la caméra du téléphone, sur les écritures de caisse et les dépenses de camp. Filtre « sans justificatif » et compteur.
- **Données** : `treasury_receipts(id, entry_id, event_expense_id, path, mime, uploaded_by, uploaded_at)`, avec le stockage d'uploads existant.
- **Pages** : trésorerie, fiche camp.
- **Effort** : M. **Valeur** : moyenne à haute.

#### G4. Avances des chefs reliées au قائد
- **Problème** : `owed_to` et `event_expenses.paid_by` sont du texte libre. Une faute de frappe sépare une dette en deux, et un chef ne voit pas ce qu'on lui doit.
- **Proposition** : « avancé par » choisi dans la liste des قادة, le texte libre restant pour les fournisseurs. Regroupement par créancier avec « Rembourser tout ». « Le groupe vous doit X » sur la fiche قائد. Push `advance_repaid`.
- **Données** : `treasury_entries.owed_leader_id` et `event_expenses.paid_by_leader_id`. Migration douce des noms qui correspondent exactement.
- **Pages** : trésorerie, fiche قائد, fiche camp.
- **Effort** : S. **Valeur** : moyenne.

#### G5. Alertes de caisse
- **Problème** : rien ne signale une caisse non comptée depuis longtemps, une dette ancienne ou un solde négatif. Le type `treasury_entry` est désactivé par défaut.
- **Proposition** : job quotidien `treasury_count_due` (plus de 30 jours sans مطابقة), `treasury_owed_overdue` (plus de 30 jours), `treasury_deficit`, et écart de comptage au-delà d'un seuil. Carte « À faire » sur le tableau de bord.
- **Données** : 3 types dans `push.js`.
- **Pages** : trésorerie, tableau de bord, réglages.
- **Effort** : S. **Valeur** : moyenne.

#### G6. Tenues : catalogue, stock, remise par élément
- **Problème** : on ne sait pas qui a reçu son فولار ou sa chemise, ni s'il l'a payé. La catégorie `uniform` n'existe qu'en sortie.
- **Proposition** : articles par مرحلة avec prix et stock. Remise à un élément (taille, payé, partiel ou dû), qui crée une entrée dans la caisse de sa فرقة. Rubrique « اللباس » sur la fiche. Export des tailles. Liste « admis sans فولار », reliée au تكريس (B1).
- **Données** : `uniform_items(id, name, section, price, stock)` et `uniform_issues(member_id, item_id, size, amount, paid, date, branch_id)`.
- **Pages** : trésorerie, fiche عنصر, العناصر.
- **Dépend de** : B1 pour le lien avec le فولار.
- **Effort** : L. **Valeur** : moyenne (Lot 3).

### Thème H — Réunions (محاضر) et تكاليف (5 features)

#### H1. « Mes تكاليف » et تكاليف en retard sur le tableau de bord, vue de charge par قائد
- **Problème** : `meeting_decisions` a déjà un responsable, une échéance et un statut, mais un chef ne voit pas ses tâches en ouvrant l'application. Un تكليف confié à un nom libre, ou à un قائد sans compte, ne reçoit aucun rappel.
- **Proposition** :
  - Entrée « Mes تكاليف en retard » avec un bouton « Fait » en ligne.
  - Entrée « تكاليف du فوج en retard » pour `meetings.read`.
  - En tête de la vue décisions, un tableau par responsable : ouverts, en retard, faits, délai moyen.
  - Dans le sélecteur, le nombre de تكاليف ouverts de chaque قائد.
  - Rappel au président pour les تكاليف sans compte.
- **Données** : bloc dans `/api/dashboard`. Route `GET /api/meeting-decisions/summary`.
- **Pages** : tableau de bord, محاضر.
- **Effort** : S. **Valeur** : haute (Lot 2, en tête).

#### H2. Convocation, confirmation de présence, rappels de réunion
- **Problème** : seule la création envoie une notification. Un changement de date passe inaperçu, il n'y a pas de rappel la veille, et `next_date` ne sert à rien.
- **Proposition** : bouton « Convoquer », qui envoie l'ordre du jour en push. Réponse « سأحضر / أعتذر », qui pré-remplit l'appel. Rappel la veille. Notification `meeting_changed`. Compteur « X confirmés / Y invités ».
- **Données** : statut `invited` dans `meeting_attendees` (migration du CHECK), colonnes `rsvp` et `rsvp_at`. Routes `POST /convene` et `PUT /rsvp`. Types `meeting_convened`, `meeting_changed` et `meeting_tomorrow`.
- **Pages** : محاضر, notifications.
- **Effort** : M. **Valeur** : haute.

#### H3. Assiduité des قادة aux réunions
- **Problème** : `meeting_attendees` n'est exploité nulle part en dehors du محضر.
- **Proposition** : bloc « الاجتماعات » sur la fiche قائد (taux sur 3, 6 et 12 mois, absences non excusées consécutives, تكاليف). Vue « Assiduité » dans /meetings, avec alerte et export. À regrouper avec l'assiduité aux séances (I5).
- **Données** : routes de statistiques uniquement.
- **Pages** : محاضر, القادة, fiche قائد.
- **Effort** : S. **Valeur** : moyenne à haute.

#### H4. Modèles d'ordre du jour + points générés
- **Problème** : chaque محضر part d'un ordre du jour vide.
- **Proposition** : un modèle par type de réunion. Le premier point est toujours « متابعة التكاليف السابقة ». Points générés en option : camps des 30 prochains jours, séances non validées, éléments à suivre.
- **Données** : `meeting_templates(kind, section, items JSON)`.
- **Pages** : محاضر, réglages.
- **Effort** : S. **Valeur** : moyenne.

#### H5. Validation et diffusion du محضر + lien d'une décision vers son objet
- **Problème** : on ne sait pas quels محاضر sont validés ou diffusés. Une décision comme « préparer le camp X » ou « appeler les parents de Y » reste un texte isolé.
- **Proposition** :
  - Statut brouillon → validé (par le président) → diffusé, avec un en-tête PDF normalisé et une alerte au-delà de 7 jours.
  - Lien facultatif d'une décision vers un event, une séance, un عنصر ou une caisse. La fiche liée affiche alors « تكاليف مرتبطة ».
- **Données** : sur `meetings` : `validated_at`, `validated_by`, `circulated_at`. Sur `meeting_decisions` : `ref_type`, `ref_id`, `amount`.
- **Pages** : محاضر, camps, العناصر, séances, trésorerie.
- **Effort** : M. **Valeur** : moyenne.

### Thème I — Pilotage, rôles et rapports à la قيادة (8 features)

#### I1. Rapport périodique à la قيادة (en-tête normalisé) ★ Lot 1
- **Problème** : cinq pages (tableau de bord, الفرق, séances, trésorerie, exports) proposaient chacune un rapport mensuel. Aujourd'hui, rendre compte demande d'assembler plusieurs PDF. L'en-tête n'a ni objet, ni destinataire, ni période, et les listes filtrées n'indiquent pas leurs filtres.
- **Proposition** : un seul kind `period` (id = فرقة, ou 0 = فوج ; `?from=&to=`), téléchargeable depuis le tableau de bord, الفرق et séances.
  - En-tête التقرير الجيد : الموضوع، الجهة المرسِلة، المرسَل إليه (mémorisé), période, date, signature du قائد et visa du عميد.
  - Corps : séances réalisées et prévues, taux de présence (séances validées) et comparaison avec la période précédente, effectif (entrées, ترفيعات, archivés), عناصر suivis et contactés, admissions, camps, résumé de caisse et cotisations, تكاليف en retard, zone « observations ».
  - Annexe facultative : grille de présence (A4).
  - Rappel en fin de mois.
  - Corriger au passage l'en-tête de toutes les feuilles pour qu'il affiche les filtres et la période.
- **Données** : route `GET /api/reports/period`. Clé de réglage `report_recipient`.
- **Pages** : tableau de bord, الفرق, séances, trésorerie, exports.
- **Dépend de** : A1 et G1 (A2 et G2 l'enrichissent).
- **Effort** : M à L. **Valeur** : haute.

#### I2. Synthèse hebdomadaire push pour la قيادة
- **Problème** : le responsable doit ouvrir plusieurs pages pour savoir où en est le فوج.
- **Proposition** : chaque dimanche, un résumé par فرقة : séances non validées, عناصر à suivre, cotisations, تكاليف en retard, camps à J-14. Il renvoie vers le rapport I1.
- **Données** : type `weekly_digest`. Réutilise les agrégats du tableau de bord.
- **Pages** : notifications, tableau de bord.
- **Dépend de** : I1.
- **Effort** : S à M. **Valeur** : moyenne.

#### I3. Rôle « عميد الفوج » et file d'approbations
- **Problème** : il n'existe que admin et user. Le عميد doit approuver les أوسمة, les ترفيعات, les camps et les fiches sans recevoir tous les droits admin.
- **Proposition** : préréglage de permissions « عميد الفوج » et permission `approvals.decide`. Onglet « Approbations » dans la cloche (ترفيع sous le seuil, وسام, camp, بطاقة), avec Approuver ou Refuser et un motif. Notification `approval_result`.
- **Données** : `approvals(id, kind, entity_type, entity_id, requested_by, requested_at, decided_by, decided_at, status, note)`. Types `approval_requested` et `approval_result`.
- **Pages** : notifications, admin, ترفيع, fiche عنصر, camps, بطاقات التحضير.
- **Effort** : M. **Valeur** : haute (Lot 2). C'est un préalable à B5, E3 et F2.

#### I4. Accès des comptes synchronisés avec la التشكيلة ★ Lot 1
- **Problème** : `users.branches` n'est jamais recalculé à partir des `assignments`. L'audience des notifications (push.js → `users.branches`) devient donc périmée après un changement de تشكيلة.
- **Proposition** : dans Admin, afficher pour chaque compte lié à un قائد les فرق de sa تشكيلة de l'année, avec un badge « ≠ تشكيلة » en cas d'écart. Boutons « aligner » et « aligner tous ». Signaler aussi les comptes liés à un قائد archivé ou absent de la تشكيلة.
- **Données** : `assignment_branch_ids` dans `GET /api/users`. Route `POST /api/users/sync-branches`.
- **Pages** : admin, القادة.
- **Effort** : S. **Valeur** : haute.

#### I5. Usage des comptes et charge des قادة
- **Problème** : l'admin ne voit pas quel chef n'utilise jamais l'application. Il ne peut pas déconnecter un téléphone perdu sans désactiver le compte. Les compteurs de séances des قادة sont cumulés depuis toujours et mélangent `sessions.leader_id` et `session_leaders`.
- **Proposition** :
  - « Vu il y a X j » (MAX de `auth_tokens.last_seen_at`), nombre d'appareils, filtre « jamais connecté / inactif 30 j », bouton « déconnecter partout ».
  - Liste des قادة filtrée par période : séances animées comme principal ou aide (à partir de `session_leaders`), présence, fiches préparées, réunions (H3).
  - Alerte `leader_inactive`.
- **Données** : `USER_LIST_SQL` enrichi. Route `DELETE /api/users/:id/tokens`. `?from&to` sur `GET /api/leaders`.
- **Pages** : admin, القادة, fiche قائد.
- **Effort** : S à M. **Valeur** : moyenne.

#### I6. Validation tracée de la بطاقة تقدم القائد
- **Problème** : avec `leaders.progress.self`, un قائد coche lui-même ses مطالب et personne ne contresigne.
- **Proposition** : une case cochée par le قائد lui-même reste « en attente » jusqu'à validation par un responsable. Elle garde le validateur et la date, avec une preuve optionnelle (séance ou event).
- **Données** : sur `leader_progress` : `status`, `validated_by`, `validated_at`, `session_id`, `event_id`.
- **Pages** : fiche قائد.
- **Effort** : S. **Valeur** : moyenne.

#### I7. Recherche globale (Ctrl+K)
- **Problème** : sur le terrain, retrouver le téléphone d'un parent oblige à passer par plusieurs écrans.
- **Proposition** : une palette qui cherche dans العناصر, قادة, séances, camps et محاضر. Elle respecte les permissions et le قسم actif, et propose les actions « appeler / WhatsApp le parent ».
- **Données** : `GET /api/search?q=`, qui fait l'union filtrée.
- **Pages** : shell.
- **Effort** : M. **Valeur** : moyenne.

#### I8. Journal d'audit consultable + relevé pour les parents
- **Problème** : `audit_events` n'est visible que pour une séance. Les modifications de fiches, de caisse et de comptes ne se consultent nulle part. Il n'existe pas non plus de document à remettre aux familles.
- **Proposition** :
  - Onglet historique unifié sur la fiche عنصر : ترفيعات (y compris annulés), mutations (`member_branch_history`), archivage, champs modifiés, مطالب.
  - Historique par caisse.
  - Visionneuse admin filtrable.
  - Variante `?audience=parents` de la fiche عنصر (présence, parcours, camps, cotisations), avec un export en lot par فرقة pour la réunion de parents.
- **Données** : lecture de `audit_events` et `member_branch_history`. Kind `members-parents`.
- **Pages** : fiche عنصر, trésorerie, admin, exports.
- **Effort** : M. **Valeur** : moyenne.

### Retirés ou reportés

- **Retirés (cosmétiques ou sans effet sur la gestion)** :
  - option برية/بحرية par فرقة ;
  - affichage des grades sur la كتفية ;
  - enregistrement de la طليعة qui hisse le drapeau, déjà couvert par المجلي الأول en C3 ;
  - contexte Wikipédia (fondation en 1985, fédération).
- **Renommage des petits groupes (سداسي/رهط) et libellés filles (زهرات/مرشدات/دليلات)** : non retenu pour l'instant. La mémoire du projet indique que الفرقة et الطليعة ont été gardés par choix de l'utilisateur. À reproposer seulement si le responsable le demande, sous forme de champ optionnel `branches.group_term`.
- **Déjà couverts par l'existant** : filtre « بيانات ناقصة » (il manque seulement la remontée vers le tableau de bord, voir A3) ; « 4 dernières séances » ; exports PDF/Excel des listes ; évaluation des séances et des camps ; série d'absences calculée (il manque la notification, voir A2) ; reprise des تكاليف de la réunion précédente (bloc متابعة, à corriger, voir les bugs).
- **Reportés (Lot 3 ou plus tard)** :
  - saisie de présence hors ligne (L, utile en camp, mais coûteuse) ;
  - budget prévisionnel par séance (valeur basse ; celui du camp est en E3) ;
  - module concours religieux et défi lecture (à revoir quand les أوسمة B5 existeront) ;
  - bibliothèque officielle des programmes hebdomadaires (simple lien `program_ref` en F5) ;
  - calendrier des occasions (via les modèles par occasion en F5) ;
  - charte de camp imprimable (à ajouter au dossier de camp E2 si besoin) ;
  - canal de communication avec les parents (le relevé I8 et le WhatsApp de A2 suffisent pour l'instant) ;
  - journal des actions de خدمة communautaire.

### Récapitulatif des thèmes

| Thème | Features | Lot 1 | Lot 2 conseillé |
|---|---|---|---|
| A — Assiduité et suivi | 4 | A1, A2 | A3, A4 |
| B — Parcours de l'عنصر | 7 | B1, B2 | B4, B5, B3 |
| C — Petits groupes | 4 | C1 | C2 |
| D — Formation et cadres | 4 | — | D1, D2 |
| E — Camps | 6 | E1, E2 | E3, E4 |
| F — Planification | 5 | — | F4, F3, F1/F2 |
| G — Finances | 6 | G1 | G2, G4, G5 |
| H — Réunions | 5 | — | H1, H2, H3 |
| I — Pilotage et rapports | 8 | I1, I4 | I3, I5 |
| **Total** | **49** | **10** | |

**Ordre global conseillé :**
- **Lot 1** : voir plus haut.
- **Lot 2** : I3 (approbations), D1, H1, A3, G2, B4, D2, H2, F4.
- **Lot 3** : B5, B6, C2, C3, E5, F1, F2, F3, G3, G6, D3, D4, I7, I8.

---

## Bugs et lacunes fonctionnelles relevés

Classés du plus grave au moins grave. Les numéros de ligne sont approximatifs (`~`).

### Données fausses (à corriger avec ou avant le Lot 1)

1. **Séances non pointées comptées comme absences.** Tous les عناصر sont insérés « absent » à la création (index.js ~4546), et `attendanceRowsStmt` (~1305) prend `s.date <= aujourd'hui`. Taux, `consecutive_absences`, مطالب et alertes sont donc faussés, y compris par la séance du jour avant le pointage. Côté client, `untaken()` ne neutralise que les séances datées d'aujourd'hui ou plus tard. → A1.
2. **`sessions.attendance_finalized_at/by` sont des colonnes mortes.** Elles sont déclarées (db.js l.144 et l.1535) et lues par PrintReport et l'export Excel, mais aucune route ne les écrit. La mention « clôturé par » n'apparaît donc jamais. → A1.
3. **Rappel `attendance_missing`** : il ne vise que `kind='activity'` et `date = aujourd'hui`. Une séance oubliée n'est jamais relancée, et les séances de قادة ne le sont pas du tout.
4. **Accès périmés** : `users.branches` n'est pas synchronisé avec la تشكيلة. Les accès et l'audience des notifications sont faux après un changement. → I4.
5. **Historique de l'élément** : `GET /api/members/:id` (~2524) n'exclut pas les ترفيعات annulés (`reversed_at`), qui s'affichent comme valides. L'historique ignore aussi `member_branch_history` (mutations et corrections).
6. **`POST /members/:id/matalib`** : pas d'`auditEvent`, et l'état « auto » supprime la ligne. On perd toute trace de qui a accordé puis retiré un مطلب.
7. **Dettes de cotisation effacées** : `memberLateMonths` (~3546) renvoie `[]` pour un élément non actif. Les tarifs codés en dur (~3367 et ~3509) changent rétroactivement les arriérés.
8. **`pendingPromotions` (~1133)** ignore en silence les عناصر sans date de naissance. Ils ne sont jamais proposés au ترفيع.
9. **Suivi des réunions multi-فرق** : `followupsOf` (~7313) ne compare que `meetings.branch_id` (la première فرقة). Des décisions ne sont jamais reprises, ou sont reprises dans de mauvaises réunions.

### Indicateurs trompeurs

10. **Tableau de bord, « Pointages non saisis »** : le total est calculé sur une requête limitée à `LIMIT 10`, donc sous-estimé sans aucun signe de troncature.
11. **Tableau de bord, `headOf`** : filtre `a.year = MAX(year)` global. Dès qu'une seule فرقة a commencé la تشكيلة suivante, toutes les autres perdent leur قائد.
12. **Tableau de bord, `nextSaturday`** : le jour est fixe. Une فرقة qui se réunit un autre jour reçoit à tort « plan absent » ou « بطاقة manquante ».
13. **`/api/branches/overview` (~1381) et `GET /api/leaders` (~3137)** : les statistiques sont cumulées depuis toujours, sans filtre d'année scoute. `sessions_count` (de `sessions.leader_id`) et les présences (de `session_leaders`) viennent de deux sources différentes, et un aide n'est jamais compté.
14. **Onglet مطالب de la فرقة** : un مطلب est « couvert » dès qu'une séance l'aborde, même sans aucun présent.
15. **Badge `consecutive_absences` d'une séance ancienne** : il est borné à aujourd'hui, pas à la date de la séance.
16. **Courbe de présence sur 8 jours** : elle mélange toutes les فرق, si bien qu'une petite فرقة pèse autant qu'un samedi complet.

### Traçabilité et contrôle

17. **`leader_progress`** : pas de `validated_by`. Avec `leaders.progress.self`, un قائد valide seul ses propres مطالب. → I6.
18. **Paiements de camp** : `PUT /events/:id/participants/:pid` écrase `paid_at` et `recorded_by`. La présence au camp (`POST .../attendance`) n'est pas auditée.
19. **`prep_cards`** :
    - `updated_by` n'est jamais écrit ;
    - une fiche peut être liée à une séance d'une autre فرقة (`parsePrepCard` ~5985) ;
    - deux fiches peuvent pointer vers la même séance ;
    - aucune trace d'audit, même à la suppression ;
    - `prep_missing` se déclenche si la fiche est datée la veille.
20. **ترفيع** :
    - l'historique est filtré sur `old_branch_id`, donc la فرقة d'arrivée ne voit pas les ترفيعات entrants ;
    - l'annulation exige les droits sur les deux فرق ;
    - `promoted_at` vaut toujours `todayISO()` ;
    - la طليعة d'âge n'est jamais réajustée quand l'élément vieillit.
21. **Aucune visionneuse d'audit** pour les fiches, la caisse (transferts, comptages, ouvertures) ou les comptes. → I8.

### Permissions et sécurité

22. **`/leaders/:id`** : la route client n'a pas de garde (`perm null`), alors que l'API exige `leaders.read`. Un compte lié à un قائد tombe sur une erreur 403 depuis un lien du tableau de bord (Dashboard.jsx ~156). Même incohérence pour le kind print `leaders` (PrintReport.jsx ~83).
23. **Candidats d'un camp** : les قادة proposés ne sont pas restreints aux فرق du compte.
24. **Anti-bruteforce** : `loginAttempts` est en mémoire et remis à zéro à chaque redémarrage. Il n'y a pas de limite globale par IP. Il n'existe pas non plus de « mot de passe oublié », et aucun message ne l'indique sur Login.
25. **Table `notifications` (flux admin « activité »)** : la contrainte CHECK est limitée à 4 types. Elle fait doublon avec `/api/me/notifications`, et tout nouveau type y échouera.

### Performance

26. **Requêtes N+1** : `GET /api/members` (~2462), `GET /api/sessions/:id` et le suivi du tableau de bord appellent `attributedAttendance` ou `attendanceStats` élément par élément, soit environ 400 éléments à chaque chargement et export. À remplacer par une requête agrégée, de préférence avec A1.

### Divers

27. **Événements** :
    - `outstanding` est calculé (index.js l.6459) mais n'est pas affiché dans `Events.jsx` ;
    - pas de filtre année/فرقة ni de pagination de l'archive ;
    - la recherche ignore les participants. → E2 et E6.
28. **Réunions** :
    - aucune notification quand la date, l'heure ou le lieu change ;
    - `next_date` ne sert à rien ;
    - les تكاليف sans `leader_id` ne reçoivent pas de rappel ;
    - le type « parents » est devenu hérité ;
    - `leaders` n'a pas de lien vers les فرق, donc l'appel d'une réunion de فرقة propose tout le قسم.
29. **Doublons** : `TRAINING_COURSES` est dupliqué dans Leaders.jsx, LeaderDetail.jsx et index.js. `REQUIREMENT_DEFAULTS` ne s'applique qu'au seed, pas aux فرق créées ensuite (FR/FRF).
30. **Lexique** : des commentaires serveur et le schéma `assignments` emploient ترقية, مجموعة et توصيف. Vérifier qu'aucune chaîne affichée (onglet التشكيلة, i18n) ne les reprend.
31. **Actions groupées** : `POST /api/members/archive` (archivage en masse) existe, mais Members.jsx n'a ni sélection multiple ni action groupée.

---

## Faits montadamahdi utilisés

| Sujet | Fait retenu | Utilisé dans | Source |
|---|---|---|---|
| مراحل | البراعم، الأشبال والزهرات، الكشافة والمرشدات، الجوالة والدليلات (+ خيمة الدليلات) ; un programme d'activités par مرحلة | B2, F5 (et renommage reporté) | https://www.montadamahdi.net/ |
| Âges أشبال | Entrée à 8 ans et un jour ; fin de la 3e مرتبة à 11 ans ; un promu des البراعم entre sans mois d'attente ni طلب الانتساب | A3, B1 | http://www.montadamahdi.net/essaydetails.php?eid=8806&cid=117 |
| Âges كشافة | Du début de 12 ans à la fin de 14 ans ; نظام التقدم sur 3 ans | A3 | http://www.montadamahdi.net/essaydetails.php?eid=8752&cid=116 |
| Âges جوالة | De 15 à 17 ans ; préparation aux المهام القيادية ; نظام التقدم sur 2 ans | D4 | http://www.montadamahdi.net/essaydetails.php?eid=8701&cid=115 |
| مطالب القبول أشبال | 1 mois ; طلب الانتساب، التحية، الوعد، 4 بنود، 2 réunions consécutives، 3 صرخات | B1 | http://www.montadamahdi.net/essaydetails.php?eid=8806&cid=117 |
| مطالب القبول كشافة | 1 mois ; 5 بنود، 4 réunions consécutives، 3 صرخات ; puis فولار et شارة الجمعية | B1 | http://www.montadamahdi.net/essaydetails.php?eid=8752&cid=116 |
| مطالب القبول جوالة | 2 mois ; 7 بنود، 4 réunions، 5 صرخات ; فولار remis au حفل القبول/التكريس | B1, G6 | https://www.montadamahdi.net/essaydetails.php?eid=8701&cid=115 |
| مراتب أشبال | المبتدئ 11 mois (12 si promu), 15 % ; الثاني 12 mois, 20 % ; الأول 12 mois, 25 % ; 1 وسام هواية chacune ; 60 % du سجل | B2, B4 | http://www.montadamahdi.net/essaydetails.php?eid=8806&cid=117 |
| مراتب كشافة | 11, 12 et 12 mois ; 20, 25 et 25 % ; 1, 2 et 2 أوسمة ; 70 % des 10 مجالات | B2, B4 | http://www.montadamahdi.net/essaydetails.php?eid=8752&cid=116 |
| مراتب جوالة | الإعداد 6 mois, 20 % ; التدريب 8 mois, 25 % ; الخدمة العامة 8 mois, 25 % ; fin de مرحلة à 70 % + 5 أوسمة هوايات | B2, B4 | http://www.montadamahdi.net/essaydetails.php?eid=8701&cid=115 |
| سجل التقدم | Livret : مطالب القبول, مطالب التقدم, أوسمة ; chaque مطلب est signé par le قائد ; peut être rempli en activité de فرقة ou de طليعة | B2, B3, I6 | http://www.montadamahdi.net/essaydetails.php?eid=8752&cid=116 |
| المجالات العشرة | الدينية، التنشئة المدنية، الوطنية، المهارات الكشفية، الفنون، الصحة والغذاء، الرياضية، العلاقات الاجتماعية، البيئة، العلوم والتكنولوجيا | B2, F4 | http://www.montadamahdi.net/essaydetails.php?eid=8753&cid=116 |
| أوسمة كشافة | أوسمة الكفايات par مرتبة (« الكشاف المتقدم » à 70 %) ; 27 أوسمة هوايات en 4 groupes | B5 | http://www.montadamahdi.net/essaydetails.php?eid=8753&cid=116 |
| أوسمة أشبال | 32 أوسمة en 4 groupes ; le chef vérifie, le عميد الفوج approuve, puis remise avec شهادة ; seul le عميد décerne رئيس السداسي | B5, I3 | http://www.montadamahdi.net/essaydetails.php?eid=8808&cid=117 |
| محفل | Le وسام et la شهادة تقدير sont remis dans un محفل de la فرقة, en présence des قادة du فوج | B6 | http://www.montadamahdi.net/essaydetails.php?eid=8753&cid=116 |
| الوعد والقانون | Texte du وعد ; 10 بنود du قانون ; prononcé aux حفلات القبول، التكريس، الترفيع | B1 | https://www.montadamahdi.net/essaydetails.php?eid=8705&cid=115 |
| نظام الجماعات الصغيرة | 5 à 8 éléments ; قائد + مساعد ; rôles selon les capacités ; rapport détaillé après chaque activité ; مجلس toutes les 2 semaines | C1, C2, C4 | https://www.montadamahdi.net/essaydetails.php?eid=8704&cid=115 |
| سداسي | رئيس، مساعد, éléments ; مجلس قيادة الفريق avec الرئيس الأول | C1 | http://www.montadamahdi.net/essaydetails.php?eid=8806&cid=117 |
| Grades de طليعة | العريف الأول (3 bandes), عريف (2), مساعد (1) sur la كتفية ; tenue (فولار, قميص, حزام…) | C1, G6 | http://www.montadamahdi.net/essaydetails.php?eid=8757&cid=116 |
| Taille des unités | رهط de 4 à 8 ; وحدة de 9 à 33 éléments, chefs inclus ; dédoublement au-delà de 33 | C1 | https://www.montadamahdi.net/essaydetails.php?eid=8701&cid=115 |
| Formation des cadres | مخيّم دورات قادة الجماعات : رائد رهط، عريف طليعة، رئيس سداسي | D1, D2 | https://www.montadamahdi.net/catessays.php?cid=118&pid=114 |
| دورة عريف طليعة | 44 أغراض (معارف، مهارات، اتجاهات، أنشطة) ; le diplômé est « قادراً على قيادة طليعته » | D2 | http://www.montadamahdi.net/essaydetails.php?eid=8834&cid=118 |
| Évaluation des دورات | 2 استمارات sur 50 points ; plusieurs évaluateurs ; note finale = moyenne | D3 | http://www.montadamahdi.net/essaydetails.php?eid=8830&cid=118 |
| Types de camps | كشفي، قيادي، تدريبي، ديني، فني، إعلامي، تنمية المجتمع، عام، عاشوراء، عن بعد | D1 | https://www.montadamahdi.net/catessays.php?cid=115&pid=114 |
| Règlement de camp | Horaires, propreté, خدمة/ترتيب ; le عريف comme contact ; tenue complète à l'تفتيش | E2, E5 | http://www.montadamahdi.net/essaydetails.php?eid=8779&cid=118 |
| Sécurité en camp | Trousse définie avec un médecin, extincteur + sable, خطة إخلاء, نقطة التجمع, noyade, emplacement des tentes | E1 | https://www.montadamahdi.net/essaydetails.php?eid=8725&cid=115 |
| Inspection | لجنة التفتيش note chaque رهط de 1 à 5 ; المجلي الأول et الثاني | C3, E5 | https://www.montadamahdi.net/essaydetails.php?eid=8715&cid=115 |
| Cérémonie du drapeau | Les deux premiers hissent les drapeaux ; environ 10 minutes par jour | C3 | https://www.montadamahdi.net/essaydetails.php?eid=8718&cid=115 |
| Gestion des réunions | جدول الأعمال diffusé avec confirmation de présence ; revue des تكاليف précédents ; le أمين السر diffuse le محضر et suit l'exécution | H1, H2, H4, H5 | https://www.montadamahdi.net/essaydetails.php?eid=8699&cid=115 |
| التقرير الجيد | الموضوع، المرجع، التاريخ، الجهة التابعة، المرسَل إليه، المحتوى، التوقيع ; un rapport en retard perd son utilité | I1, G2, E2 | https://www.montadamahdi.net/essaydetails.php?eid=8700&cid=115 |
| بطاقة خطة النشاط | 12 étapes : objectif, participants, temps, matériel, lieu, budget, accord préalable, activité de secours, évaluation | F1, F2, E3 | https://www.montadamahdi.net/essaydetails.php?eid=8698&cid=115 |
| Fonctions administratives | التخطيط، التنظيم، التوجيه، الرقابة (« ليست لاصطياد الأخطاء ») | F1, G3 | https://www.montadamahdi.net/essaydetails.php?eid=8697&cid=115 |
| Programme hebdomadaire | دليل برنامج النشاط الأسبوعي par مرحلة et par semestre | F3, F5 | https://www.montadamahdi.net/books/book.php?idbook=597 |
| Hiérarchie | فوج dirigé par le عميد ; وحدات ; قطاع/مفوضية au-dessus | I1, I3, I4 | https://www.montadamahdi.net/essaydetails.php?eid=7410&cid=44 |
| تنمية المجتمع | Contenus de sensibilisation pour les parents | A2, I8 | https://www.montadamahdi.net/catessays.php?cid=41&pid=2 |
| Contexte | Fondée en 1985 au Liban, membre de la Fédération libanaise du scoutisme (contexte seulement) | — | https://en.wikipedia.org/wiki/Imam_al-Mahdi_Scouts |
