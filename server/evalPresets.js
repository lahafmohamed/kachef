// ---------- نماذج التقييم الجاهزة ----------
// استمارات جاهزة يختار منها المسؤول، مأخوذة من «منتدى مهدي الكشفي» (montadamahdi.net)،
// موقع كشافة الإمام المهدي (ع): بنودها بكلمات الجمعية، و «الجلسة التدريبية» فيها صارت
// «النشاط»، و «المتدرّبون» صاروا «المشاركين» — عناصر الفرقة في نشاطها، و القادة في نشاط
// القادة. كل بند بالعربية و الفرنسية: الأقسام الفرنكوفونية تقرأ الاستمارة بلغتها.
//
// البند: axis عنوان محور يجمع ما تحته، score مؤشر يُعطى علامة من 1 إلى 5، text سؤال
// مفتوح. يُنسخ النموذج إلى eval_forms حين يختاره المسؤول، فتعديل الملف هنا لا يمسّ
// استمارة نُسخت قبله.

const SOURCE = 'https://montadamahdi.net/essaydetails.php';

const axis = (ar, fr) => ({ type: 'axis', label_ar: ar, label_fr: fr });
const score = (ar, fr) => ({ type: 'score', label_ar: ar, label_fr: fr });
const text = (ar, fr) => ({ type: 'text', label_ar: ar, label_fr: fr });

// الأسئلة المفتوحة نفسها في أكثر من نموذج: «ما أبرز ثلاث إيجابيات وجدتها… ثلاث سلبيات…
// اقتراحاتك» من استبيان الرضا في المنتدى
const STRENGTHS = text('أبرز الإيجابيات', 'Points forts');
const WEAKNESSES = text('أبرز السلبيات', 'Points faibles');
const SUGGESTIONS = text('اقتراحات للتحسين', "Suggestions d'amélioration");

const EVAL_PRESETS = [
  {
    key: 'success',
    name_ar: 'مؤشرات نجاح النشاط',
    name_fr: 'Indicateurs de réussite de la séance',
    source: { title: 'مؤشرات نجاح الجلسة التدريبيَّة ومعاييره', url: `${SOURCE}?eid=4234&cid=24` },
    items: [
      axis('وقت النشاط', 'Temps'),
      score('افتُتح النشاط في الوقت المحدّد', "La séance a commencé à l'heure prévue"),
      score('اختُتم النشاط في الوقت المحدّد', "La séance s'est terminée à l'heure prévue"),
      score('استُثمر الوقت كلّه، بلا وقت ضائع', 'Le temps a été bien utilisé, sans temps mort'),
      axis('أهداف النشاط', 'Objectifs'),
      score('عُرضت الأهداف على المشاركين في بداية النشاط', 'Les objectifs ont été annoncés au début'),
      score('تحقّقت الأهداف المقرّرة', 'Les objectifs prévus ont été atteints'),
      axis('بيئة النشاط', 'Cadre et moyens'),
      score('توفّرت التجهيزات والوسائل الضرورية', 'Le matériel et les supports nécessaires étaient là'),
      score('تنوّعت الأنشطة', 'Les activités étaient variées'),
      score('غلب الجانب التطبيقي على الجانب النظري', 'La pratique a primé sur la théorie'),
      axis('تفاعل المشاركين', 'Participation'),
      score('أُشرك جميع المشاركين في الأنشطة', 'Tous les participants ont été impliqués'),
      score('ساد جوّ إيجابي', "L'ambiance était positive"),
      score('تكافأت الفرص بين المشاركين', 'Chacun a eu sa chance'),
      score('تفاعل المشاركون وناقشوا', 'Les participants ont réagi et échangé'),
      score('بدا المشاركون راضين', 'Les participants étaient satisfaits'),
      axis('أسئلة مفتوحة', 'Questions ouvertes'),
      STRENGTHS,
      WEAKNESSES,
      SUGGESTIONS,
    ],
  },
  {
    key: 'quick',
    name_ar: 'تقييم سريع: الكفاية، الفاعلية، الأثر',
    name_fr: 'Évaluation rapide : moyens, efficacité, impact',
    source: { title: 'التقويم التدريبي', url: `${SOURCE}?eid=4260&cid=24` },
    items: [
      score(
        'الكفاية: كانت الموارد مناسبة (الكلفة، القادة، الوقت، التجهيزات)',
        'Moyens : les ressources étaient adaptées (coût, chefs, temps, matériel)'
      ),
      score('الفاعلية: تحقّقت أهداف النشاط', 'Efficacité : les objectifs de la séance ont été atteints'),
      score(
        'الأثر: ترك النشاط أثرًا في سلوك المشاركين واتجاهاتهم',
        'Impact : la séance a marqué le comportement des participants'
      ),
      STRENGTHS,
      WEAKNESSES,
      SUGGESTIONS,
    ],
  },
  {
    key: 'preparation',
    name_ar: 'معايير تقويم التحضير',
    name_fr: 'Critères de préparation',
    source: { title: 'معايير تقويم لتحضير جلسة تدريبية', url: `${SOURCE}?eid=6672&cid=24` },
    items: [
      axis('موضوع النشاط', 'Thème'),
      score('الموضوع واضح ودقيق', 'Le thème était clair et précis'),
      score('يناسب ميول المشاركين ورغبتهم', 'Il répondait aux envies des participants'),
      axis('أهداف النشاط', 'Objectifs'),
      score('تناسب مستوى المشاركين الذهني والمهاري', 'Adaptés au niveau des participants'),
      score('تشمل الجوانب المعرفية والمهارية والوجدانية', 'Couvrent savoir, savoir-faire et savoir-être'),
      score('واضحة ويمكن تحقيقها', 'Clairs et atteignables'),
      axis('التمهيد والمحتوى', 'Introduction et contenu'),
      score('مُهِّد للنشاط تمهيدًا مدروسًا', "L'entrée en matière était préparée"),
      score('المحتوى يخدم الأهداف ويناسب وقت النشاط', 'Le contenu servait les objectifs et tenait dans le temps'),
      axis('الوسائل', 'Supports'),
      score('الوسائل جاهزة ومجرَّبة قبل النشاط', 'Les supports étaient prêts et testés avant'),
      score('تساعد على تحقيق الأهداف', 'Ils aidaient à atteindre les objectifs'),
      axis('الطريقة', 'Méthode'),
      score('تنوّعت الطرق', 'Les méthodes étaient variées'),
      score('سمحت بالتفاعل والمشاركة', "Elles favorisaient l'échange et la participation"),
      score('راعت الفروق الفردية بين المشاركين', 'Elles tenaient compte des différences entre participants'),
      axis('التقويم', 'Évaluation des acquis'),
      score('أسئلة التقويم تقيس الأهداف', 'Les questions de fin mesuraient les objectifs'),
      SUGGESTIONS,
    ],
  },
  {
    key: 'leader',
    name_ar: 'تقييم أداء القائد المسؤول',
    name_fr: 'Prestation du chef responsable',
    source: { title: 'عناصر التقييم الأدائي للمدرب', url: `${SOURCE}?eid=4270&cid=24` },
    items: [
      axis('شخصية القائد', 'Personnalité'),
      score('مظهره وهندامه مرتّبان', 'Tenue propre et soignée'),
      score('يتواصل مع المشاركين بشكل جيّد', 'Communique bien avec les participants'),
      score('يُحسن التعامل مع أنماط الشخصيات', "Sait s'adapter à chaque caractère"),
      axis('متابعة المشاركين', 'Suivi des participants'),
      score('يعطي الفرصة لجميع المشاركين للمشاركة', "Donne à chacun l'occasion de participer"),
      score('يقدّم التغذية الراجعة بشكل جيّد', 'Fait de bons retours'),
      axis('إدارة النشاط', 'Conduite de la séance'),
      score('حضّر النشاط وفق بطاقة التحضير', 'A préparé la séance avec la fiche de préparation'),
      score('يطبّق الطرق والوسائل بفعالية', 'Utilise méthodes et supports avec efficacité'),
      score('يدير الوقت بفعالية', 'Gère bien le temps'),
      axis('التمكّن من المادة', 'Maîtrise du contenu'),
      score('يربط المادة بواقع المشاركين', 'Relie le contenu au vécu des participants'),
      score('يجيب على الأسئلة بشكل مناسب', 'Répond bien aux questions'),
      score('يستعمل لغة سليمة وسهلة', "S'exprime de façon correcte et simple"),
      text('ملاحظات للقائد', 'Remarques pour le chef'),
    ],
  },
  {
    key: 'behaviour',
    name_ar: 'الأداء السلوكي للعناصر',
    name_fr: 'Comportement des membres',
    source: { title: 'عناصر تقييم الأداء السلوكي للمتدرب', url: `${SOURCE}?eid=4278&cid=24` },
    items: [
      score('شاركوا في البرنامج العبادي في وقته', "Ont suivi le programme religieux à l'heure"),
      score('أبدوا الاحترام لقيادتهم ولزملائهم', 'Ont respecté leurs chefs et leurs camarades'),
      score('بادروا إلى خدمة زملائهم', "Ont pris l'initiative d'aider les autres"),
      score('شاركوا بفعالية بالسؤال والمناقشة', 'Ont participé activement (questions, échanges)'),
      score('التزموا بالأنظمة وبالأوقات المحدّدة', 'Ont respecté les règles et les horaires'),
      score('ارتدوا الزيّ الكشفي بشكل مرتّب', "Portaient l'uniforme correctement"),
      score('حافظوا على نظافة المكان', 'Ont gardé les lieux propres'),
      text('عناصر يحتاجون إلى متابعة', 'Membres à suivre'),
    ],
  },
  {
    // من «مجالات المتابعة» التي يقيّم بها العميد وحدات فوجه: أنشطة الفرقة و تطبيق الطريقة
    // الكشفية، مقيسةً في نشاط واحد
    key: 'method',
    name_ar: 'الطريقة الكشفية في النشاط',
    name_fr: 'Méthode scoute dans la séance',
    source: { title: 'متابعة وتقييم الوحدات الكشفية', url: `${SOURCE}?eid=222&cid=21` },
    items: [
      axis('ملاءمة النشاط', 'Pertinence'),
      score('يناسب المرحلة السنية للعناصر', "Adaptée à l'âge des membres"),
      score('يخدم المنهج الكشفي للمرحلة', 'Sert le programme scout de la tranche'),
      score('ساعد العناصر على التقدّم في مطالبهم', 'A fait avancer les membres dans leurs matalib'),
      axis('الطريقة الكشفية', 'Méthode scoute'),
      score('طُبِّق نظام الطلائع', 'Le travail en sous-groupes a été appliqué'),
      score('لكل طليعة عريف يقوم بدوره', 'Chaque sous-groupe avait un responsable actif'),
      score('وُزِّعت المهام على العناصر', 'Les tâches ont été réparties entre les membres'),
      score('شارك العناصر في تحمّل المسؤوليات واتخاذ القرار', 'Les membres ont pris des responsabilités et des décisions'),
      score('ارتدى العناصر الزيّ الكشفي والشارات بشكل صحيح', 'Uniforme et insignes portés correctement'),
      SUGGESTIONS,
    ],
  },
  {
    key: 'place',
    name_ar: 'المكان والتجهيزات',
    name_fr: 'Lieu et matériel',
    source: { title: 'عناصر تقييم البيئة التدريبية المادية ومؤشراته', url: `${SOURCE}?eid=4282&cid=24` },
    items: [
      score('المكان بعيد عن الضوضاء والمشوّشات', 'Le lieu était au calme'),
      score('حجمه يناسب عدد المشاركين', 'Sa taille convenait au nombre de participants'),
      score('التهوئة والإضاءة جيّدتان', 'Aération et éclairage corrects'),
      score('المكان نظيف ومرتّب', 'Le lieu était propre et rangé'),
      score('التجهيزات متوفّرة وصالحة للاستعمال', 'Le matériel était disponible et en bon état'),
      score('إجراءات الأمن والسلامة مؤمَّنة', 'Les règles de sécurité étaient respectées'),
      text('ملاحظات على المكان', 'Remarques sur le lieu'),
    ],
  },
];

// النموذج الذي تُفتح به الميزة: يُنسخ مرّة واحدة عند إنشاء الجداول، لأنشطة الفرق و القادة
// و الفوج. الزيارة المنزلية بلا استمارة حتى يختار لها المسؤول واحدة.
const DEFAULT_EVAL_PRESET = 'success';
const DEFAULT_EVAL_KINDS = ['activity', 'leaders', 'group'];

module.exports = { EVAL_PRESETS, DEFAULT_EVAL_PRESET, DEFAULT_EVAL_KINDS };
