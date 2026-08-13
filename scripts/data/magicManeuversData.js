/**
 * Magic Maneuvers — catalogue and progression.
 *
 * Data only: names, schools, degrees, costs, triggers, flavour and effect text,
 * plus the level table. No Foundry calls, so it can be verified on its own.
 *
 * Flavour and school text are the author's, from the specification. Item
 * descriptions are built as italic flavour followed by the mechanical text; the
 * school text belongs to the school, not repeated on every maneuver.
 */

/** Schools. Ids are transliterations of the working names in the spec. */
export const MM_SCHOOLS = {
  stykhia:      'Стихія',
  esentsia:     'Есенція',
  probiy:       'Пробій',
  vlada:        'Влада',
  utrymannia:   'Утримання',
  provydinnia:  'Провидіння'
};

/** School text, shown on the school rather than duplicated onto each maneuver. */
export const MM_SCHOOL_LORE = {
  stykhia:     `Стихія, що не гасне з ударом, а лишається на цілі: сковує, розʼїдає, тліє.`,
  esentsia:    `Шкода поза стихіями — та, що бʼє не тіло, а суть.`,
  probiy:      `Магія, що дістає ворога там, де він певен, що недосяжний.`,
  vlada:       `Панування над чужою волею, чужими чарами й тілом: вкласти думку, обернути закляття проти хазяїна. А рукою — вповні відновити зламане й змити з союзника скверну.`,
  utrymannia:  `Магія чіпкості: концентрація встоює попри провал, убивчий надлишок не зникає, а перекидається далі, щит бʼє у відповідь. Ніщо не гасне раніше часу.`,
  provydinnia: `Кастуючи, ти торкаєшся плетіння — і читаєш крізь нього більше, ніж саме закляття: чим ціль захищена, де вона тонка, що зробить наступної миті. Спел лишається твоїм, а знання з нього — зброя всієї команди.`
};

/** Only these four full casters have access. Sorcerer/Warlock/Witch do not. */
export const MM_CLASSES = ['wizard', 'cleric', 'druid', 'bard'];

/**
 * Progression thresholds. Levels between them keep the previous row, which is
 * what MagicManeuvers.progressionAt resolves.
 *   known      — how many maneuvers are known in total
 *   schools    — how many schools may be open
 *   maxDegree  — highest degree that may be learned
 */
export const MM_PROGRESSION = [
  { level: 3,  known: 2, schools: 2, maxDegree: 1 },
  { level: 5,  known: 3, schools: 2, maxDegree: 1 },
  { level: 7,  known: 4, schools: 2, maxDegree: 2 },
  { level: 9,  known: 5, schools: 3, maxDegree: 2 },
  { level: 11, known: 6, schools: 3, maxDegree: 2 },
  { level: 13, known: 7, schools: 3, maxDegree: 3 },
  { level: 15, known: 8, schools: 4, maxDegree: 3 },
  { level: 17, known: 8, schools: 4, maxDegree: 3 }
];

/**
 * The 26 maneuvers.
 *
 *   degree      gates learning by level (1 from 3rd, 2 from 7th, 3 from 13th).
 *               Independent of cost — a 1st-degree maneuver may cost 3.
 *   cost        exertion spent on activation
 *   trigger     what the cast must be for this to be offered
 *   activation  'cast' | 'reaction' | 'triggered' | 'special'
 *   consumesState  true for the shared "next attack on the target" state; false
 *               when the maneuver carries a duration of its own
 */
export const MAGIC_MANEUVERS = [
  /* ── Стихія ───────────────────────────────────────────── */
  { id: 'ice', name: 'Лід', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'cold', activation: 'cast', consumesState: true,
    flavor: `Стужа сковує суглоби, плоть крихне.`,
    effect: `Наступна атака по цілі: вразливість до дробильної шкоди. Швидкість цілі −10 фт до початку твого наступного ходу.` },

  { id: 'acid', name: 'Кислота', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'acid', activation: 'cast', consumesState: true,
    flavor: `Розʼїдена шкіра розходиться під лезом.`,
    effect: `Наступна атака по цілі: вразливість до рубальної шкоди.` },

  { id: 'fire', name: 'Вогонь', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'fire', activation: 'cast', consumesState: false,
    flavor: `Полумʼя чіпляється й доїдає.`,
    effect: `Ціль горить: та сама шкода знову на початку її наступного ходу (одноразово).` },

  { id: 'thunder', name: 'Грім', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'thunder', activation: 'cast', consumesState: false,
    flavor: `Удар глушить світ у вухах.`,
    effect: `Ціль оглушена і не може кастувати закляття з вербальним компонентом — до початку твого наступного ходу.` },

  { id: 'lightning', name: 'Блискавка', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'lightning', activation: 'cast', consumesState: false,
    flavor: `По воді розряд знаходить кожного.`,
    effect: `Якщо ціль на мокрій поверхні, у воді або під дощем — шкода шириться на всіх ворогів у межах 15 фт від цілі.` },

  { id: 'poison', name: 'Отрута', school: 'stykhia', degree: 3, cost: 3,
    trigger: 'damageType', damageType: 'poison', activation: 'cast', consumesState: false,
    flavor: `Трута тліє, доки тіло не переможе її.`,
    effect: `До 1 хвилини: на початку кожного свого ходу ціль робить рятівний кидок (DC маневру, стат за спелом). Провал — лишається отруєною і має −1 до своїх кидків d20; успіх — ефект спадає.` },

  /* ── Есенція ──────────────────────────────────────────── */
  { id: 'force', name: 'Сила', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'force', activation: 'cast', consumesState: true,
    flavor: `Кінетичний удар лишає тіло відкритим для проколу.`,
    effect: `Наступна атака по цілі: вразливість до колючої шкоди.` },

  { id: 'psychic', name: 'Психіка', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'psychic', activation: 'cast', consumesState: false,
    flavor: `Розум надламаний і беззахисний.`,
    effect: `Наступний ментальний рятівний кидок цілі (Інт/Мдр/Хар) — з перешкодою, до початку твого наступного ходу.` },

  { id: 'necrotic', name: 'Некротика', school: 'esentsia', degree: 2, cost: 3,
    trigger: 'damageType', damageType: 'necrotic', activation: 'cast', consumesState: false,
    flavor: `Наступна рана нагодує тебе.`,
    effect: `Поки власник при свідомості: наступна атака по ворогу в межах 30 фт від власника лікує власника на половину завданої нею шкоди (одноразово).` },

  { id: 'radiant', name: 'Радіант', school: 'esentsia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'radiant', activation: 'cast', consumesState: false,
    flavor: `Друге сяйво знаходить те, що сховалось від першого.`,
    effect: `Якщо власник вразив цю ціль радіантом у попередньому раунді — цей радіант-спел кидається з перевагою (або ціль з перешкодою на його рятівний кидок).` },

  { id: 'peak', name: 'Пік', school: 'esentsia', degree: 3, cost: 3,
    trigger: 'damageType', damageType: 'any', activation: 'cast', consumesState: false,
    maxSpellLevel: 5,
    flavor: `Магія вивершена до межі.`,
    effect: `Максимізуй усі кості шкоди цього спела (кожна кість = макс. грань). Тільки спели рівня 5 і нижче. Не реакція — застосовується як частина касту.` },

  /* ── Пробій ───────────────────────────────────────────── */
  { id: 'bypass', name: 'Обхід', school: 'probiy', degree: 1, cost: 1,
    trigger: 'spellAttack', activation: 'cast', consumesState: false,
    flavor: `Ні щит, ні мур не рятують.`,
    effect: `Спел-атака цього касту ігнорує бонус КЗ від щита й укриття цілі.` },

  { id: 'reflection', name: 'Відзеркалення', school: 'probiy', degree: 2, cost: 2,
    trigger: 'touchRange', activation: 'cast', consumesState: false,
    flavor: `Дотик крізь скло й воду.`,
    effect: `Спел із дальністю «Дотик» отримує дальність = дистанція зору, якщо ціль видно крізь прозоре або відбивне (скло, вода, дзеркало).` },

  { id: 'bend', name: 'Вигин', school: 'probiy', degree: 2, cost: 2,
    trigger: 'lineOrRay', activation: 'cast', consumesState: false,
    flavor: `Промінь огинає ріг.`,
    effect: `Промінь або лінію можна зігнути один раз під кутом — обійти укриття чи ріг.` },

  { id: 'pressure', name: 'Дотиск', school: 'probiy', degree: 1, cost: 1,
    trigger: 'damagingSpell', activation: 'cast', consumesState: false,
    flavor: `Магія черкає навіть повз ціль.`,
    effect: `Якщо спел-атака промахнулась АБО ціль пройшла рятівний кидок — ціль однаково отримує половину шкоди спела.` },

  /* ── Влада ────────────────────────────────────────────── */
  { id: 'suggestion', name: 'Навіювання', school: 'vlada', degree: 1, cost: 2,
    trigger: 'enchantment', activation: 'cast', consumesState: false,
    flavor: `Думка лягає, і слід стирається.`,
    effect: `Enchantment-спел не має видимого джерела; при успіху ціль не усвідомлює, що була зачарована.` },

  { id: 'countercast', name: 'Контркаст', school: 'vlada', degree: 3, cost: 3,
    trigger: 'enemyCast', activation: 'reaction', consumesState: false,
    flavor: `Чужий чар обертається проти хазяїна.`,
    effect: `Реакція на ворожий каст у полі зору: обертаєш той спел проти його ж джерела за половину його вартості, якщо цей самий спел є у власника підготовленим або відомим. Контест spellcasting ability (власник проти ворога).` },

  { id: 'generous-hand', name: 'Щедра длань', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    flavor: `Милосердя ллється вповні.`,
    effect: `Кості лікування цього спела рахуються як максимальні.` },

  { id: 'cleansing', name: 'Очищення', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    flavor: `Де благодать повна — там скверна тікає.`,
    effect: `Якщо кості лікування цього спела випали максимумом (natural max), спел додатково знімає з цілі один негативний стан.` },

  /* ── Утримання ────────────────────────────────────────── */
  { id: 'recall', name: 'Відклик', school: 'utrymannia', degree: 1, cost: 1,
    trigger: 'readiedSpell', activation: 'special', consumesState: false,
    flavor: `Занесене закляття вертаєш, доки не пізно.`,
    effect: `Можеш прибрати спел зі своїх занотованих (readied) дій — spell slot при цьому не витрачається.` },

  { id: 'harvest', name: 'Жнива', school: 'utrymannia', degree: 2, cost: 1,
    trigger: 'onKill', activation: 'reaction', consumesState: false,
    flavor: `Смерть однієї живить наступний удар.`,
    effect: `Коли твій спел убиває ворога, надлишкову шкоду (понад його поточні HP) переносиш на іншого ворога в межах 15 фт.` },

  { id: 'riposte', name: 'Відсіч', school: 'utrymannia', degree: 2, cost: 4,
    trigger: 'shield', activation: 'reaction', consumesState: false,
    flavor: `Щит бʼє у відповідь.`,
    effect: `Коли твій ward або shield-ефект поглинає шкоду від рукопашної атаки — повертає половину поглиненого нападнику.` },

  { id: 'steadfast', name: 'Незрушність', school: 'utrymannia', degree: 3, cost: 4,
    trigger: 'concentration', activation: 'triggered', consumesState: false,
    flavor: `Вкорінений, ти не зрушиш — і чар не впаде.`,
    effect: `Коли власник провалює concentration save, спел не спадає — тримається ще один раунд попри провал. Поки триває цей ефект, швидкість власника зменшена наполовину.` },

  /* ── Провидіння ───────────────────────────────────────── */
  { id: 'insight', name: 'Прозріння', school: 'provydinnia', degree: 1, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `Бачиш, чим ціль захищена.`,
    effect: `При касті власного спела власник дізнається спротиви та імунітети цілі свого спела.` },

  { id: 'premonition', name: 'Передчуття', school: 'provydinnia', degree: 2, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `Відчуваєш, де вона тонка.`,
    effect: `При касті власник дізнається найслабший рятівний кидок цілі свого спела.` },

  { id: 'farsight', name: 'Віще око', school: 'provydinnia', degree: 3, cost: 3,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `Зазираєш на хід уперед.`,
    effect: `При касті власник дізнається конкретний спел або дію, яку один ворог у полі зору виконає наступного раунду.` }
];
