/**
 * app.js — CFG Lab  (Theatre Edition)
 *
 * Key design changes:
 *   • Step-by-step uses a FIXED-HEIGHT theatre stage — no scrolling.
 *     The stage is split: animated dep graph (top) + tabbed panels (bottom).
 *   • Dep graph arrows draw themselves with SVG stroke-dashoffset animation.
 *   • Nodes pulse / bounce on entry, glow on highlight, shake on removal.
 *   • Navigation bar is always visible (sticky bottom).
 *   • Bottom panel has tabs: Reasoning | Grammar | Changes — user picks focus.
 */

/* ═══════════════════════════════════════════════════════
   TAB NAVIGATION
═══════════════════════════════════════════════════════ */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
  });
});

/* ═══════════════════════════════════════════════════════
   PRESET LOADER
═══════════════════════════════════════════════════════ */
document.querySelectorAll('.snippet-btn[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = CFGEngine.PRESETS[btn.dataset.preset];
    if (!preset) return;
    const ta = document.getElementById('grammar-input');
    const si = document.getElementById('start-sym');
    if (ta) ta.value = preset.text;
    if (si) si.value = preset.start;
    document.getElementById('input-error').style.display = 'none';
    clearValidationState('grammar-input');
    document.getElementById('results-col').innerHTML = `<div class="results-placeholder">
      <div class="placeholder-icon">G</div>
      <div class="placeholder-title">Grammar loaded</div>
      <div class="placeholder-sub">Click Simplify Grammar to run</div></div>`;
  });
});

/* ═══════════════════════════════════════════════════════
   INPUT VALIDATION
═══════════════════════════════════════════════════════ */
const VALIDATION_RULES = {
  startSymbol: v => {
    if (!v || !v.trim()) return 'Start symbol cannot be empty — use a capital letter like S.';
    if (!/^[A-Z][A-Z0-9']*$/.test(v.trim())) return `"${v}" is invalid. Non-terminals must start with uppercase A–Z.`;
    return null;
  },
  grammar: (text, startSym) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    if (!lines.length) return 'Grammar is empty. Enter at least one production, e.g.  S → a b';
    const errors = [], seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const norm = lines[i].replace(/→/g, '->').replace(/\s+/g, ' ');
      const ai = norm.indexOf('->');
      if (ai === -1) { errors.push(`Line ${i+1}: Missing arrow →.  Got: "${lines[i]}"`); continue; }
      const lhs = norm.slice(0, ai).trim(), rhs = norm.slice(ai+2).trim();
      if (!lhs) { errors.push(`Line ${i+1}: Nothing left of arrow.`); continue; }
      if (!/^[A-Z][A-Z0-9']*$/.test(lhs)) { errors.push(`Line ${i+1}: LHS "${lhs}" must be uppercase non-terminal.`); continue; }
      if (!rhs) { errors.push(`Line ${i+1}: RHS of "${lhs} →" is empty.`); continue; }
      seen.add(lhs);
    }
    if (startSym && !seen.has(startSym) && lines.length && !errors.length)
      errors.push(`Start symbol "${startSym}" has no rule. Add  ${startSym} → ...`);
    return errors.length ? errors.join('\n') : null;
  }
};

function clearValidationState(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('input-valid','input-invalid');
}
function showInputFeedback(id, ok, msg) {
  const el = document.getElementById(id); if (!el) return;
  el.classList.toggle('input-valid', ok); el.classList.toggle('input-invalid', !ok);
  let h = el.parentElement.querySelector('.input-hint');
  if (!h) { h = document.createElement('div'); h.className='input-hint'; el.parentElement.appendChild(h); }
  h.className = ok ? 'input-hint hint-ok' : 'input-hint hint-err';
  h.textContent = msg || (ok ? '✓' : 'Invalid');
}
function removeInputHints(cid) {
  const c = document.getElementById(cid); if (!c) return;
  c.querySelectorAll('.input-hint').forEach(h=>h.remove());
  c.querySelectorAll('.text-input,.grammar-textarea').forEach(e=>e.classList.remove('input-valid','input-invalid'));
}

let _vTimer = null;
function attachLiveValidation(taId, sId) {
  const ta = document.getElementById(taId), se = document.getElementById(sId);
  if (!ta||!se) return;
  const go = () => { clearTimeout(_vTimer); _vTimer = setTimeout(() => {
    const t=ta.value.trim(), s=se.value.trim();
    if (!t) { clearValidationState(taId); return; }
    const se2 = VALIDATION_RULES.startSymbol(s);
    if (se2) { showInputFeedback(sId,false,se2); return; }
    showInputFeedback(sId,true,'✓');
    const ge = VALIDATION_RULES.grammar(t,s);
    if (ge) showInputFeedback(taId,false,ge.split('\n')[0]);
    else { const n=t.split('\n').filter(l=>l.trim()).length; showInputFeedback(taId,true,`✓ ${n} line${n!==1?'s':''} — valid`); }
  }, 400); };
  ta.addEventListener('input', go); se.addEventListener('input', go);
}
attachLiveValidation('grammar-input','start-sym');
attachLiveValidation('step-grammar','step-start');
attachLiveValidation('chk-grammar','chk-start');

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function renderSymbol(sym, nullable, unitNTs) {
  if (!sym||sym==='') return '<span style="color:var(--amber);">ε</span>';
  if (nullable&&nullable.has(sym)) return `<span class="nullable-sym">${esc(sym)}</span>`;
  if (unitNTs&&unitNTs.has(sym)) return `<span class="unit-sym">${esc(sym)}</span>`;
  if (CFGEngine.isTerminal(sym)) return `<span class="terminal">${esc(sym)}</span>`;
  return `<span>${esc(sym)}</span>`;
}
function renderAlt(alt, nullable, unitNTs) {
  if (!alt.length) return '<span style="color:var(--amber);font-style:italic;">ε</span>';
  return alt.map(s=>renderSymbol(s,nullable,unitNTs)).join(' ');
}
function renderSymSet(label, syms, pillClass) {
  if (!syms||!syms.size) return '';
  return `<div class="sym-set-row"><span class="sym-set-label">${label}</span>${[...syms].map(s=>`<span class="sym-pill ${pillClass}">${esc(s)}</span>`).join('')}</div>`;
}
function renderGrammarBlock(grammar, opts={}) {
  const {title='Grammar',badge=null,badgeClass='badge-count',highlights={},nullable=null,unitNTs=null,borderClass=''} = opts;
  const pc = [...grammar.rules.values()].reduce((s,a)=>s+a.length,0);
  let h = `<div class="grammar-block ${borderClass}"><div class="grammar-block-header">
    <span class="grammar-block-title">${esc(title)}</span>
    <div style="display:flex;gap:6px;align-items:center;">
      <span class="grammar-block-badge badge-count">${grammar.rules.size} vars · ${pc} prods</span>
      ${badge?`<span class="grammar-block-badge ${badgeClass}">${esc(badge)}</span>`:''}
    </div></div><div class="prod-list">`;
  for (const [nt, alts] of grammar.rules) {
    if (!alts.length) { h+=`<div class="prod-line" style="opacity:.3"><span class="prod-lhs">${esc(nt)}</span><span class="prod-arrow">→</span><span class="prod-rhs" style="color:var(--text3);">(no productions)</span></div>`; continue; }
    const rc = alts.map((_,i)=>highlights[`${nt}|${i}`]||'').find(c=>c)||'';
    const tm = {added:'<span class="prod-tag tag-added">+ new</span>',removed:'<span class="prod-tag tag-removed">removed</span>',unit:'<span class="prod-tag tag-unit">unit</span>',null:'<span class="prod-tag tag-null">ε-prod</span>'};
    const rhs = alts.map(a=>renderAlt(a,nullable,unitNTs)).join('<span class="prod-pipe"> | </span>');
    h+=`<div class="prod-line ${rc}"><span class="prod-lhs">${esc(nt)}</span><span class="prod-arrow">→</span><span class="prod-rhs prod-rhs-inline">${rhs}</span>${tm[rc]||''}</div>`;
  }
  return h+'</div></div>';
}

/* ═══════════════════════════════════════════════════════
   ANIMATED DEPENDENCY GRAPH
   Nodes bounce in on entry, arrows draw themselves,
   highlighted edges glow and pulse.
═══════════════════════════════════════════════════════ */
function buildDepEdges(grammar) {
  const edges=[], em={};
  for (const [nt, alts] of grammar.rules) {
    for (const alt of alts) {
      if (!alt.length) {
        const k=`${nt}|__eps`; if (!em[k]) { em[k]={from:nt,to:null,eps:true}; edges.push(em[k]); }
      }
      const seen=new Set();
      for (const sym of alt) {
        if (CFGEngine.isNT(sym)&&!seen.has(sym)) {
          seen.add(sym); const k=`${nt}|${sym}`;
          if (!em[k]) { em[k]={from:nt,to:sym,labels:[]}; edges.push(em[k]); }
          em[k].labels.push(alt.length?alt.join(' '):'ε');
        }
      }
    }
  }
  return edges;
}

function computeLayout(nts, grammar, W, H) {
  const pos={}, n=nts.length;
  if (!n) return pos;
  if (n===1) { pos[nts[0]]={x:W/2,y:H/2}; return pos; }
  const start=grammar.start, depth={}, q=[start];
  depth[start]=0; let maxD=0;
  while (q.length) {
    const cur=q.shift();
    for (const alt of (grammar.rules.get(cur)||[])) for (const sym of alt)
      if (CFGEngine.isNT(sym)&&depth[sym]===undefined) { depth[sym]=depth[cur]+1; maxD=Math.max(maxD,depth[sym]); q.push(sym); }
  }
  for (const nt of nts) if (depth[nt]===undefined) depth[nt]=maxD+1;
  const layers={};
  for (const nt of nts) { const d=depth[nt]; if (!layers[d]) layers[d]=[]; layers[d].push(nt); }
  const lk=Object.keys(layers).map(Number).sort((a,b)=>a-b), tl=lk.length;
  const px=68, py=55;
  lk.forEach((d,li) => {
    const g=layers[d], y=tl===1?H/2:py+(li/(tl-1))*(H-py*2);
    g.forEach((nt,i) => { pos[nt]={x:g.length===1?W/2:px+(i/(g.length-1))*(W-px*2), y}; });
  });
  return pos;
}

const NC = {
  nullable:  {stroke:'#FBBF24',fill:'rgba(251,191,36,.15)', glow:'rgba(251,191,36,.5)', arr:'#FBBF24'},
  generating:{stroke:'#34D399',fill:'rgba(52,211,153,.15)', glow:'rgba(52,211,153,.5)',  arr:'#34D399'},
  reachable: {stroke:'#34D399',fill:'rgba(52,211,153,.15)', glow:'rgba(52,211,153,.5)',  arr:'#34D399'},
  useless:   {stroke:'#FB7185',fill:'rgba(251,113,133,.15)',glow:'rgba(251,113,133,.5)', arr:'#FB7185'},
  removed:   {stroke:'#FB7185',fill:'rgba(251,113,133,.15)',glow:'rgba(251,113,133,.5)', arr:'#FB7185'},
  unit:      {stroke:'#C084FC',fill:'rgba(192,132,252,.15)',glow:'rgba(192,132,252,.5)', arr:'#C084FC'},
  start:     {stroke:'#A78BFA',fill:'rgba(167,139,250,.2)', glow:'rgba(167,139,250,.55)',arr:'#A78BFA'},
  normal:    {stroke:'rgba(255,255,255,.35)',fill:'rgba(255,255,255,.05)',glow:null,      arr:'rgba(255,255,255,.3)'}
};

function renderAnimatedDepGraph(grammar, opts={}) {
  const {title='', highlight={}, startSymbol=grammar.start, animDelay=0} = opts;
  const nts=[...grammar.rules.keys()];
  if (!nts.length) return '<div class="dep-graph-empty">No non-terminals.</div>';

  const W=560, H=nts.length<=2?160:nts.length<=3?200:nts.length<=5?240:nts.length<=7?280:310;
  const NR=30, pos=computeLayout(nts,grammar,W,H), edges=buildDepEdges(grammar);
  const uid=Math.random().toString(36).slice(2,8);

  const markerCols={norm:'rgba(255,255,255,.35)',acc:'#A78BFA',grn:'#34D399',amb:'#FBBF24',red:'#FB7185',pur:'#C084FC'};

  let defs=`<defs>
    <filter id="glow-sm-${uid}"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="glow-lg-${uid}"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  for (const [mk,mc] of Object.entries(markerCols))
    defs+=`<marker id="arr-${mk}-${uid}" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><polygon points="0 0,10 4,0 8" fill="${mc}"/></marker>`;
  defs+=`</defs>`;

  let svgE='', svgN='';
  let edgeIdx=0;

  // ── edges ──
  for (const edge of edges) {
    if (!edge.to||!pos[edge.from]||!pos[edge.to]) continue;
    const {x:x1,y:y1}=pos[edge.from], {x:x2,y:y2}=pos[edge.to];
    const isSelf=edge.from===edge.to;
    const fromHl=highlight[edge.from], toHl=highlight[edge.to], isHl=!!(fromHl||toHl);
    let mk='norm';
    if (isHl) { const ht=fromHl||toHl; mk=ht==='nullable'?'amb':ht==='generating'||ht==='reachable'?'grn':ht==='useless'||ht==='removed'?'red':ht==='unit'?'pur':'acc'; }
    const sc=NC[fromHl||toHl||'normal'].arr, sw=isHl?2.5:1.5;
    const delay=(animDelay+edgeIdx*80)+'ms';
    edgeIdx++;

    if (isSelf) {
      const lx=x1,ly=y1-NR;
      const pathD=`M${lx-14},${ly+3} C${lx-32},${ly-38} ${lx+32},${ly-38} ${lx+14},${ly+3}`;
      svgE+=`<path class="dep-edge${isHl?' dep-edge-hl':''}" d="${pathD}" fill="none" stroke="${sc}" stroke-width="${sw}"
        marker-end="url(#arr-${mk}-${uid})" style="animation-delay:${delay}"/>`;
      continue;
    }
    const dx=x2-x1,dy=y2-y1,dist=Math.sqrt(dx*dx+dy*dy)||1;
    const cf=Math.min(60,dist*.32), nx=-dy/dist, ny=dx/dist;
    const mx=(x1+x2)/2+nx*cf, my=(y1+y2)/2+ny*cf;
    const qdx=x2-mx,qdy=y2-my,qd=Math.sqrt(qdx*qdx+qdy*qdy)||1;
    const ex=x2-(qdx/qd)*NR, ey=y2-(qdy/qd)*NR;
    const pathD=`M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
    // Compute approx path length for dash animation
    const approxLen=Math.sqrt((ex-x1)**2+(ey-y1)**2)*1.2;
    svgE+=`<path class="dep-edge${isHl?' dep-edge-hl':''}" d="${pathD}" fill="none" stroke="${sc}" stroke-width="${sw}"
      marker-end="url(#arr-${mk}-${uid})"
      style="stroke-dasharray:${approxLen.toFixed(0)};stroke-dashoffset:${approxLen.toFixed(0)};animation:drawEdge .6s ease forwards;animation-delay:${delay}"/>`;
    if (isHl&&edge.labels&&edge.labels[0]) {
      const t=.4,lx2=(1-t)*(1-t)*x1+2*(1-t)*t*mx+t*t*ex,ly2=(1-t)*(1-t)*y1+2*(1-t)*t*my+t*t*ey-7;
      svgE+=`<text x="${lx2.toFixed(1)}" y="${ly2.toFixed(1)}" text-anchor="middle" font-size="9" fill="${sc}" font-family="'Fira Code',monospace" opacity=".9">${esc(edge.labels[0].slice(0,12)+(edge.labels[0].length>12?'…':''))}</text>`;
    }
  }

  // ── nodes ──
  let nodeIdx=0;
  for (const nt of nts) {
    const {x,y}=pos[nt];
    const hlType=highlight[nt]||(nt===startSymbol?'start':'normal');
    const c=NC[hlType]||NC.normal;
    const isStart=nt===startSymbol, isNull=grammar.rules.get(nt)?.some(a=>!a.length);
    const hasGlow=hlType!=='normal';
    const delay=(animDelay+nodeIdx*120)+'ms';
    const animClass=hlType==='removed'||hlType==='useless'?'dep-node-shake':hlType==='nullable'?'dep-node-pulse':'dep-node-bounce';
    nodeIdx++;

    if (hasGlow&&c.glow)
      svgN+=`<circle cx="${x}" cy="${y}" r="${NR+12}" fill="${c.glow}" opacity=".12" filter="url(#glow-lg-${uid})"/>`;
    if (isStart)
      svgN+=`<circle cx="${x}" cy="${y}" r="${NR+7}" fill="none" stroke="${c.stroke}" stroke-width="1.5" opacity=".4" stroke-dasharray="5 4"/>`;
    svgN+=`<circle class="dep-node ${animClass}" cx="${x}" cy="${y}" r="${NR}"
      fill="${c.fill}" stroke="${c.stroke}" stroke-width="${isStart?3:2}"
      ${hasGlow?`filter="url(#glow-sm-${uid})"`:''}
      style="animation-delay:${delay}"/>`;
    if (isNull) {
      const bx=x+NR-5,by=y-NR+5;
      svgN+=`<circle cx="${bx}" cy="${by}" r="10" fill="rgba(251,191,36,.25)" stroke="#FBBF24" stroke-width="1.5"/>
        <text x="${bx}" y="${by}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#FBBF24" font-family="'Fira Code',monospace" font-weight="700">ε</text>`;
    }
    const fs=nt.length>2?12:nt.length>1?15:18;
    svgN+=`<text class="dep-node-label" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
      font-size="${fs}" font-weight="800" fill="${c.stroke}" font-family="'Fira Code',monospace"
      style="animation-delay:${delay}">${esc(nt)}</text>`;
  }

  // legend
  const hlVals=new Set(Object.values(highlight));
  const legDefs=[['nullable','#FBBF24','nullable (→ ε)'],['generating','#34D399','generating'],['reachable','#34D399','reachable'],['useless','#FB7185','useless'],['removed','#FB7185','removed'],['unit','#C084FC','unit pair']];
  const shown=new Set();
  let leg='<div class="dg-legend">';
  for (const [t,c,l] of legDefs) if (hlVals.has(t)&&!shown.has(l)) { shown.add(l); leg+=`<span class="dg-leg-item"><span class="dg-swatch" style="background:${c}"></span>${l}</span>`; }
  leg+=`<span class="dg-leg-item"><span class="dg-swatch dg-swatch-ring"></span>start</span>`;
  leg+=`<span class="dg-leg-item"><span class="dg-swatch" style="background:#FBBF24;opacity:.7"></span>ε badge</span>`;
  leg+='</div>';

  return `<div class="dep-stage-graph">
    <div class="dep-stage-title">${esc(title)}</div>
    <svg viewBox="0 0 ${W} ${H}" class="dep-svg-stage" xmlns="http://www.w3.org/2000/svg">
      ${defs}<g>${svgE}</g><g>${svgN}</g>
    </svg>${leg}</div>`;
}

/* ═══════════════════════════════════════════════════════
   REASONING PANELS
═══════════════════════════════════════════════════════ */
function rBox(icon,head,body) {
  return `<div class="r-box"><div class="r-icon">${icon}</div><div class="r-body"><div class="r-head">${head}</div><div class="r-text">${body}</div></div></div>`;
}
function callout(label,text) {
  return `<div class="r-callout"><span class="rc-lbl">${label}</span><span class="rc-txt">${text}</span></div>`;
}

function getStepReasoning(step, allSteps) {
  const phase=step.phase||'', orig=allSteps&&allSteps[0]?allSteps[0].grammar:step.grammar;

  if (phase==='Input') return rBox('📖','What is this grammar?',
    `A <strong>Context-Free Grammar (CFG)</strong> is a set of rewriting rules for a language.
    <br><br><strong>Non-terminals</strong> (UPPERCASE) are placeholders. <strong>Terminals</strong> (lowercase) are real characters. The <strong>start symbol</strong> <code>${step.grammar.start}</code> is where every derivation begins.
    <br><br>We will apply <strong>3 simplification passes</strong> — null productions, useless symbols, unit productions — without changing what strings the grammar accepts.
    <br>${callout('Key idea','Two grammars are equivalent if they generate the same strings. All our steps preserve equivalence.')}`);

  if (phase==='Null Productions — Phase 1') {
    if (!step.nullable||!step.nullable.size) return rBox('💡','No nullable variables found',
      `A <strong>nullable variable</strong> can derive the empty string ε. This grammar has none, so the next step makes no changes.
      <br>${callout('Algorithm','Seed with A→ε rules, then add any NT whose entire RHS is nullable. Repeat.')}`);
    const list=[...step.nullable].map(n=>`<code>${n}</code>`).join(', ');
    return rBox('💡','Finding nullable variables',
      `A variable is <strong>nullable</strong> if it can eventually produce ε (empty string).
      <br><br>Found nullable: <strong>${list}</strong>.
      <br><br><ol><li>Seed: any variable with a direct <code>A → ε</code> rule.</li><li>Add any variable whose whole RHS consists of nullable symbols.</li><li>Repeat until no change.</li></ol>
      <br>${callout('What happens next','For every production containing these variables, we create both "with" and "without" versions.')}`);
  }

  if (phase==='Null Productions — Phase 2') {
    const removed=(step.changes||[]).filter(c=>c.type==='null-removed').length;
    const added=(step.changes||[]).filter(c=>c.type==='null-added').length;
    if (!step.nullable||!step.nullable.size) return rBox('✂️','No null productions to remove','No nullable variables existed — this step is skipped.');
    return rBox('✂️','Removing null productions',
      `For every production containing a nullable variable <strong>X</strong>, we generate two alternatives — one <em>with</em> X, one <em>without</em>. Then we delete all A→ε rules.
      <br><br>Result: <strong>${removed}</strong> ε-rule${removed!==1?'s':''} removed, <strong>${added}</strong> new rule${added!==1?'s':''} added.
      <br>${callout('Language effect','Same strings generated — except ε is removed unless the start symbol was nullable.')}`);
  }

  if (phase==='Useless Symbols — Phase 1') return rBox('🔍','Finding generating variables',
    `A variable is <strong>generating</strong> if it can eventually produce a string of only terminals (a real word).
    <br><br><ol><li>Base: any NT that directly produces terminals is generating.</li><li>Inductive: A is generating if any of its RHS alternatives consists entirely of terminals or already-generating NTs.</li><li>Repeat to fixpoint.</li></ol>
    <br>Generating: <strong>${step.generating?[...step.generating].map(n=>`<code>${n}</code>`).join(', '):'none'}</strong>.
    <br>${callout('Non-generating = dead end','If a variable can never reach a terminal string, it will be removed next.')}`);

  if (phase==='Useless Symbols — Phase 2') {
    const rem=(step.changes||[]).filter(c=>c.type==='useless-nt'&&c.reason==='non-generating').map(c=>c.nt);
    if (!rem.length) return rBox('🗑️','All variables are generating','Every non-terminal can reach a terminal string — nothing removed here.');
    return rBox('🗑️','Removing non-generating variables',
      `<strong>${rem.map(n=>`<code>${n}</code>`).join(', ')}</strong> can never produce a terminal string — they are dead ends.
      <br><br>We remove: their rules, plus any production referencing them.
      <br>${callout('Why safe','These rules could never participate in a valid derivation anyway.')}`);
  }

  if (phase==='Useless Symbols — Phase 3') return rBox('🗺️','Finding reachable variables',
    `A variable is <strong>reachable</strong> if it can appear in a sentential form derived from start symbol <code>${orig.start}</code>.
    <br><br>BFS from <code>${orig.start}</code>: follow arrows in the dependency graph. Every NT you can reach is reachable.
    <br><br>Reachable: <strong>${step.reachable?[...step.reachable].map(n=>`<code>${n}</code>`).join(', '):'none'}</strong>.
    <br>${callout('See the graph','The dep graph above shows exactly this — trace paths from the start node.')}`);

  if (phase==='Useless Symbols — Phase 4') {
    const rem=(step.changes||[]).filter(c=>c.type==='useless-nt'&&c.reason==='unreachable').map(c=>c.nt);
    if (!rem.length) return rBox('🗑️','All variables are reachable','Every variable is accessible from the start symbol — nothing removed.');
    return rBox('🗑️','Removing unreachable variables',
      `<strong>${rem.map(n=>`<code>${n}</code>`).join(', ')}</strong> can never be reached from <code>${orig.start}</code>.
      <br><br>A <strong>useless symbol</strong> is either non-generating or unreachable. Removing them leaves only useful symbols.
      <br>${callout('Result','Every remaining variable is both generating and reachable.')}`);
  }

  if (phase==='Unit Productions — Phase 1') {
    if (!step.unitPairs||!step.unitPairs.length) return rBox('🔗','No unit productions',`A unit production is <code>A → B</code> (single NT on RHS). None found here — this step is skipped.`);
    const ps=step.unitPairs.map(([a,b])=>`(${a}⇒*${b})`).join(', ');
    return rBox('🔗','Computing the unit closure',
      `A <strong>unit production</strong> is <code>A → B</code> — "A is just another name for B". Chains create indirection.
      <br><br>The <strong>unit closure</strong> finds all (A,B) pairs reachable via unit steps: <strong>${ps}</strong>.
      <br><br><ol><li>Start with (A,A) for all A (reflexive).</li><li>For each A→B unit rule and pair (X,A), add (X,B).</li><li>Repeat.</li></ol>
      <br>${callout('Next','Copy all non-unit rules of B into A for each pair, then delete unit rules.')}`);
  }

  if (phase==='Unit Productions — Phase 2') {
    const added=(step.changes||[]).filter(c=>c.type==='unit-added').length;
    const removed=(step.changes||[]).filter(c=>c.type==='unit-removed').length;
    if (!step.unitPairs||!step.unitPairs.length) return rBox('✂️','No unit productions to remove','Nothing to do here.');
    return rBox('✂️','Eliminating unit productions',
      `For each unit pair (A,B), copy every <em>non-unit</em> production of B into A. Then delete all unit rules.
      <br><br><strong>${added}</strong> rule${added!==1?'s':''} added, <strong>${removed}</strong> unit rule${removed!==1?'s':''} deleted.
      <br>${callout('Language preserved','Every string derivable before is still derivable. We just removed the indirection.')}`);
  }

  if (phase==='Result') {
    const oV=orig.rules.size, fV=step.grammar.rules.size;
    const oP=[...orig.rules.values()].reduce((s,a)=>s+a.length,0);
    const fP=[...step.grammar.rules.values()].reduce((s,a)=>s+a.length,0);
    return rBox('🎉','Simplification complete!',
      `All 3 passes done. The grammar generates <strong>exactly the same language</strong>.
      <br><br>
      <table class="r-table"><thead><tr><th>Metric</th><th>Before</th><th>After</th></tr></thead><tbody>
      <tr><td>Non-terminals</td><td>${oV}</td><td><strong style="color:var(--green)">${fV}</strong></td></tr>
      <tr><td>Productions</td><td>${oP}</td><td><strong style="color:var(--green)">${fP}</strong></td></tr>
      </tbody></table>
      <br>
      <ul><li>Free of ε-productions</li><li>Free of useless symbols</li><li>Free of unit productions</li></ul>
      <br>${callout('Next steps','Ready for Chomsky Normal Form conversion or CYK parsing.')}`);
  }
  return '';
}

/* ═══════════════════════════════════════════════════════
   SIMPLIFIER
═══════════════════════════════════════════════════════ */
function clearAll() {
  document.getElementById('grammar-input').value='';
  document.getElementById('start-sym').value='S';
  document.getElementById('input-error').style.display='none';
  removeInputHints('tab-simplifier');
  document.getElementById('results-col').innerHTML=`<div class="results-placeholder">
    <div class="placeholder-icon">G</div>
    <div class="placeholder-title">Results will appear here</div>
    <div class="placeholder-sub">Enter a grammar and click Simplify</div></div>`;
}

function renderChanges(changes) {
  if (!changes||!changes.length) return '';
  let h=`<div class="grammar-block" style="margin-top:0"><div class="grammar-block-header"><span class="grammar-block-title">Changes</span><span class="grammar-block-badge badge-count">${changes.length}</span></div><div class="prod-list">`;
  for (const ch of changes) {
    const r=ch.rhs&&ch.rhs.length?ch.rhs.join(' '):'ε';
    if (ch.type==='null-removed') h+=`<div class="prod-line removed"><span class="prod-lhs">${esc(ch.lhs)}</span><span class="prod-arrow">→</span><span class="prod-rhs">ε</span><span class="prod-tag tag-removed">ε removed</span></div>`;
    else if (ch.type==='null-added') h+=`<div class="prod-line added"><span class="prod-lhs">${esc(ch.lhs)}</span><span class="prod-arrow">→</span><span class="prod-rhs">${esc(r)}</span><span class="prod-tag tag-added">generated</span></div>`;
    else if (ch.type==='eps-kept') h+=`<div class="prod-line"><span class="prod-lhs">${esc(ch.lhs)}</span><span class="prod-arrow">→</span><span class="prod-rhs" style="color:var(--amber)">ε</span><span class="prod-tag" style="background:var(--amber-bg);color:var(--amber)">kept</span></div>`;
    else if (ch.type==='useless-nt') h+=`<div class="prod-line removed"><span class="prod-lhs" style="color:var(--red)">${esc(ch.nt)}</span><span class="prod-arrow">—</span><span class="prod-rhs" style="color:var(--text3)">all rules</span><span class="prod-tag tag-removed">${esc(ch.reason)}</span></div>`;
    else if (ch.type==='useless-prod') h+=`<div class="prod-line removed"><span class="prod-lhs">${esc(ch.lhs)}</span><span class="prod-arrow">→</span><span class="prod-rhs">${esc(ch.rhs.join(' '))}</span><span class="prod-tag tag-removed">${esc(ch.reason)}</span></div>`;
    else if (ch.type==='unit-removed') h+=`<div class="prod-line removed"><span class="prod-lhs">${esc(ch.lhs)}</span><span class="prod-arrow">→</span><span class="prod-rhs">${esc(r)}</span><span class="prod-tag tag-unit">unit removed</span></div>`;
    else if (ch.type==='unit-added') h+=`<div class="prod-line added"><span class="prod-lhs">${esc(ch.lhs)}</span><span class="prod-arrow">→</span><span class="prod-rhs">${esc(r)}</span><span class="prod-tag tag-added">via ${esc(ch.via)}</span></div>`;
  }
  return h+'</div></div>';
}

function runSimplification() {
  const text=document.getElementById('grammar-input').value;
  const startSym=document.getElementById('start-sym').value.trim()||'S';
  const errDiv=document.getElementById('input-error'), rc=document.getElementById('results-col');
  errDiv.style.display='none';
  const se=VALIDATION_RULES.startSymbol(startSym);
  if (se) { errDiv.textContent=se; errDiv.style.display='block'; showInputFeedback('start-sym',false,se); return; }
  const ge=VALIDATION_RULES.grammar(text,startSym);
  if (ge) { errDiv.textContent=ge; errDiv.style.display='block'; showInputFeedback('grammar-input',false,ge.split('\n')[0]); return; }
  const {grammar,errors}=CFGEngine.parseGrammar(text,startSym);
  if (errors.length) { errDiv.textContent=errors.join('\n'); errDiv.style.display='block'; return; }
  showInputFeedback('grammar-input',true,'✓ Parsed'); showInputFeedback('start-sym',true,'✓');
  const res=CFGEngine.simplifyGrammar(grammar);
  const oP=[...res.original.rules.values()].reduce((s,a)=>s+a.length,0);
  const fP=[...res.final.rules.values()].reduce((s,a)=>s+a.length,0);
  const nC=res.step1.changes.filter(c=>c.type==='null-removed').length;
  const uN=res.step2.changes.filter(c=>c.type==='useless-nt').length;
  const uR=res.step3.changes.filter(c=>c.type==='unit-removed').length;
  let h=`<div class="summary-row">
    <div class="summary-card"><div class="summary-num">${res.original.rules.size}</div><div class="summary-lbl">Orig vars</div></div>
    <div class="summary-card"><div class="summary-num green">${res.final.rules.size}</div><div class="summary-lbl">Final vars</div></div>
    <div class="summary-card"><div class="summary-num">${oP}</div><div class="summary-lbl">Orig prods</div></div>
    <div class="summary-card"><div class="summary-num green">${fP}</div><div class="summary-lbl">Final prods</div></div>
    <div class="summary-card"><div class="summary-num amber">${nC}</div><div class="summary-lbl">ε removed</div></div>
    <div class="summary-card"><div class="summary-num red">${uN}</div><div class="summary-lbl">Useless</div></div>
    <div class="summary-card"><div class="summary-num amber">${uR}</div><div class="summary-lbl">Units removed</div></div>
  </div>`;
  const nullHl={};for(const nt of res.step1.nullable)nullHl[nt]='nullable';
  const remNTs=res.step2.changes.filter(c=>c.type==='useless-nt').map(c=>c.nt);
  const uHl={};for(const[nt]of res.step2.grammar.rules)if(res.step2.generating.has(nt))uHl[nt]='generating';
  for(const nt of remNTs)uHl[nt]='removed';
  const ntPairs=res.step3.unitPairs.filter(([a,b])=>a!==b);
  const unitHl={};for(const[a,b]of ntPairs){unitHl[a]='unit';unitHl[b]='unit';}
  const reachHl=Object.fromEntries([...res.step2.reachable].map(n=>[n,'reachable']));

  h+=renderGrammarBlock(res.original,{title:'Original Grammar',borderClass:'step-original'});
  h+=renderAnimatedDepGraph(res.original,{title:'Original Grammar — Dependency Graph',startSymbol:res.original.start});
  h+=`<div class="grammar-block step-info"><div class="grammar-block-header"><span class="grammar-block-title">Step 1 — Null Productions</span><span class="grammar-block-badge badge-amber">Nullable: {${[...res.step1.nullable].join(', ')||'—'}}</span></div>${renderSymSet('Nullable',res.step1.nullable,'nullable-pill')}</div>`;
  h+=renderGrammarBlock(res.step1.grammar,{title:res.step1.label,borderClass:'step-after',badge:`${nC} ε-prods removed`,badgeClass:'badge-amber'});
  h+=renderAnimatedDepGraph(res.step1.grammar,{title:'After Null Removal',highlight:nullHl,startSymbol:res.original.start});
  h+=`<div class="grammar-block step-info"><div class="grammar-block-header"><span class="grammar-block-title">Step 2 — Useless Symbols</span><span class="grammar-block-badge badge-red">${remNTs.length} removed</span></div>${renderSymSet('Generating',res.step2.generating,'kept-pill')}${renderSymSet('Reachable',res.step2.reachable,'kept-pill')}${remNTs.length?renderSymSet('Removed',new Set(remNTs),'removed-pill'):''}</div>`;
  h+=renderGrammarBlock(res.step2.grammar,{title:res.step2.label,borderClass:'step-after',badge:`${remNTs.length} vars removed`,badgeClass:remNTs.length?'badge-red':'badge-green'});
  h+=renderAnimatedDepGraph(res.step2.grammar,{title:'After Useless Removal',highlight:reachHl,startSymbol:res.original.start});
  h+=`<div class="grammar-block step-info"><div class="grammar-block-header"><span class="grammar-block-title">Step 3 — Unit Productions</span><span class="grammar-block-badge badge-purple">${ntPairs.length} unit pairs</span></div>${ntPairs.length?`<div class="sym-set-row"><span class="sym-set-label">Unit pairs</span>${ntPairs.map(([a,b])=>`<span class="sym-pill unit-pill">(${esc(a)}, ${esc(b)})</span>`).join('')}</div>`:'<div style="font-size:12px;color:var(--text3);padding:4px 0">No non-trivial unit pairs.</div>'}</div>`;
  h+=renderGrammarBlock(res.step3.grammar,{title:res.step3.label,borderClass:'step-after',badge:`${uR} unit prods removed`,badgeClass:'badge-purple'});
  h+=renderAnimatedDepGraph(res.step3.grammar,{title:'After Unit Removal',highlight:unitHl,startSymbol:res.original.start});
  h+=renderGrammarBlock(res.final,{title:'✓ Simplified Grammar',badgeClass:'badge-green',badge:'final result'});
  h+=renderAnimatedDepGraph(res.final,{title:'Final Grammar — Dependency Graph',startSymbol:res.original.start});
  rc.innerHTML=h;
}

/* ═══════════════════════════════════════════════════════
   THEATRE STEP-WISE
   No scrolling — fixed viewport stage.
   Top: animated dep graph.  Bottom: tabbed panels.
═══════════════════════════════════════════════════════ */
let _steps=[], _stepIdx=0, _playTimer=null, _isPlaying=false;
let _panelTab='reason'; // 'reason' | 'grammar' | 'changes'

function initStepwise() {
  const text=document.getElementById('step-grammar').value;
  const startSym=document.getElementById('step-start').value.trim()||'S';
  const sv=document.getElementById('step-view');
  const se=VALIDATION_RULES.startSymbol(startSym);
  if (se) { sv.innerHTML=`<div class="parse-error">${esc(se)}</div>`; showInputFeedback('step-start',false,se); return; }
  const ge=VALIDATION_RULES.grammar(text,startSym);
  if (ge) { sv.innerHTML=`<div class="parse-error">${esc(ge)}</div>`; showInputFeedback('step-grammar',false,ge.split('\n')[0]); return; }
  const {grammar,errors}=CFGEngine.parseGrammar(text,startSym);
  if (errors.length) { sv.innerHTML=`<div class="parse-error">${esc(errors.join('\n'))}</div>`; return; }
  showInputFeedback('step-grammar',true,'✓'); showInputFeedback('step-start',true,'✓');
  stopPlay();
  _steps=CFGEngine.generateStepTrace(grammar);
  _stepIdx=0; _panelTab='reason';
  document.getElementById('step-nav').style.display='block';
  renderTheatreStep(true);
}

function buildStepHighlight(step) {
  const h={};
  if (step.nullable) for (const n of step.nullable) h[n]='nullable';
  if (step.generating) for (const n of step.generating) h[n]='generating';
  if (step.reachable) for (const n of step.reachable) h[n]='reachable';
  if (step.unitPairs) for (const [a,b] of step.unitPairs) { h[a]='unit'; h[b]='unit'; }
  // Mark removed NTs
  if (step.changes) for (const ch of step.changes) if (ch.type==='useless-nt') h[ch.nt]='removed';
  return h;
}

function renderTheatreStep(animate=false) {
  const step=_steps[_stepIdx]; if (!step) return;
  const total=_steps.length;

  // ── progress bar ──
  document.getElementById('step-counter').textContent=`${_stepIdx+1} / ${total}`;
  const prog=document.getElementById('step-progress-bar');
  if (prog) prog.style.width=`${((_stepIdx+1)/total)*100}%`;

  // ── dot track ──
  const dots=document.getElementById('step-dots');
  if (dots) dots.innerHTML=_steps.map((_,i)=>`<div class="step-dot${i<_stepIdx?' done':i===_stepIdx?' active':''}" id="sdot-${i}" onclick="jumpStep(${i})"></div>`).join('');

  // ── button states ──
  document.getElementById('btn-prev').disabled=_stepIdx===0;
  document.getElementById('btn-next').disabled=_stepIdx===total-1;
  const pb=document.getElementById('btn-play');
  if (pb) pb.innerHTML=_isPlaying?'<span class="btn-icon">⏸</span>Pause':'<span class="btn-icon">▶</span>Play';

  // ── phase badge ──
  const phaseBadge=document.getElementById('step-phase-badge');
  if (phaseBadge) { phaseBadge.textContent=step.phase; phaseBadge.className='phase-badge '+phaseClass(step.phase); }

  // ── graph ──
  const hl=buildStepHighlight(step);
  const graphHtml=renderAnimatedDepGraph(step.grammar,{title:step.title,highlight:hl,startSymbol:_steps[0].grammar.start,animDelay:0});
  const graphArea=document.getElementById('theatre-graph');
  if (graphArea) {
    if (animate) { graphArea.classList.remove('graph-enter'); void graphArea.offsetWidth; graphArea.classList.add('graph-enter'); }
    graphArea.innerHTML=graphHtml;
  }

  // ── bottom panels ──
  renderPanels(step);
}

function phaseClass(phase) {
  if (phase.includes('Null')) return 'phase-amber';
  if (phase.includes('Useless')) return 'phase-red';
  if (phase.includes('Unit')) return 'phase-purple';
  if (phase==='Result') return 'phase-green';
  return 'phase-default';
}

function renderPanels(step) {
  // Reasoning panel
  const reasonArea=document.getElementById('panel-reason');
  if (reasonArea) {
    let rh=`<div class="step-explain-mini"><div class="se-title">${esc(step.title)}</div><div class="se-body">${step.explanation}</div></div>`;
    rh+=getStepReasoning(step,_steps);
    if (step.nullable&&step.nullable.size) rh+=renderSymSet('Nullable vars',step.nullable,'nullable-pill');
    if (step.generating&&step.generating.size) rh+=renderSymSet('Generating',step.generating,'kept-pill');
    if (step.reachable&&step.reachable.size) rh+=renderSymSet('Reachable',step.reachable,'kept-pill');
    if (step.unitPairs&&step.unitPairs.length) rh+=`<div class="sym-set-row"><span class="sym-set-label">Unit pairs</span>${step.unitPairs.map(([a,b])=>`<span class="sym-pill unit-pill">(${esc(a)}, ${esc(b)})</span>`).join('')}</div>`;
    reasonArea.innerHTML=rh;
  }

  // Grammar panel
  const gramArea=document.getElementById('panel-grammar');
  if (gramArea) {
    const uNTs=step.unitPairs?new Set(step.unitPairs.flatMap(([a,b])=>[a,b])):null;
    gramArea.innerHTML=renderGrammarBlock(step.grammar,{title:step.title,nullable:step.nullable,unitNTs:uNTs});
  }

  // Changes panel
  const chArea=document.getElementById('panel-changes');
  if (chArea) {
    if (step.changes&&step.changes.length) chArea.innerHTML=renderChanges(step.changes);
    else chArea.innerHTML=`<div class="no-changes">No production changes at this step.</div>`;
  }

  // Activate correct tab content
  activatePanelTab(_panelTab);
}

function activatePanelTab(tab) {
  _panelTab=tab;
  ['reason','grammar','changes'].forEach(t=>{
    const btn=document.getElementById('ptab-'+t), panel=document.getElementById('panel-'+t);
    if (btn) btn.classList.toggle('active',t===tab);
    if (panel) panel.style.display=t===tab?'block':'none';
  });
}

function jumpStep(i) { stopPlay(); _stepIdx=i; renderTheatreStep(true); }
function prevStep() { stopPlay(); if (_stepIdx>0) { _stepIdx--; renderTheatreStep(true); } }
function nextStep() { stopPlay(); if (_stepIdx<_steps.length-1) { _stepIdx++; renderTheatreStep(true); } }
function replaySteps() { stopPlay(); _stepIdx=0; renderTheatreStep(true); }

function startPlay() {
  if (_stepIdx>=_steps.length-1) { _stepIdx=0; renderTheatreStep(true); }
  _isPlaying=true;
  const pb=document.getElementById('btn-play');
  if (pb) pb.innerHTML='<span class="btn-icon">⏸</span>Pause';
  const advance=()=>{
    if (!_isPlaying||_stepIdx>=_steps.length-1) { stopPlay(); return; }
    _stepIdx++; renderTheatreStep(true);
    _playTimer=setTimeout(advance,3200);
  };
  _playTimer=setTimeout(advance,3200);
}
function stopPlay() {
  _isPlaying=false; clearTimeout(_playTimer); _playTimer=null;
  const pb=document.getElementById('btn-play');
  if (pb) pb.innerHTML='<span class="btn-icon">▶</span>Play';
}
function togglePlay() { if (_isPlaying) stopPlay(); else startPlay(); }

/* ═══════════════════════════════════════════════════════
   GRAMMAR CHECKER
═══════════════════════════════════════════════════════ */
function runChecker() {
  const text=document.getElementById('chk-grammar').value;
  const startSym=document.getElementById('chk-start').value.trim()||'S';
  const out=document.getElementById('checker-results');
  const se=VALIDATION_RULES.startSymbol(startSym);
  if (se){out.innerHTML=`<div class="parse-error">${esc(se)}</div>`;showInputFeedback('chk-start',false,se);return;}
  const ge=VALIDATION_RULES.grammar(text,startSym);
  if (ge){out.innerHTML=`<div class="parse-error">${esc(ge)}</div>`;showInputFeedback('chk-grammar',false,ge.split('\n')[0]);return;}
  const {grammar,errors}=CFGEngine.parseGrammar(text,startSym);
  if (errors.length){out.innerHTML=`<div class="parse-error">${esc(errors.join('\n'))}</div>`;return;}
  showInputFeedback('chk-grammar',true,'✓');showInputFeedback('chk-start',true,'✓');
  const chk=CFGEngine.checkGrammar(grammar);
  const row=(icon,label,value,cls,tip='')=>`<div class="check-row" title="${esc(tip)}"><span class="check-icon-${cls}">${icon}</span><span class="check-label">${label}</span><span class="check-value">${value}</span></div>`;
  let h=`<div class="check-section"><div class="check-section-title">Overview</div>
    ${row('●','Non-terminals',[...chk.allNTs].join(', '),'pass')}
    ${row('●','Terminals',[...chk.terminals].join(', '),'pass')}
    ${row('●','Productions',chk.productionCount,'pass')}
    ${row('●','Start symbol',grammar.start,'pass')}</div>`;
  h+=`<div class="check-section"><div class="check-section-title">Properties</div>
    ${row(chk.nullable.size?'!':'✓','Nullable vars',chk.nullable.size?[...chk.nullable].join(', '):'none',chk.nullable.size?'warn':'pass','Can derive ε')}
    ${row(chk.hasNullProds?'!':'✓','Has ε-prods',chk.hasNullProds?'Yes':'No',chk.hasNullProds?'warn':'pass')}
    ${row(chk.hasUnitProds?'!':'✓','Has unit prods',chk.hasUnitProds?'Yes':'No',chk.hasUnitProds?'warn':'pass')}
    ${row(chk.useless.length?'✗':'✓','Useless symbols',chk.useless.length?chk.useless.join(', '):'none',chk.useless.length?'fail':'pass')}
    ${row(chk.isCNF?'✓':'✗','In CNF',chk.isCNF?'Yes':'No',chk.isCNF?'pass':'fail')}</div>`;
  h+=`<div class="check-section"><div class="check-section-title">Symbol Analysis</div>${renderSymSet('Nullable',chk.nullable,'nullable-pill')}${renderSymSet('Generating',chk.generating,'kept-pill')}${renderSymSet('Reachable',chk.reachable,'kept-pill')}${chk.useless.length?renderSymSet('Useless',new Set(chk.useless),'removed-pill'):''}</div>`;
  if (chk.unitPairs.length) h+=`<div class="check-section"><div class="check-section-title">Unit Pairs</div><div class="sym-set-row">${chk.unitPairs.map(([a,b])=>`<span class="sym-pill unit-pill">(${esc(a)} ⇒* ${esc(b)})</span>`).join('')}</div></div>`;
  const cHl={};for(const n of chk.nullable)cHl[n]='nullable';for(const n of chk.useless)cHl[n]='useless';
  h+=renderAnimatedDepGraph(grammar,{title:'Grammar Dependency Graph',highlight:cHl,startSymbol:grammar.start});
  out.innerHTML=h;
}

/* ═══════════════════════════════════════════════════════
   SYMBOL INSERT BUTTONS
═══════════════════════════════════════════════════════ */
document.querySelectorAll('.sym-insert-bar').forEach(bar=>{
  const tid=bar.dataset.target;
  bar.querySelectorAll('.sym-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const ta=document.getElementById(tid); if (!ta) return;
    ta.focus();
    const s=ta.selectionStart,e=ta.selectionEnd,ins=btn.dataset.insert;
    ta.value=ta.value.slice(0,s)+ins+ta.value.slice(e);
    ta.selectionStart=ta.selectionEnd=s+ins.length;
    ta.dispatchEvent(new Event('input'));
  }));
});

/* ═══════════════════════════════════════════════════════
   KEYBOARD
═══════════════════════════════════════════════════════ */
document.addEventListener('keydown',e=>{
  if (!document.getElementById('tab-stepwise').classList.contains('active')) return;
  if (document.activeElement&&['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.key==='ArrowRight') nextStep();
  else if (e.key==='ArrowLeft') prevStep();
  else if (e.key===' ') { e.preventDefault(); togglePlay(); }
  else if (e.key==='r'||e.key==='R') replaySteps();
  else if (e.key==='1') activatePanelTab('reason');
  else if (e.key==='2') activatePanelTab('grammar');
  else if (e.key==='3') activatePanelTab('changes');
});
