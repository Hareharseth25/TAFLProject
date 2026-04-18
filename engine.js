/**
 * engine.js — CFG Lab Simplification Engine
 *
 * Implements the full CFG simplification pipeline:
 *   1. Grammar parsing (productions from text input)
 *   2. Nullable symbol computation + null production removal
 *   3. Useless symbol removal (generating + reachable passes)
 *   4. Unit production elimination (unit closure via BFS)
 *   5. Step-by-step trace generation for the walkthrough view
 *   6. Grammar property checks (CNF, has-useless, has-null, etc.)
 *
 * Data model:
 *   Grammar = { start: string, rules: Map<string, string[][]> }
 *   A rule maps a non-terminal (string) to a list of alternatives.
 *   Each alternative is a list of symbols (strings).
 *   Terminal: lowercase first char or quoted, or single char.
 *   Non-terminal: uppercase first char.
 *
 * ε is represented internally as the empty array [].
 */

/* ═══════════════════════════════════════════════════════
   PARSING
═══════════════════════════════════════════════════════ */

/**
 * Parse raw textarea text into a Grammar object.
 * Returns { grammar, errors[] }
 */
function parseGrammar(text, startSym) {
  const errors = [];
  // Map: NT -> list of alternatives (each alternative = symbol array)
  const rules = new Map();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Normalize arrow
    const normalized = line.replace(/→/g, '->').replace(/\s+/g, ' ');
    const arrowIdx = normalized.indexOf('->');
    if (arrowIdx === -1) { errors.push(`Line ${i+1}: missing '->' in "${line}"`); continue; }

    const lhs = normalized.slice(0, arrowIdx).trim();
    const rhsRaw = normalized.slice(arrowIdx + 2).trim();

    if (!/^[A-Z][A-Z0-9']*$/.test(lhs)) {
      errors.push(`Line ${i+1}: LHS "${lhs}" must be an uppercase non-terminal`); continue;
    }

    if (!rules.has(lhs)) rules.set(lhs, []);

    const alternatives = rhsRaw.split('|').map(alt => alt.trim());
    for (const alt of alternatives) {
      if (alt === 'ε' || alt === 'eps' || alt === '') {
        rules.get(lhs).push([]); // empty production
      } else {
        // Tokenise: each uppercase+digits sequence = NT, otherwise each char = terminal
        // Support multi-char terminals in quotes like "abc", else single chars
        const syms = [];
        let j = 0;
        while (j < alt.length) {
          if (alt[j] === ' ') { j++; continue; }
          // Upper-case run = non-terminal
          if (/[A-Z]/.test(alt[j])) {
            let nt = alt[j]; j++;
            while (j < alt.length && /[A-Z0-9']/.test(alt[j])) { nt += alt[j]; j++; }
            syms.push(nt);
          } else if (alt[j] === '"' || alt[j] === "'") {
            const q = alt[j]; j++;
            let tok = '';
            while (j < alt.length && alt[j] !== q) { tok += alt[j]; j++; }
            j++; // closing quote
            syms.push(tok);
          } else {
            // Single terminal character
            syms.push(alt[j]); j++;
          }
        }
        rules.get(lhs).push(syms);
      }
    }
  }

  // Validate start symbol exists
  if (startSym && !rules.has(startSym)) {
    errors.push(`Start symbol "${startSym}" has no production rules`);
  }

  return { grammar: { start: startSym || (rules.size > 0 ? rules.keys().next().value : 'S'), rules }, errors };
}

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */

function isNT(sym) { return /^[A-Z][A-Z0-9']*$/.test(sym); }
function isTerminal(sym) { return !isNT(sym); }

function cloneGrammar(g) {
  const rules = new Map();
  for (const [nt, alts] of g.rules) {
    rules.set(nt, alts.map(alt => [...alt]));
  }
  return { start: g.start, rules };
}

function grammarToLines(g) {
  const lines = [];
  for (const [nt, alts] of g.rules) {
    const rhs = alts.map(alt => alt.length === 0 ? 'ε' : alt.join(' ')).join(' | ');
    lines.push({ lhs: nt, rhs, alts });
  }
  return lines;
}

function altEquals(a, b) {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === b[i]);
}

function removeDuplicateAlts(alts) {
  const seen = new Set();
  return alts.filter(alt => {
    const k = alt.join('\x00');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

/* ═══════════════════════════════════════════════════════
   STEP 1 — NULLABLE SYMBOLS
═══════════════════════════════════════════════════════ */

/**
 * Compute the set of nullable non-terminals:
 * A is nullable if A → ε directly, or A → α where all symbols in α are nullable.
 */
function computeNullable(grammar) {
  const nullable = new Set();

  // Seed: direct ε productions
  for (const [nt, alts] of grammar.rules) {
    for (const alt of alts) {
      if (alt.length === 0) { nullable.add(nt); break; }
    }
  }

  // Fixed-point iteration
  let changed = true;
  while (changed) {
    changed = false;
    for (const [nt, alts] of grammar.rules) {
      if (nullable.has(nt)) continue;
      for (const alt of alts) {
        if (alt.length > 0 && alt.every(s => nullable.has(s))) {
          nullable.add(nt); changed = true; break;
        }
      }
    }
  }
  return nullable;
}

/**
 * Remove null productions.
 * For every production A → α containing nullable vars,
 * generate all combinations with those vars present/absent.
 * Then remove all A → ε (unless S is nullable and we want to keep S → ε).
 *
 * Returns: { grammar, nullable, changes[] }
 */
function removeNullProductions(grammarIn) {
  const grammar = cloneGrammar(grammarIn);
  const nullable = computeNullable(grammar);
  const changes = [];

  const newRules = new Map();

  for (const [nt, alts] of grammar.rules) {
    const expanded = new Set();

    for (const alt of alts) {
      if (alt.length === 0) {
        // ε production — will be removed (handled later)
        changes.push({ type: 'null-removed', lhs: nt, rhs: [] });
        continue;
      }

      // Find positions of nullable symbols
      const nullablePositions = alt.map((s, i) => nullable.has(s) ? i : -1).filter(i => i >= 0);

      // Generate 2^k combinations
      const count = 1 << nullablePositions.length;
      for (let mask = 0; mask < count; mask++) {
        const newAlt = [];
        let ni = 0;
        for (let k = 0; k < alt.length; k++) {
          if (nullablePositions.includes(k)) {
            // bit ni: 1 = include, 0 = omit
            if ((mask >> ni) & 1) newAlt.push(alt[k]);
            ni++;
          } else {
            newAlt.push(alt[k]);
          }
        }
        if (newAlt.length > 0) { // skip the fully-empty one (it's the ε production)
          expanded.add(JSON.stringify(newAlt));
        }
      }
    }

    const newAlts = [...expanded].map(s => JSON.parse(s));
    const deduped = removeDuplicateAlts(newAlts);

    // Track newly added alts
    for (const alt of deduped) {
      const orig = alts.find(a => altEquals(a, alt));
      if (!orig) changes.push({ type: 'null-added', lhs: nt, rhs: alt });
    }

    newRules.set(nt, deduped);
  }

  // Keep S → ε if start is nullable (language includes ε)
  if (nullable.has(grammar.start)) {
    const startAlts = newRules.get(grammar.start) || [];
    // Only add if S doesn't appear on any RHS (to avoid issues), simplified: always keep note
    startAlts.push([]); // S → ε
    newRules.set(grammar.start, removeDuplicateAlts(startAlts));
    changes.push({ type: 'eps-kept', lhs: grammar.start, rhs: [] });
  }

  return { grammar: { start: grammar.start, rules: newRules }, nullable, changes };
}

/* ═══════════════════════════════════════════════════════
   STEP 2 — USELESS SYMBOL REMOVAL
   Pass A: Remove non-generating symbols
   Pass B: Remove unreachable symbols
═══════════════════════════════════════════════════════ */

/**
 * Compute generating non-terminals:
 * A is generating if A can derive some terminal string (possibly ε).
 */
function computeGenerating(grammar) {
  const gen = new Set();

  // Seed: any NT with a production using only terminals (or ε)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [nt, alts] of grammar.rules) {
      if (gen.has(nt)) continue;
      for (const alt of alts) {
        // generating if every symbol in alt is terminal or already generating NT
        if (alt.every(s => isTerminal(s) || gen.has(s))) {
          gen.add(nt); changed = true; break;
        }
      }
    }
  }
  return gen;
}

/**
 * Compute reachable symbols from start.
 */
function computeReachable(grammar) {
  const reachable = new Set([grammar.start]);
  const queue = [grammar.start];
  while (queue.length) {
    const nt = queue.shift();
    const alts = grammar.rules.get(nt) || [];
    for (const alt of alts) {
      for (const sym of alt) {
        if (isNT(sym) && !reachable.has(sym)) {
          reachable.add(sym); queue.push(sym);
        }
      }
    }
  }
  return reachable;
}

/**
 * Remove useless symbols.
 * Returns { grammar, generating, reachable, removedSymbols, changes[] }
 */
function removeUselessSymbols(grammarIn) {
  let grammar = cloneGrammar(grammarIn);
  const changes = [];

  // Pass A: remove non-generating
  const generating = computeGenerating(grammar);
  const nonGenerating = new Set([...grammar.rules.keys()].filter(nt => !generating.has(nt)));

  // Also consider all NTs referenced in RHS
  for (const [, alts] of grammar.rules) {
    for (const alt of alts) {
      for (const sym of alt) {
        if (isNT(sym) && !generating.has(sym)) nonGenerating.add(sym);
      }
    }
  }

  const rulesAfterGenPass = new Map();
  for (const [nt, alts] of grammar.rules) {
    if (!generating.has(nt)) {
      changes.push({ type: 'useless-nt', nt, reason: 'non-generating' });
      continue;
    }
    const filteredAlts = alts.filter(alt => {
      const ok = alt.every(s => isTerminal(s) || generating.has(s));
      if (!ok) changes.push({ type: 'useless-prod', lhs: nt, rhs: alt, reason: 'non-generating symbol in RHS' });
      return ok;
    });
    rulesAfterGenPass.set(nt, filteredAlts);
  }
  grammar = { start: grammar.start, rules: rulesAfterGenPass };

  // Pass B: remove unreachable
  const reachable = computeReachable(grammar);
  const rulesAfterReachPass = new Map();
  for (const [nt, alts] of grammar.rules) {
    if (!reachable.has(nt)) {
      changes.push({ type: 'useless-nt', nt, reason: 'unreachable' });
      continue;
    }
    rulesAfterReachPass.set(nt, alts);
  }
  grammar = { start: grammar.start, rules: rulesAfterReachPass };

  const removedSymbols = [...nonGenerating, ...[...grammar.rules.keys()].filter(nt => !reachable.has(nt))];

  return { grammar, generating, reachable, nonGenerating, removedSymbols, changes };
}

/* ═══════════════════════════════════════════════════════
   STEP 3 — UNIT PRODUCTION ELIMINATION
═══════════════════════════════════════════════════════ */

/**
 * Compute unit pairs: all (A, B) where A ⇒* B via unit productions.
 * A unit production is A → B where B is a single NT.
 */
function computeUnitPairs(grammar) {
  // Start: reflexive closure
  const pairs = new Set();
  const nts = [...grammar.rules.keys()];
  for (const nt of nts) pairs.add(`${nt}|${nt}`);

  // BFS
  let changed = true;
  while (changed) {
    changed = false;
    for (const [nt, alts] of grammar.rules) {
      for (const alt of alts) {
        if (alt.length === 1 && isNT(alt[0])) {
          const B = alt[0];
          // For every (X, A) already in pairs, add (X, B)
          for (const pair of [...pairs]) {
            const [X, A] = pair.split('|');
            if (A === nt && !pairs.has(`${X}|${B}`)) {
              pairs.add(`${X}|${B}`); changed = true;
            }
          }
        }
      }
    }
  }

  // Convert to list of [A, B] tuples
  return [...pairs].map(p => p.split('|'));
}

/**
 * Remove unit productions.
 * Returns { grammar, unitPairs, changes[] }
 */
function removeUnitProductions(grammarIn) {
  const grammar = cloneGrammar(grammarIn);
  const unitPairs = computeUnitPairs(grammar);
  const changes = [];

  const newRules = new Map();
  for (const [nt] of grammar.rules) newRules.set(nt, []);

  // For each (A, B) in unit pairs, add all non-unit productions of B to A
  for (const [A, B] of unitPairs) {
    const Balts = grammar.rules.get(B) || [];
    for (const alt of Balts) {
      // Skip unit productions (single NT) to avoid adding them back
      if (alt.length === 1 && isNT(alt[0])) continue;
      const existing = newRules.get(A) || [];
      const alreadyHas = existing.some(e => altEquals(e, alt));
      if (!alreadyHas) {
        if (!newRules.has(A)) newRules.set(A, []);
        newRules.get(A).push([...alt]);
        if (A !== B) { // Only log if it's actually derived, not trivial
          changes.push({ type: 'unit-added', lhs: A, rhs: alt, via: B });
        }
      }
    }
  }

  // Track removed unit productions
  for (const [nt, alts] of grammar.rules) {
    for (const alt of alts) {
      if (alt.length === 1 && isNT(alt[0])) {
        changes.push({ type: 'unit-removed', lhs: nt, rhs: alt });
      }
    }
  }

  // Deduplicate
  for (const [nt, alts] of newRules) {
    newRules.set(nt, removeDuplicateAlts(alts));
  }

  return { grammar: { start: grammar.start, rules: newRules }, unitPairs, changes };
}

/* ═══════════════════════════════════════════════════════
   FULL PIPELINE
═══════════════════════════════════════════════════════ */

/**
 * Run the full simplification pipeline.
 * Returns a detailed result object with each step's grammar + changes.
 */
function simplifyGrammar(grammarIn) {
  const original = cloneGrammar(grammarIn);

  // Step 1: Remove null productions
  const afterNull = removeNullProductions(original);

  // Step 2: Remove useless symbols
  const afterUseless = removeUselessSymbols(afterNull.grammar);

  // Step 3: Remove unit productions
  const afterUnit = removeUnitProductions(afterUseless.grammar);

  return {
    original,
    step1: { // null productions
      grammar: afterNull.grammar,
      nullable: afterNull.nullable,
      changes: afterNull.changes,
      label: 'After Removing Null Productions'
    },
    step2: { // useless symbols
      grammar: afterUseless.grammar,
      generating: afterUseless.generating,
      reachable: afterUseless.reachable,
      nonGenerating: afterUseless.nonGenerating,
      changes: afterUseless.changes,
      label: 'After Removing Useless Symbols'
    },
    step3: { // unit productions
      grammar: afterUnit.grammar,
      unitPairs: afterUnit.unitPairs,
      changes: afterUnit.changes,
      label: 'After Removing Unit Productions'
    },
    final: afterUnit.grammar
  };
}

/* ═══════════════════════════════════════════════════════
   GRAMMAR CHECKER
═══════════════════════════════════════════════════════ */

function checkGrammar(grammar) {
  const nullable = computeNullable(grammar);
  const generating = computeGenerating(grammar);
  const reachable = computeReachable(grammar);

  const allNTs = new Set(grammar.rules.keys());
  const useless = [...allNTs].filter(nt => !generating.has(nt) || !reachable.has(nt));

  const hasNullProds = [...grammar.rules.values()].some(alts => alts.some(alt => alt.length === 0));
  const hasUnitProds = [...grammar.rules.values()].some(alts =>
    alts.some(alt => alt.length === 1 && isNT(alt[0]))
  );

  // Unit pairs
  const unitPairs = computeUnitPairs(grammar);
  const nonTrivialUnitPairs = unitPairs.filter(([a, b]) => a !== b);

  // CNF check
  let isCNF = true;
  const cnfViolations = [];
  for (const [nt, alts] of grammar.rules) {
    for (const alt of alts) {
      if (alt.length === 0) {
        if (nt === grammar.start) continue; // S → ε is ok
        isCNF = false; cnfViolations.push(`${nt} → ε`);
      } else if (alt.length === 1) {
        if (!isTerminal(alt[0])) { isCNF = false; cnfViolations.push(`${nt} → ${alt[0]}`); }
      } else if (alt.length === 2) {
        if (!isNT(alt[0]) || !isNT(alt[1])) { isCNF = false; cnfViolations.push(`${nt} → ${alt.join(' ')}`); }
      } else {
        isCNF = false; cnfViolations.push(`${nt} → ${alt.join(' ')} (length > 2)`);
      }
    }
  }

  // Collect all terminals
  const terminals = new Set();
  for (const alts of grammar.rules.values()) {
    for (const alt of alts) {
      for (const sym of alt) { if (isTerminal(sym)) terminals.add(sym); }
    }
  }

  return {
    nullable,
    generating,
    reachable,
    useless,
    hasNullProds,
    hasUnitProds,
    unitPairs: nonTrivialUnitPairs,
    isCNF,
    cnfViolations,
    terminals,
    allNTs,
    productionCount: [...grammar.rules.values()].reduce((s, a) => s + a.length, 0),
    variableCount: grammar.rules.size
  };
}

/* ═══════════════════════════════════════════════════════
   STEP-WISE TRACE GENERATOR
   Produces an array of "frames" for the step-by-step view.
   Each frame: { title, phase, explanation, grammar, highlights }
═══════════════════════════════════════════════════════ */

function generateStepTrace(grammarIn) {
  const steps = [];

  const push = (title, phase, explanation, grammar, extraData = {}) => {
    steps.push({ title, phase, explanation, grammar: cloneGrammar(grammar), ...extraData });
  };

  const g0 = cloneGrammar(grammarIn);
  push(
    'Original Grammar',
    'Input',
    `<strong>Starting grammar.</strong> We have ${g0.rules.size} non-terminal(s) with start symbol <code>${g0.start}</code>. We will now apply three simplification passes in order.`,
    g0
  );

  // ── NULL PRODUCTIONS ──────────────────────────────────

  const nullable = computeNullable(g0);
  push(
    'Compute Nullable Variables',
    'Null Productions — Phase 1',
    `<strong>Nullable variables</strong> are those that can derive the empty string ε. 
    We seed the set with any <code>A → ε</code> rule, then add any variable whose every RHS alternative consists entirely of already-nullable variables. 
    ${nullable.size === 0 ? 'No nullable variables found.' : `Found: <code>${[...nullable].join(', ')}</code>`}`,
    g0,
    { nullable }
  );

  const afterNull = removeNullProductions(g0);
  push(
    'Remove Null Productions',
    'Null Productions — Phase 2',
    `For each production containing a nullable variable, we generate all combinations with that variable <em>included</em> and <em>excluded</em>. 
    Then all <code>A → ε</code> rules are removed. 
    ${nullable.has(g0.start) ? `The start symbol <code>${g0.start}</code> is nullable, so <code>${g0.start} → ε</code> is kept.` : ''}
    <strong>Productions modified: ${afterNull.changes.length}</strong>`,
    afterNull.grammar,
    { changes: afterNull.changes, nullable }
  );

  // ── USELESS SYMBOLS ───────────────────────────────────

  const gen = computeGenerating(afterNull.grammar);
  push(
    'Compute Generating Symbols',
    'Useless Symbols — Phase 1',
    `A non-terminal is <strong>generating</strong> if it can derive at least one string of terminals. 
    We iterate: any NT whose every RHS symbol is either a terminal or already-generating is generating. 
    ${gen.size === 0 ? 'No generating variables found!' : `Generating: <code>${[...gen].join(', ')}</code>`}. 
    Non-generating variables will be removed along with any production that contains them.`,
    afterNull.grammar,
    { generating: gen }
  );

  const afterGenPass = (() => {
    const grammar = cloneGrammar(afterNull.grammar);
    const rulesAfter = new Map();
    for (const [nt, alts] of grammar.rules) {
      if (!gen.has(nt)) continue;
      const filtered = alts.filter(alt => alt.every(s => isTerminal(s) || gen.has(s)));
      rulesAfter.set(nt, filtered);
    }
    return { start: grammar.start, rules: rulesAfter };
  })();

  push(
    'Remove Non-Generating Symbols',
    'Useless Symbols — Phase 2',
    `Removed all non-generating non-terminals and any production whose RHS contained a non-generating symbol. 
    Remaining non-terminals: <code>${[...afterGenPass.rules.keys()].join(', ')}</code>.`,
    afterGenPass
  );

  const reach = computeReachable(afterGenPass);
  push(
    'Compute Reachable Symbols',
    'Useless Symbols — Phase 3',
    `A non-terminal is <strong>reachable</strong> if it can appear in a sentential form derived from the start symbol <code>${afterGenPass.start}</code>. 
    We do a BFS from <code>${afterGenPass.start}</code> following all RHS non-terminals. 
    Reachable: <code>${[...reach].join(', ')}</code>.`,
    afterGenPass,
    { reachable: reach }
  );

  const afterUseless = removeUselessSymbols(afterNull.grammar);
  push(
    'Remove Unreachable Symbols',
    'Useless Symbols — Phase 4',
    `Any non-terminal not reachable from <code>${g0.start}</code> is removed along with all its productions. 
    A symbol is <strong>useless</strong> if it is non-generating OR unreachable. 
    <strong>Remaining: ${afterUseless.grammar.rules.size} non-terminal(s)</strong>.`,
    afterUseless.grammar,
    { changes: afterUseless.changes }
  );

  // ── UNIT PRODUCTIONS ──────────────────────────────────

  const unitPairs = computeUnitPairs(afterUseless.grammar);
  const nonTrivial = unitPairs.filter(([a, b]) => a !== b);
  push(
    'Compute Unit Pairs',
    'Unit Productions — Phase 1',
    `A <strong>unit production</strong> is one of the form <code>A → B</code> where B is a single non-terminal. 
    The <strong>unit closure</strong> contains all pairs (A, B) such that A ⇒* B via unit steps only. 
    Non-trivial pairs found: ${nonTrivial.length === 0 ? 'none' : nonTrivial.map(([a,b]) => `(${a}, ${b})`).join(', ')}.`,
    afterUseless.grammar,
    { unitPairs: nonTrivial }
  );

  const afterUnit = removeUnitProductions(afterUseless.grammar);
  push(
    'Eliminate Unit Productions',
    'Unit Productions — Phase 2',
    `For each unit pair (A, B), we copy every <em>non-unit</em> production of B into A. 
    Then all original unit productions are removed. 
    This preserves the language exactly. 
    <strong>Productions after: ${[...afterUnit.grammar.rules.values()].reduce((s,a) => s+a.length, 0)}</strong>.`,
    afterUnit.grammar,
    { changes: afterUnit.changes, unitPairs: nonTrivial }
  );

  push(
    'Simplified Grammar',
    'Result',
    `All three passes complete. The grammar is now free of null productions (except possibly <code>${g0.start} → ε</code>), useless symbols, and unit productions. 
    The language accepted is <strong>identical</strong> to the original grammar.`,
    afterUnit.grammar
  );

  return steps;
}

/* ═══════════════════════════════════════════════════════
   PRESET GRAMMARS
═══════════════════════════════════════════════════════ */
const PRESETS = {
  null: {
    start: 'S',
    text: `S → A B | B C
A → B A | a
B → C C | b
C → A B | ε
D → a b`
  },
  unit: {
    start: 'S',
    text: `S → A | a b
A → B | c
B → C | d
C → e`
  },
  useless: {
    start: 'S',
    text: `S → a B | A B
A → a A | a
B → b B | b
C → a C | D
D → b D`
  },
  complex: {
    start: 'S',
    text: `S → A S B | ε
A → a A | ε
B → B b | ε
C → c C | c`
  },
  chomsky: {
    start: 'S',
    text: `S → A B | a
A → A A | a
B → B B | b`
  }
};

/* Export */
window.CFGEngine = {
  parseGrammar,
  simplifyGrammar,
  checkGrammar,
  generateStepTrace,
  grammarToLines,
  computeNullable,
  computeGenerating,
  computeReachable,
  computeUnitPairs,
  removeNullProductions,
  removeUselessSymbols,
  removeUnitProductions,
  isNT,
  isTerminal,
  cloneGrammar,
  PRESETS
};
