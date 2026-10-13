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

  // ----- المخيمات و الدورات (target: 'event') -----
  // يقيّمها قائد المخيم أو الدورة، و هيئته القيادية، و القادة المشاركون فيها. «المتدرّبون»
  // هنا أيضًا «المشاركون»، و «إدارة التدريب» «قيادة الدورة» كما في دورات قادة الجماعات.
  {
    // «ما قبل عملية التخييم، أثناء التخييم، بعد التخييم» و شروط اختيار المكان، مع شروط
    // البرنامج من «مبادئ إقامة مخيّم كشفيّ» (eid 6312)
    key: 'camp',
    target: 'event',
    name_ar: 'تقييم المخيم',
    name_fr: 'Évaluation du camp',
    source: { title: 'المخيم الكشفي', url: `${SOURCE}?eid=3031&cid=19` },
    items: [
      axis('قبل المخيم', 'Avant le camp'),
      score('أُعدّ البرنامج مسبقًا ووافقت عليه القيادة', "Le programme a été préparé à l'avance et approuvé par la direction"),
      score('اختير المكان واستُكشف ميدانيًا قبل المخيم', 'Le terrain a été choisi et reconnu avant le camp'),
      score(
        'بُلِّغ المشاركون البرنامج والأهداف مسبقًا، وأُخذ إذن الأهل خطّيًا',
        "Programme et objectifs annoncés à l'avance, autorisation écrite des parents"
      ),
      score('وُزِّعت المهام على القادة، وعرف كلٌّ منهم واجباته', 'Les tâches ont été réparties, chaque chef savait son rôle'),
      score('أُعدّت الأدوات والتجهيزات اللازمة', 'Le matériel nécessaire était prêt'),
      axis('موقع المخيم', 'Le terrain'),
      score('تتوفّر فيه المياه الصالحة للشرب', "L'eau potable y était disponible"),
      score('بعيد عن المساكن والمستنقعات والوحل', 'Il était loin des habitations, des marécages et de la boue'),
      score('الطريق إليه سهلة لإيصال المؤن', "L'accès était facile pour le ravitaillement"),
      axis('البرنامج', 'Programme'),
      score('لبّى احتياجات المشاركين وفق خصائص نموّهم', 'Il répondait aux besoins des participants selon leur âge'),
      score(
        'جذّاب ومتوازن: كشفي ورياضي وفنّي وثقافي وديني',
        'Il était attrayant et équilibré : scout, sport, art, culture, religion'
      ),
      score('نُفِّذ البرنامج اليومي كما أُعدّ، وعُدِّل بمرونة عند الحاجة', 'Le programme du jour a été suivi, et ajusté au besoin'),
      score('أُدِّيت الواجبات الدينية في مواعيدها', "Les devoirs religieux ont été accomplis à l'heure"),
      axis('الحياة في المخيم', 'Vie de camp'),
      score('وُزِّع العمل على أفراد الطلائع: جلي وخدمة وغير ذلك', 'Les corvées ont été réparties dans les sous-groupes'),
      score('كان الطعام كافيًا ومتوازنًا ونظيفًا', 'Les repas étaient suffisants, équilibrés et propres'),
      score('حوفظ على النظافة العامة وعلى الأرض والأشجار', 'Le camp et la nature ont été gardés propres'),
      axis('بعد المخيم', 'Après le camp'),
      score('نُظِّفت التجهيزات وحُزمت، ولم يُنسَ شيء منها', "Le matériel a été nettoyé et emballé, rien n'a été oublié"),
      score('أُعيدت الأرض نظيفةً، بلا أثر يدلّ على المخيم', 'Le terrain a été rendu propre, sans laisser de trace'),
      axis('أسئلة مفتوحة', 'Questions ouvertes'),
      STRENGTHS,
      WEAKNESSES,
      SUGGESTIONS,
    ],
  },
  {
    // «واجبات المشارك في المخيم»، و هي أيضًا استمارة «تقييم الأداء السلوكي» في دورات قادة
    // الجماعات (eid 8829): هنا للمشاركين جملةً، لا لكل واحد منهم
    key: 'camp_rules',
    target: 'event',
    name_ar: 'التزام المشاركين بأنظمة المخيم',
    name_fr: 'Respect des règles du camp',
    source: { title: 'واجبات المشارك في المخيم', url: `${SOURCE}?eid=6313&cid=18` },
    items: [
      score('تهيّأوا للصلاة قبل الأذان، وشاركوا في البرنامج العبادي', "Prêts pour la prière avant l'appel, présents au programme religieux"),
      score('تقيّدوا بأوقات المخيم الرسمية', 'Ont respecté les horaires du camp'),
      score(
        'حافظوا على نظافتهم الشخصية ونظافة الخيمة والتجهيزات التي تسلّموها',
        'Ont gardé propres leur personne, leur tente et le matériel reçu'
      ),
      score('حرصوا على العمل الجماعي: ترتيب وريادة ونشاطات', 'Ont joué le jeu collectif : rangement, constructions, activités'),
      score(
        'رجعوا إلى القيادة عبر العريف عند أيّ خلاف، ولم يتصرّفوا بشكل فردي',
        "En cas de désaccord, sont passés par leur responsable au lieu d'agir seuls"
      ),
      score('ارتدوا الزيّ الكشفي الكامل عند التفتيش وفي ساحة العلم', "Portaient l'uniforme complet à l'inspection et aux couleurs"),
      score('لبّوا الصافرات فورًا، بلا تباطؤ', 'Ont répondu aux coups de sifflet sans traîner'),
      score('شاركوا في جميع فقرات البرنامج بفعالية وحماس', 'Ont pris part à tout le programme avec entrain'),
      score('أبدوا الاحترام والطاعة لقيادة المخيم', 'Ont respecté la direction du camp et suivi ses consignes'),
      text('عناصر يحتاجون إلى متابعة', 'Membres à suivre'),
    ],
  },
  {
    // الاستبيان نفسه، أسئلته مؤشرات بصيغة الغائب: يجيب عنه المشارك و المدرّب معًا
    key: 'course',
    target: 'event',
    name_ar: 'رضا المشاركين عن الدورة',
    name_fr: 'Satisfaction des participants à la formation',
    source: { title: 'أسئلة استبيان لقياس مستوى الرضا لدى المتدربين', url: `${SOURCE}?eid=4255&cid=24` },
    items: [
      axis('التنظيم', 'Organisation'),
      score('استقبلت قيادة الدورة المشاركين استقبالًا حسنًا', "L'équipe de la formation a bien accueilli les participants"),
      score('حُضِّرت الدورة تحضيرًا جيّدًا', 'La formation était bien préparée'),
      score('نُفِّذ البرنامج في مواعيده، بلا تأخير', 'Le programme a tenu ses horaires, sans retard'),
      score('أُجيب عن الاستفسارات خلال الدورة', 'Les questions posées pendant la formation ont reçu une réponse'),
      score('أحسنت قيادة الدورة التعامل مع المشاركين', "L'équipe de la formation a bien traité les participants"),
      axis('هيئة التدريب', 'Équipe de formation'),
      score('المدرّبون أكفاء', 'Les formateurs étaient compétents'),
      score('المظهر العام لهيئة التدريب لائق', "La tenue de l'équipe de formation était soignée"),
      axis('المكان والكلفة', 'Lieu et coût'),
      score('موقع الدورة مناسب', 'Le lieu de la formation convenait'),
      score('كلفة الدورة مناسبة للمستوى المالي للمشاركين', 'Le coût était adapté aux moyens des participants'),
      axis('أسئلة مفتوحة', 'Questions ouvertes'),
      text('هل تشارك في دورة أخرى؟ إن لا، فلماذا؟', 'Feriez-vous une autre formation ? Sinon, pourquoi ?'),
      STRENGTHS,
      WEAKNESSES,
      SUGGESTIONS,
    ],
  },
  {
    // المجالات الأربعة: البرنامج، تقدّم المشاركين، أداء المدرّبين، أثر التدريب — مع «تقويم
    // التدريب» (eid 1131) و «تقييم المدرب» (eid 4277). لقيادة الدورة بعد انتهائها.
    key: 'training_program',
    target: 'event',
    name_ar: 'تقويم البرنامج التدريبي',
    name_fr: 'Bilan du programme de formation',
    source: { title: 'مجالات تقويم البرنامج التدريبي', url: `${SOURCE}?eid=1139&cid=24` },
    items: [
      axis('البرنامج التدريبي', 'Programme'),
      score('أهداف الدورة واضحة ومحدّدة', 'Les objectifs étaient clairs et précis'),
      score('البرنامج يلبّي حاجات المشاركين', 'Le programme répondait aux besoins des participants'),
      score('المحتوى والمواد التدريبية تخدم الأهداف', 'Le contenu et les supports servaient les objectifs'),
      score('سار البرنامج بحسب الخطوات المرسومة، وعُدِّل عند الحاجة', 'Le programme a suivi son plan, ajusté quand il le fallait'),
      score('تحقّقت أهداف الدورة', 'Les objectifs de la formation ont été atteints'),
      axis('تقدّم المشاركين', 'Progrès des participants'),
      score('تفاعل المشاركون مع التدريب والأنشطة', 'Les participants se sont investis dans le travail et les activités'),
      score('تعلّم المشاركون من البرنامج', 'Les participants ont appris de la formation'),
      score('سعد المشاركون بالبرنامج', 'Les participants ont apprécié la formation'),
      axis('أداء المدرّبين', 'Formateurs'),
      score('أتقن المدرّبون الكفايات التدريبية', 'Les formateurs maîtrisaient leur rôle'),
      score('بسّطوا المعلومات وعرضوها بشكل شيّق', 'Ils ont présenté les contenus simplement et de façon vivante'),
      score('أداروا الحوار والمناقشات، وأنصتوا للمشاركين', 'Ils ont animé les échanges et écouté les participants'),
      score('كانوا قدوة في مظهرهم وسلوكهم', "Ils ont donné l'exemple par leur tenue et leur conduite"),
      axis('أثر الدورة', 'Impact'),
      score('عدّل المشاركون سلوكهم طبقًا لما تعلّموه', "Les participants ont changé leur pratique selon ce qu'ils ont appris"),
      score('يظهر أثر الدورة في عمل المشاركين في فرقهم', "L'effet de la formation se voit dans leur travail en unité"),
      axis('أسئلة مفتوحة', 'Questions ouvertes'),
      STRENGTHS,
      WEAKNESSES,
      // «تسجيل التوصيات ونتائج التقويم حتى يمكن الاستعانة بها في الدورات التالية»
      text('توصيات للدورات المقبلة', 'Recommandations pour les prochaines formations'),
    ],
  },
  {
    key: 'training_climate',
    target: 'event',
    name_ar: 'البيئة التدريبية المعنوية',
    name_fr: 'Climat de la formation',
    source: { title: 'عناصر تقييم البيئة التدريبية المعنوية ومؤشراته', url: `${SOURCE}?eid=4286&cid=24` },
    items: [
      axis('إدارة الدورة', 'Direction de la formation'),
      score('تستعمل قيادة الدورة السلطة عند الضرورة فقط', "L'équipe n'use de son autorité qu'en cas de besoin"),
      score('تُشرك المشاركين في اتخاذ القرارات', 'Elle associe les participants aux décisions'),
      axis('الانضباط', 'Discipline'),
      score('قواعد السلوك واضحة ومتّفق عليها', 'Les règles de conduite étaient claires et convenues'),
      score('شارك المشاركون في وضعها', 'Les participants ont pris part à leur rédaction'),
      score('التزموا بها عن قناعة', 'Ils les ont respectées par conviction'),
      axis('قيادة الدورة والمشاركون', "L'équipe et les participants"),
      score('تفهم قيادة الدورة حاجات المشاركين وميولهم', "L'équipe comprenait les besoins et les envies des participants"),
      score('ساد الاحترام المتبادل', 'Le respect était mutuel'),
      score('التواصل بينهما فعّال', 'La communication passait bien'),
      axis('المدرّبون والمشاركون', 'Les formateurs et les participants'),
      score('انفتح المدرّبون على الأفكار وتقبّلوا الآخر', 'Les formateurs étaient ouverts aux idées des autres'),
      score('عدلوا في التعامل مع المشاركين', 'Ils ont traité les participants avec équité'),
      axis('المشاركون فيما بينهم', 'Entre participants'),
      score('تفاعلوا ضمن الجماعات', 'Ils ont travaillé ensemble dans les groupes'),
      score('بادروا إلى خدمة الآخرين', "Ils ont pris l'initiative d'aider les autres"),
      score('تعاونوا في الأمور الخدماتية العامة', 'Ils ont coopéré aux services communs'),
      axis('التحفيز', 'Motivation'),
      score('نظام التحفيز معلوم لدى المشاركين', "Le système d'encouragements et de sanctions était connu"),
      score('طُبِّق باستمرار', 'Il a été appliqué de façon constante'),
      SUGGESTIONS,
    ],
  },
];

// النموذج الذي تُفتح به الميزة: يُنسخ مرّة واحدة عند إنشاء الجداول، لأنشطة الفرق و القادة
// و الفوج. الزيارة المنزلية بلا استمارة حتى يختار لها المسؤول واحدة.
const DEFAULT_EVAL_PRESET = 'success';
const DEFAULT_EVAL_KINDS = ['activity', 'leaders', 'group'];

// و للمخيمات و الدورات، يوم تُنشأ جداول تقييمها: استمارة لكل نوع، تُنسخ مرّة واحدة. الرحلة
// و «غير ذلك» بلا استمارة حتى يختار لها المسؤول واحدة.
const DEFAULT_EVENT_EVAL_PRESETS = { event_camp: 'camp', event_course: 'course' };

module.exports = { EVAL_PRESETS, DEFAULT_EVAL_PRESET, DEFAULT_EVAL_KINDS, DEFAULT_EVENT_EVAL_PRESETS };
