/**
 * Magic Maneuvers — homebrew modifiers a full caster applies to their own spell
 * as they cast it.
 *
 * This file is the rules layer only: the catalogue, the progression table and the
 * gates. It deliberately contains no Foundry calls, so it can be verified on its
 * own and reused whichever system the activation layer ends up written against.
 *
 * The iron rule from the specification: a maneuver never activates without the
 * owner casting a spell of their own — including the informational Provydinnia
 * ones, which read the target at the moment of touching the weave.
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

/**
 * Narrative text for each school, so they read like the combat traditions rather
 * than a bare list of keys.
 */
export const MM_SCHOOL_LORE = {
  stykhia: `Стихійники не творять вогонь і лід — вони домовляються з ними. Там, де інший маг просто жбурне полумʼя, адепт Стихії лишає його жити: тліти в рані, чіплятися за мокрий камінь, повзти калюжею до наступного ворога. Їхня магія рідко закінчується там, де закінчується закляття.`,

  esentsia: `Есенція має справу не зі стихіями, а з тканиною, з якої зроблене все інше — чиста сила, думка, світло і те, що лишається по смерті. Її адепти вчаться торкатися суті речей напряму, і від того їхні удари лишають по собі не опіки, а тріщини в самому предметі чи в самій волі.`,

  probiy: `Пробій — школа тих, кого дратують перешкоди. Щит, ріг стіни, відстань, саме поняття «поза досяжністю» — усе це для них не закон, а умовність, яку можна обійти, зігнути чи просто проігнорувати. Кажуть, найкращі з них давно не бачать стін — лише двері, про які ніхто не здогадався.`,

  vlada: `Влада працює з волею — чужою і власною. Її адепти вміють вкласти наказ так, що жертва не помітить чужої руки, вирвати чуже закляття просто з повітря й повернути його господарю, або вкласти в лікування стільки наміру, що рана не має вибору, крім як закритися.`,

  utrymannia: `Утримання — про те, щоб не відпускати. Занотоване закляття, яке можна забрати назад. Смерть ворога, чия сила ще не встигла розсіятися. Концентрація, що тримається попри біль. Це школа впертості, і її адепти кажуть, що магія рідко зникає — частіше її просто випускають з рук.`,

  provydinnia: `Провидіння не бʼє і не лікує. У ту мить, коли долоня торкається плетіва, його адепт устигає зазирнути далі за власне закляття: побачити, де ворог мʼякий, чого він боїться, що зробить наступної миті. Знання приходить разом із кастом і зникає з ним — але одного удару вистачає, щоб змінити бій.`
};

/** Only these four full casters have access. Sorcerer/Warlock/Witch do not. */
export const MM_CLASSES = ['wizard', 'cleric', 'druid', 'bard'];

/**
 * Progression by CHARACTER level. Entries are the thresholds; levels between
 * them keep the previous row, which is what #rowFor resolves.
 *   known      — how many maneuvers the character knows in total
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
 *   consumesState  true when it applies the shared "next attack on the target"
 *               state; false when the maneuver carries its own duration
 */
export const MAGIC_MANEUVERS = [
  /* ── Стихія ───────────────────────────────────────────── */
  { id: 'ice', name: 'Лід', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'cold', activation: 'cast', consumesState: true,
    effect: 'Наступна атака по цілі: вразливість до дробильної шкоди. Швидкість цілі −10 фт до початку твого наступного ходу.' },

  { id: 'acid', name: 'Кислота', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'acid', activation: 'cast', consumesState: true,
    effect: 'Наступна атака по цілі: вразливість до рубальної шкоди.' },

  { id: 'fire', name: 'Вогонь', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'fire', activation: 'cast', consumesState: false,
    effect: 'Ціль горить: та сама шкода повторюється на початку її наступного ходу (одноразово).' },

  { id: 'thunder', name: 'Грім', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'thunder', activation: 'cast', consumesState: false,
    effect: 'Ціль оглушена і не може кастувати закляття з вербальним компонентом — до початку твого наступного ходу.' },

  { id: 'lightning', name: 'Блискавка', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'lightning', activation: 'cast', consumesState: false,
    effect: 'Якщо ціль на мокрій поверхні, у воді або під дощем — шкода шириться на всіх ворогів у межах 15 фт від неї.' },

  { id: 'poison', name: 'Отрута', school: 'stykhia', degree: 3, cost: 3,
    trigger: 'damageType', damageType: 'poison', activation: 'cast', consumesState: false,
    effect: 'До 1 хвилини: на початку кожного свого ходу ціль робить рятівний кидок проти DC маневру. Провал — лишається отруєною і має −1 до своїх кидків d20; успіх — ефект спадає.' },

  /* ── Есенція ──────────────────────────────────────────── */
  { id: 'force', name: 'Сила', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'force', activation: 'cast', consumesState: true,
    effect: 'Наступна атака по цілі: вразливість до колючої шкоди.' },

  { id: 'psychic', name: 'Психіка', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'psychic', activation: 'cast', consumesState: false,
    effect: 'Наступний ментальний рятівний кидок цілі (Інт/Мдр/Хар) — з перешкодою, до початку твого наступного ходу.' },

  { id: 'necrotic', name: 'Некротика', school: 'esentsia', degree: 2, cost: 3,
    trigger: 'damageType', damageType: 'necrotic', activation: 'cast', consumesState: false,
    effect: 'Поки ти при свідомості: наступна атака по ворогу в межах 30 фт від тебе лікує тебе на половину завданої нею шкоди (одноразово).' },

  { id: 'radiant', name: 'Радіант', school: 'esentsia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'radiant', activation: 'cast', consumesState: false,
    effect: 'Якщо ти вразив цю ціль радіантом минулого раунду — це закляття кидається з перевагою (або ціль має перешкоду на його рятівний кидок).' },

  { id: 'peak', name: 'Пік', school: 'esentsia', degree: 3, cost: 3,
    trigger: 'damageType', damageType: 'any', activation: 'cast', consumesState: false,
    maxSpellLevel: 5,
    effect: 'Максимізуй усі кості шкоди цього закляття. Лише закляття рівня 5 і нижче.' },

  /* ── Пробій ───────────────────────────────────────────── */
  { id: 'bypass', name: 'Обхід', school: 'probiy', degree: 1, cost: 1,
    trigger: 'spellAttack', activation: 'cast', consumesState: false,
    effect: 'Спел-атака цього касту ігнорує бонус КЗ від щита та укриття цілі.' },

  { id: 'reflection', name: 'Відзеркалення', school: 'probiy', degree: 2, cost: 2,
    trigger: 'touchRange', activation: 'cast', consumesState: false,
    effect: 'Закляття з дальністю «Дотик» отримує дальність зору, якщо ціль видно крізь прозоре чи відбивне (скло, вода, дзеркало).' },

  { id: 'bend', name: 'Вигин', school: 'probiy', degree: 2, cost: 2,
    trigger: 'lineOrRay', activation: 'cast', consumesState: false,
    effect: 'Промінь або лінію можна один раз зігнути під кутом — обійти укриття чи ріг.' },

  { id: 'pressure', name: 'Дотиск', school: 'probiy', degree: 1, cost: 1,
    trigger: 'damagingSpell', activation: 'cast', consumesState: false,
    effect: 'Якщо спел-атака промахнулась або ціль пройшла рятівний кидок — вона однаково отримує половину шкоди закляття.' },

  /* ── Влада ────────────────────────────────────────────── */
  { id: 'suggestion', name: 'Навіювання', school: 'vlada', degree: 1, cost: 2,
    trigger: 'enchantment', activation: 'cast', consumesState: false,
    effect: 'Закляття школи зачарування не має видимого джерела; при успіху ціль не усвідомлює, що була зачарована.' },

  { id: 'countercast', name: 'Контркаст', school: 'vlada', degree: 3, cost: 3,
    trigger: 'enemyCast', activation: 'reaction', consumesState: false,
    effect: 'Реакція на ворожий каст у полі зору: обертаєш це закляття проти його джерела за половину вартості — якщо це саме закляття є в тебе підготовленим або відомим. Змагання характеристики закляття.' },

  { id: 'generous-hand', name: 'Щедра длань', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    effect: 'Кості лікування цього закляття рахуються як максимальні.' },

  { id: 'cleansing', name: 'Очищення', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    effect: 'Якщо кості лікування випали максимумом натурально — закляття додатково знімає з цілі один негативний стан.' },

  /* ── Утримання ────────────────────────────────────────── */
  { id: 'recall', name: 'Відклик', school: 'utrymannia', degree: 1, cost: 1,
    trigger: 'readiedSpell', activation: 'special', consumesState: false,
    effect: 'Прибери закляття зі своїх занотованих дій — комірка при цьому не витрачається.' },

  { id: 'harvest', name: 'Жнива', school: 'utrymannia', degree: 2, cost: 1,
    trigger: 'onKill', activation: 'reaction', consumesState: false,
    effect: 'Коли твоє закляття вбиває ворога, надлишкову шкоду понад його поточні HP переносиш на іншого ворога в межах 15 фт.' },

  { id: 'riposte', name: 'Відсіч', school: 'utrymannia', degree: 2, cost: 4,
    trigger: 'shield', activation: 'reaction', consumesState: false,
    effect: 'Коли твій ward чи щит поглинає шкоду від рукопашної атаки — половина поглиненого повертається нападнику.' },

  { id: 'steadfast', name: 'Незрушність', school: 'utrymannia', degree: 3, cost: 4,
    trigger: 'concentration', activation: 'triggered', consumesState: false,
    effect: 'Коли ти провалюєш кидок на концентрацію, закляття не спадає — тримається ще раунд. Поки цей ефект триває, твоя швидкість зменшена вдвічі.' },

  /* ── Провидіння ───────────────────────────────────────── */
  { id: 'insight', name: 'Прозріння', school: 'provydinnia', degree: 1, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    effect: 'При касті власного закляття дізнаєшся спротиви та імунітети його цілі.' },

  { id: 'premonition', name: 'Передчуття', school: 'provydinnia', degree: 2, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    effect: 'При касті дізнаєшся найслабший рятівний кидок цілі свого закляття.' },

  { id: 'farsight', name: 'Віще око', school: 'provydinnia', degree: 3, cost: 3,
    trigger: 'any', activation: 'cast', consumesState: false,
    effect: 'При касті дізнаєшся конкретне закляття чи дію, яку один ворог у полі зору виконає наступного раунду.' }
];

/* ══════════════════════════════════════════════════════════
   Rules
   ══════════════════════════════════════════════════════════ */

export class MagicManeuvers {

  static byId(id) {
    return MAGIC_MANEUVERS.find(m => m.id === id) ?? null;
  }

  static bySchool(school) {
    return MAGIC_MANEUVERS.filter(m => m.school === school);
  }

  /** Does this class get magic maneuvers at all? */
  static isEligibleClass(className) {
    const key = String(className ?? '').toLowerCase().replace(/[^a-z]/g, '');
    return MM_CLASSES.includes(key);
  }

  /**
   * The progression row in force at a character level — the highest threshold
   * at or below it. Below 3rd there is nothing.
   */
  static progressionAt(level) {
    const lvl = Number(level) || 0;
    let row = null;
    for (const entry of MM_PROGRESSION) {
      if (entry.level <= lvl) row = entry;
    }
    return row ? { ...row } : { level: 0, known: 0, schools: 0, maxDegree: 0 };
  }

  /** Exertion pool shared with combat maneuvers. */
  static exertionPool(proficiencyBonus) {
    return 2 * (Number(proficiencyBonus) || 0);
  }

  /** Save DC for the maneuvers that call for one. */
  static saveDC(proficiencyBonus, spellcastingAbilityMod) {
    return 8 + (Number(proficiencyBonus) || 0) + (Number(spellcastingAbilityMod) || 0);
  }

  /**
   * May this maneuver be LEARNED right now?
   *
   * All three gates are checked here, at learning time. Activation only checks
   * exertion, trigger compatibility and the one-per-cast rule.
   *
   * @param {object} maneuver
   * @param {object} state  { level, openSchools: string[], knownIds: string[] }
   * @returns {{ok: boolean, reason?: string}}
   */
  static canLearn(maneuver, { level = 0, openSchools = [], knownIds = [] } = {}) {
    if (!maneuver) return { ok: false, reason: 'unknown-maneuver' };

    const row = this.progressionAt(level);
    if (row.known <= 0) return { ok: false, reason: 'level-too-low' };

    if (knownIds.includes(maneuver.id)) return { ok: false, reason: 'already-known' };
    if (!openSchools.includes(maneuver.school)) return { ok: false, reason: 'school-not-open' };
    if (maneuver.degree > row.maxDegree)  return { ok: false, reason: 'degree-too-high' };
    if (knownIds.length >= row.known)     return { ok: false, reason: 'no-slots-left' };

    return { ok: true };
  }

  /** May another school be opened at this level? Open schools are permanent. */
  static canOpenSchool(school, { level = 0, openSchools = [] } = {}) {
    if (!MM_SCHOOLS[school])          return { ok: false, reason: 'unknown-school' };
    if (openSchools.includes(school)) return { ok: false, reason: 'already-open' };

    const row = this.progressionAt(level);
    if (openSchools.length >= row.schools) return { ok: false, reason: 'no-school-slots' };
    return { ok: true };
  }

  /**
   * Everything the character could learn right now, for a picker.
   * Maneuvers that fail only on slots are still returned, flagged, so the UI can
   * show why rather than silently hiding them.
   */
  static learnable(state) {
    return MAGIC_MANEUVERS.map(m => {
      const check = this.canLearn(m, state);
      return { ...m, canLearn: check.ok, reason: check.reason ?? null };
    });
  }

  /**
   * Is this maneuver offered for the spell being cast?
   *
   * Note the deliberate rule: a damageType trigger ignores spell level entirely,
   * so a cantrip qualifies exactly like a high-level spell. That is the point —
   * it gives empty slots something to do.
   *
   * @param {object} maneuver
   * @param {object} spell  { damageTypes: string[], heals, isAttack, range,
   *                          shape, school, level, dealsDamage }
   */
  static matchesSpell(maneuver, spell = {}) {
    if (!maneuver) return false;
    const dmg = (spell.damageTypes ?? []).map(d => String(d).toLowerCase());

    switch (maneuver.trigger) {
      case 'damageType':
        if (maneuver.maxSpellLevel && Number(spell.level ?? 0) > maneuver.maxSpellLevel) return false;
        return maneuver.damageType === 'any' ? dmg.length > 0 : dmg.includes(maneuver.damageType);

      case 'healing':       return !!spell.heals;
      case 'spellAttack':   return !!spell.isAttack;
      case 'damagingSpell': return !!spell.dealsDamage || dmg.length > 0;
      case 'touchRange':    return String(spell.range ?? '').toLowerCase() === 'touch';
      case 'lineOrRay':     return ['line', 'ray'].includes(String(spell.shape ?? '').toLowerCase());
      case 'enchantment':   return String(spell.school ?? '').toLowerCase() === 'enchantment';
      case 'any':           return true;

      // Not driven by the caster's own spell shape — these fire on their event
      case 'enemyCast':
      case 'onKill':
      case 'shield':
      case 'concentration':
      case 'readiedSpell':
        return false;

      default: return false;
    }
  }

  /** The ones a given cast can offer, cheapest first. */
  static offeredFor(spell, knownIds = []) {
    return knownIds
      .map(id => this.byId(id))
      .filter(m => m && this.matchesSpell(m, spell))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  }
}
