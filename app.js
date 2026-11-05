import { firebaseConfig, DEFAULT_SPACE } from './config.js';

/* ====== 상수 ====== */
const TYPES = {
  tournament:{label:'대회', c:'var(--t-tour)', hint:'예선·본선 성적과 피드백'},
  league:{label:'리그', c:'var(--t-league)', hint:'예선·본선 + 경기 과정'},
  lesson:{label:'레슨', c:'var(--t-lesson)', hint:'훈련 내용과 지적사항'},
  practice:{label:'연습', c:'var(--t-practice)', hint:'연습 내용과 연습경기'}
};
const ORDER = ['tournament','league','lesson','practice'];
const MATCH = {tournament:1, league:1};
const LS_ENTRIES = 'tt.entries';
const LS_SPACE = 'tt.space';
const LS_THEME = 'tt.theme';

/* ====== 상태 ====== */
let entries = [];
let view = 'cal';
let cursor = new Date(); cursor.setDate(1); cursor.setHours(0,0,0,0);
let listFilter = 'all';
let store = null;        // {mode, save, remove}
let syncMode = 'local';  // 'cloud' | 'local'

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s==null?'':s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const n = (v) => { const x = parseInt(v,10); return isNaN(x)?0:x; };
const pad = (x) => x<10 ? '0'+x : ''+x;
const ds = (d) => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const todayStr = () => ds(new Date());
const parseDs = (s) => { const p = String(s||'').split('-'); return new Date(n(p[0]), n(p[1])-1, n(p[2])); };

function lsGet(k, fb){ try { const v = localStorage.getItem(k); return v==null ? fb : v; } catch(e){ return fb; } }
function lsSet(k, v){ try { localStorage.setItem(k, v); } catch(e){} }

/* ====== 요약 계산 ====== */
function roundTally(e){
  let w=0,l=0; const rs = e.rounds||[];
  rs.forEach(r => { const a=n(r.my), b=n(r.op); if(a>b) w++; else if(b>a) l++; });
  return {w, l, n: rs.length};
}
function finalResult(e){
  const rs = (e.rounds||[]).filter(r => (r.label||'') !== '' || n(r.my)+n(r.op) > 0);
  if(!rs.length) return '';
  const last = rs[rs.length-1];
  if(n(last.my) > n(last.op)) return (last.label||'최종')+' 승';
  if(n(last.op) > n(last.my)) return (last.label||'최종')+' 탈락';
  return '';
}
function summary(e){
  const out = [];
  if(e.type==='tournament' || e.type==='league'){
    if(n(e.qualW)+n(e.qualL) > 0){
      let q = '예선 '+n(e.qualW)+'승 '+n(e.qualL)+'패';
      if(e.qualPass===true) q += ' · 통과';
      if(e.qualPass===false) q += ' · 탈락';
      out.push(q);
    }
    const t = roundTally(e);
    if(t.n) out.push('본선 '+t.w+'승 '+t.l+'패' + (finalResult(e) ? ' ('+finalResult(e)+')' : ''));
  }
  if(e.type==='practice'){
    if(n(e.qualW)+n(e.qualL) > 0) out.push('연습경기 '+n(e.qualW)+'승 '+n(e.qualL)+'패');
    if(e.partner) out.push(e.partner);
  }
  if(e.type==='lesson' && e.content) out.push(e.content.split('\n')[0]);
  if(!out.length && e.improve) out.push(e.improve.split('\n')[0]);
  if(!out.length && e.content) out.push(e.content.split('\n')[0]);
  return out.join(' · ');
}
const titleOf = (e) => (e.title && e.title.trim()) ? e.title.trim() : TYPES[e.type].label;
const sorted = () => entries.slice().sort((a,b) => a.date<b.date ? 1 : (a.date>b.date ? -1 : 0));

/* ====== 달력 ====== */
function renderCal(){
  const y = cursor.getFullYear(), m = cursor.getMonth();
  $('mYear').textContent = y;
  $('mMonth').textContent = (m+1)+'월';
  const startDow = new Date(y,m,1).getDay();
  const dim = new Date(y,m+1,0).getDate();
  const cells = Math.ceil((startDow+dim)/7)*7;
  const byDate = {};
  entries.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const tdy = todayStr();
  let html = '';
  for(let i=0;i<cells;i++){
    const d = new Date(y, m, i-startDow+1);
    const key = ds(d), inM = d.getMonth()===m;
    const list = (byDate[key]||[]).slice().sort((a,b) => ORDER.indexOf(a.type)-ORDER.indexOf(b.type));
    let marks = '';
    list.slice(0,3).forEach(e => {
      marks += '<span class="chip'+(e.status==='planned'?' planned':'')+'" style="--c:'+TYPES[e.type].c+'">'+
               '<em>'+esc(titleOf(e))+'</em></span>';
    });
    if(list.length > 3) marks += '<span class="more">+'+(list.length-3)+'</span>';
    html += '<button class="cell'+(inM?'':' out')+(key===tdy?' today':'')+'" data-date="'+key+'">'+
            '<span class="dnum">'+d.getDate()+'</span><span class="marks">'+marks+'</span></button>';
  }
  $('calGrid').innerHTML = html;
  $('legend').innerHTML = ORDER.map(t => '<b><i style="--c:'+TYPES[t].c+'"></i>'+TYPES[t].label+'</b>').join('')
    + '<b style="opacity:.75">점선 = 예정</b>';
}

/* ====== 통계 ====== */
const tile = (k,v,s) => '<div class="tile"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="sub">'+esc(s)+'</div></div>';

function renderStats(){
  const done = entries.filter(e => e.status!=='planned');
  let mw=0, ml=0, qw=0, ql=0, mcount=0;
  done.forEach(e => {
    if(!MATCH[e.type]) return;
    mcount++;
    const t = roundTally(e); mw+=t.w; ml+=t.l;
    qw += n(e.qualW); ql += n(e.qualL);
  });
  const mtot = mw+ml, rate = mtot ? Math.round(mw/mtot*100) : null;
  const qtot = qw+ql, qrate = qtot ? Math.round(qw/qtot*100) : null;
  const trainDays = {};
  done.forEach(e => { if(e.type==='lesson'||e.type==='practice') trainDays[e.date] = 1; });

  const months = [], now = new Date();
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({y:d.getFullYear(), m:d.getMonth(), counts:{tournament:0,league:0,lesson:0,practice:0}, total:0});
  }
  done.forEach(e => {
    const d = parseDs(e.date);
    for(const mo of months){
      if(mo.y===d.getFullYear() && mo.m===d.getMonth()){ mo.counts[e.type]++; mo.total++; break; }
    }
  });
  const max = Math.max(1, ...months.map(x => x.total));

  const bars = months.map(x => {
    const segs = ORDER.filter(t => x.counts[t] > 0)
      .map(t => '<div class="barseg" style="background:'+TYPES[t].c+';height:'+(x.counts[t]/max*118)+'px"></div>').join('');
    return '<div class="barcol"><div class="barcap">'+(x.total||'')+'</div>'+
           '<div class="barstack">'+segs+'</div><div class="barlab">'+(x.m+1)+'월</div></div>';
  }).join('');

  const recent = sorted().filter(e => MATCH[e.type] && e.status!=='planned').slice(0,8);
  const recentHtml = recent.length ? recent.map(e => {
    const t = roundTally(e);
    return '<button class="rowitem" data-open="'+e.id+'">'+
      '<span class="rdate">'+esc(e.date.slice(5).replace('-','/'))+'</span>'+
      '<span class="rbody"><span class="rtitle">'+esc(titleOf(e))+
      '<span class="badge" style="--c:'+TYPES[e.type].c+'">'+TYPES[e.type].label+'</span></span>'+
      '<span class="rsum">'+esc(summary(e)||'기록 없음')+'</span></span>'+
      '<span class="tag '+(t.w>=t.l?'w':'l')+'">'+t.w+'–'+t.l+'</span></button>';
  }).join('') : '<p class="muted" style="padding:12px 0">아직 대회·리그 기록이 없습니다.</p>';

  $('view-stats').innerHTML =
    '<div class="tiles">'+
      tile('본선 승률', rate===null?'—':rate+'<small>%</small>', mtot ? mw+'승 '+ml+'패 / '+mcount+'개 대회·리그' : '대회·리그 본선 매치 기준')+
      tile('예선 통산', qtot ? qw+'<small>승</small> '+ql+'<small>패</small>' : '—', qrate===null ? '대회·리그 예선 합계' : '승률 '+qrate+'%')+
      tile('훈련 일수', Object.keys(trainDays).length, '레슨·연습을 한 날')+
      tile('전체 기록', done.length, '예정 '+entries.filter(e => e.status==='planned').length+'건 대기')+
    '</div>'+
    '<div class="card"><div class="eyebrow">최근 6개월 활동</div><div class="bars">'+bars+'</div></div>'+
    '<div class="card" style="margin-top:12px"><div class="eyebrow">최근 대회 · 리그</div><div class="rowlist">'+recentHtml+'</div></div>';
}

/* ====== 목록 ====== */
function emptyBlock(t,p){
  return '<div class="card empty"><strong>'+esc(t)+'</strong><p>'+esc(p)+'</p>'+
    '<button class="primary" style="max-width:220px;margin:0 auto" data-new="tournament">기록 추가</button></div>';
}
function renderList(){
  const chips = '<div class="chips"><button data-f="all" aria-pressed="'+(listFilter==='all')+'">전체</button>'+
    ORDER.map(t => '<button data-f="'+t+'" aria-pressed="'+(listFilter===t)+'">'+TYPES[t].label+'</button>').join('')+
    '<button data-f="planned" aria-pressed="'+(listFilter==='planned')+'">예정</button></div>';
  const list = sorted().filter(e => {
    if(listFilter==='all') return true;
    if(listFilter==='planned') return e.status==='planned';
    return e.type===listFilter;
  });
  const body = list.length ? '<div class="card"><div class="rowlist">'+list.map(e =>
    '<button class="rowitem" data-open="'+e.id+'">'+
      '<span class="rdate">'+esc(e.date.slice(2).replace(/-/g,'/'))+'</span>'+
      '<span class="rbody"><span class="rtitle">'+esc(titleOf(e))+
        '<span class="badge'+(e.status==='planned'?' out':'')+'" style="--c:'+TYPES[e.type].c+'">'+
        TYPES[e.type].label+(e.status==='planned'?' 예정':'')+'</span></span>'+
      '<span class="rsum">'+esc(summary(e)||'—')+'</span></span></button>'
  ).join('')+'</div></div>' : emptyBlock('해당하는 기록이 없습니다.','다른 필터를 골라보세요.');
  $('view-list').innerHTML = chips + body;
}

function render(){
  if(view==='cal') renderCal();
  else if(view==='stats') renderStats();
  else renderList();
}

/* ====== 오버레이 ====== */
const openOverlay = (html) => { $('sheet').innerHTML = html; $('overlay').hidden = false; $('sheet').scrollTop = 0; };
const closeOverlay = () => { $('overlay').hidden = true; $('sheet').innerHTML = ''; };
const head = (title, sub) => '<div class="sheethead"><h2>'+esc(title)+'</h2>'+
  (sub ? '<span class="muted">'+esc(sub)+'</span>' : '')+
  '<button class="x" data-close="1" aria-label="닫기">✕</button></div>';

function openDay(date){
  const list = entries.filter(e => e.date===date).sort((a,b) => ORDER.indexOf(a.type)-ORDER.indexOf(b.type));
  const d = parseDs(date), wd = ['일','월','화','수','목','금','토'][d.getDay()];
  const body = list.length ? '<div class="rowlist" style="margin-bottom:14px">'+list.map(e =>
    '<button class="rowitem" data-open="'+e.id+'">'+
      '<span class="rbody"><span class="rtitle">'+esc(titleOf(e))+
      '<span class="badge'+(e.status==='planned'?' out':'')+'" style="--c:'+TYPES[e.type].c+'">'+
      TYPES[e.type].label+(e.status==='planned'?' 예정':'')+'</span></span>'+
      '<span class="rsum">'+esc(summary(e)||'내용 없음')+'</span></span></button>'
  ).join('')+'</div>' : '<p class="muted" style="margin:0 0 14px">이 날의 기록이 없습니다. 아래에서 종류를 고르세요.</p>';
  const picker = '<div class="typepick">'+ORDER.map(t =>
    '<button data-new="'+t+'" data-date="'+date+'" style="--c:'+TYPES[t].c+'">'+
    '<b>'+TYPES[t].label+'</b><span>'+TYPES[t].hint+'</span></button>').join('')+'</div>';
  openOverlay(head((d.getMonth()+1)+'월 '+d.getDate()+'일 ('+wd+')') + body + picker);
}

function openDetail(id){
  const e = entries.find(x => x.id===id);
  if(!e) return;
  const h = head(titleOf(e), e.date + ' · ' + TYPES[e.type].label + (e.status==='planned'?' · 예정':''));
  let b = '<dl class="detail">';
  if(e.division) b += '<dt>참가 부수</dt><dd>'+esc(e.division)+'</dd>';
  if(e.partner) b += '<dt>함께한 사람</dt><dd>'+esc(e.partner)+'</dd>';
  if(n(e.qualW)+n(e.qualL) > 0){
    const ql = e.type==='practice' ? '연습경기 전적' : '예선';
    b += '<dt>'+ql+'</dt><dd>'+n(e.qualW)+'승 '+n(e.qualL)+'패'+
      (e.qualPass===true?' · 본선 진출':'')+(e.qualPass===false?' · 예선 탈락':'')+'</dd>';
  }
  const rs = e.rounds||[];
  if(rs.length){
    b += '<dt>본선</dt></dl><div class="rounds-view">'+rs.map(r => {
      const win = n(r.my) > n(r.op), draw = n(r.my)===n(r.op);
      return '<div class="rv"><span class="rl">'+esc(r.label||'—')+'</span>'+
        '<span class="rs">'+n(r.my)+'–'+n(r.op)+'</span>'+
        '<span class="ro">'+esc(r.opp||'')+'</span>'+
        '<span class="rr" style="color:'+(draw?'var(--muted)':(win?'var(--win)':'var(--loss)'))+'">'+
        (draw?'':(win?'승':'패'))+'</span></div>';
    }).join('')+'</div><dl class="detail">';
  }
  if(e.content) b += '<dt>'+(e.type==='lesson'?'훈련 내용':'연습 내용')+'</dt><dd>'+esc(e.content)+'</dd>';
  if(e.process) b += '<dt>경기 과정</dt><dd>'+esc(e.process)+'</dd>';
  if(e.good) b += '<dt>잘된 점</dt><dd>'+esc(e.good)+'</dd>';
  if(e.improve) b += '<dt>'+(e.type==='lesson'?'지적받은 점 · 보완할 것':'보완할 점')+'</dt><dd>'+esc(e.improve)+'</dd>';
  b += '</dl>';
  const past = e.status==='planned' && e.date <= todayStr();
  const acts = '<div class="actions">'+
    (past ? '<button class="primary" data-edit="'+e.id+'" data-finish="1">기록 작성</button>'
          : '<button class="primary" data-edit="'+e.id+'">수정</button>')+
    '<button class="danger" data-del="'+e.id+'">삭제</button></div>';
  openOverlay(h + b + acts);
}

/* ====== 폼 ====== */
const blankEntry = (type, date) => ({
  id:null, type, date: date||todayStr(), status:'done', title:'', division:'', partner:'',
  qualW:'', qualL:'', qualPass:null, rounds:[], content:'', process:'', good:'', improve:''
});

const roundRowHtml = (r,i) =>
  '<div class="roundrow" data-i="'+i+'">'+
    '<input type="text" class="rl" placeholder="1회전" value="'+esc(r.label||'')+'">'+
    '<input type="text" class="opp" placeholder="상대 (선택)" value="'+esc(r.opp||'')+'">'+
    '<input type="number" class="my" inputmode="numeric" min="0" max="9" placeholder="2" value="'+(r.my===''||r.my==null?'':n(r.my))+'">'+
    '<span class="vs">:</span>'+
    '<input type="number" class="op" inputmode="numeric" min="0" max="9" placeholder="1" value="'+(r.op===''||r.op==null?'':n(r.op))+'">'+
    '<button type="button" class="del" data-rdel="'+i+'" aria-label="라운드 삭제">✕</button></div>';

function openForm(entry, forceDone){
  const e = entry || blankEntry('tournament', todayStr());
  let rounds = (e.rounds||[]).map(r => ({label:r.label||'', opp:r.opp||'', my:r.my, op:r.op}));
  if(!rounds.length) rounds = [{label:'',opp:'',my:'',op:''}];
  const status = forceDone ? 'done' : (e.status||'done');
  const isNew = !e.id;

  let f = head(isNew ? '새 기록' : '기록 수정') + '<form id="entryForm" autocomplete="off">';
  f += '<input type="hidden" id="f_id" value="'+esc(e.id||'')+'">';
  f += '<div class="field"><span class="flabel">종류</span><div class="seg types" id="typeSeg">'+
    ORDER.map(t => '<button type="button" data-type="'+t+'" style="--c:'+TYPES[t].c+'" aria-pressed="'+(t===e.type)+'">'+TYPES[t].label+'</button>').join('')+
    '</div><input type="hidden" id="f_type" value="'+esc(e.type)+'"></div>';
  f += '<div class="two"><div class="field"><label for="f_date">날짜</label>'+
       '<input type="date" id="f_date" value="'+esc(e.date)+'"></div>'+
       '<div class="field"><span class="flabel">상태</span><div class="seg" id="statusSeg">'+
       '<button type="button" data-status="done" aria-pressed="'+(status==='done')+'">완료</button>'+
       '<button type="button" data-status="planned" aria-pressed="'+(status==='planned')+'">예정</button>'+
       '</div><input type="hidden" id="f_status" value="'+status+'"></div></div>';
  f += '<div class="field"><label for="f_title">제목</label>'+
       '<input type="text" id="f_title" placeholder="예: 경희대총장배 / 수요리그 3R / 포핸드 드라이브" value="'+esc(e.title||'')+'"></div>';
  f += '<div class="field only-tournament"><label for="f_division">참가 부수</label>'+
       '<input type="text" id="f_division" placeholder="예: 7부" value="'+esc(e.division||'')+'"></div>';
  f += '<div class="field only-practice"><label for="f_partner">함께한 사람 · 장소</label>'+
       '<input type="text" id="f_partner" placeholder="예: 동아리 연습실, 선배와 랠리" value="'+esc(e.partner||'')+'"></div>';
  f += '<div class="field only-lesson only-practice"><label for="f_content">'+
       '<span class="lbl-lesson">훈련 내용</span><span class="lbl-practice">연습 내용</span></label>'+
       '<textarea id="f_content" placeholder="오늘 무엇을 했는지">'+esc(e.content||'')+'</textarea></div>';
  f += '<div class="block result-block only-tournament only-league only-practice">'+
       '<span class="flabel"><span class="lbl-match">예선 전적</span><span class="lbl-practice">연습경기 전적</span></span>'+
       '<div class="scorerow"><div><label for="f_qw">승</label>'+
       '<input type="number" id="f_qw" inputmode="numeric" min="0" placeholder="5" value="'+(e.qualW===''||e.qualW==null?'':n(e.qualW))+'"></div>'+
       '<span class="mid">–</span><div><label for="f_ql">패</label>'+
       '<input type="number" id="f_ql" inputmode="numeric" min="0" placeholder="3" value="'+(e.qualL===''||e.qualL==null?'':n(e.qualL))+'"></div></div>'+
       '<div class="field only-tournament only-league" style="margin:11px 0 0"><span class="flabel">예선 결과</span>'+
       '<div class="seg" id="passSeg">'+
       '<button type="button" data-pass="null" aria-pressed="'+(e.qualPass==null)+'">미정</button>'+
       '<button type="button" data-pass="true" aria-pressed="'+(e.qualPass===true)+'">본선 진출</button>'+
       '<button type="button" data-pass="false" aria-pressed="'+(e.qualPass===false)+'">탈락</button></div>'+
       '<input type="hidden" id="f_pass" value="'+(e.qualPass==null?'null':String(e.qualPass))+'"></div></div>';
  f += '<div class="block result-block only-tournament only-league"><span class="flabel">본선 (라운드별)</span>'+
       '<div id="roundsBox">'+rounds.map(roundRowHtml).join('')+'</div>'+
       '<button type="button" class="addbtn" id="addRound">+ 라운드 추가</button></div>';
  f += '<div class="field only-league"><label for="f_process">경기 과정</label>'+
       '<textarea id="f_process" class="big" placeholder="흐름이 어떻게 흘러갔는지 — 어떤 공에 점수가 났고, 어느 순간 끌려갔는지">'+esc(e.process||'')+'</textarea></div>';
  f += '<div class="field"><label for="f_good">잘된 점</label>'+
       '<textarea id="f_good" placeholder="유지하고 싶은 플레이">'+esc(e.good||'')+'</textarea></div>';
  f += '<div class="field"><label for="f_improve">'+
       '<span class="lbl-lesson">지적받은 점 · 보완할 것</span><span class="lbl-other">보완할 점</span></label>'+
       '<textarea id="f_improve" placeholder="다음까지 고칠 것">'+esc(e.improve||'')+'</textarea></div>';
  f += '<div class="actions"><button type="submit" class="primary">저장</button>'+
       (isNew ? '' : '<button type="button" class="danger" data-del="'+e.id+'">삭제</button>')+
       '</div></form>';

  openOverlay(f);
  applyTypeVisibility();
}

function applyTypeVisibility(){
  const t = $('f_type').value, st = $('f_status').value, sheet = $('sheet');
  ORDER.forEach(k => {
    sheet.querySelectorAll('.only-'+k).forEach(el => {
      el.hidden = (el.className.indexOf('only-'+t) === -1);
    });
  });
  sheet.querySelectorAll('.result-block').forEach(el => { if(!el.hidden) el.hidden = (st==='planned'); });
  const showLbl = (sel, on) => sheet.querySelectorAll(sel).forEach(el => { el.hidden = !on; });
  showLbl('.lbl-lesson', t==='lesson');
  showLbl('.lbl-practice', t==='practice');
  showLbl('.lbl-match', t==='tournament' || t==='league');
  showLbl('.lbl-other', t!=='lesson');
}

function readRounds(){
  const box = $('roundsBox');
  if(!box) return [];
  return Array.from(box.querySelectorAll('.roundrow')).map(row => ({
    label: row.querySelector('.rl').value.trim(),
    opp: row.querySelector('.opp').value.trim(),
    my: row.querySelector('.my').value,
    op: row.querySelector('.op').value
  })).filter(r => r.label || r.opp || r.my!=='' || r.op!=='')
     .map(r => ({label:r.label, opp:r.opp, my:n(r.my), op:n(r.op)}));
}

function collect(){
  const t = $('f_type').value, st = $('f_status').value;
  const pass = $('f_pass') ? $('f_pass').value : 'null';
  const val = (id) => { const el = $(id); return el ? el.value.trim() : ''; };
  const o = {
    type: t, date: $('f_date').value || todayStr(), status: st,
    title: val('f_title'),
    division: t==='tournament' ? val('f_division') : '',
    partner: t==='practice' ? val('f_partner') : '',
    content: (t==='lesson'||t==='practice') ? val('f_content') : '',
    process: t==='league' ? val('f_process') : '',
    good: val('f_good'), improve: val('f_improve'),
    qualW: 0, qualL: 0, qualPass: null, rounds: []
  };
  if(st !== 'planned'){
    if(t==='tournament'||t==='league'||t==='practice'){ o.qualW = n(val('f_qw')); o.qualL = n(val('f_ql')); }
    if(t==='tournament'||t==='league'){
      o.qualPass = pass==='true' ? true : (pass==='false' ? false : null);
      o.rounds = readRounds();
    }
  }
  return o;
}

/* ====== 저장 ====== */
const newId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);

async function saveEntry(){
  const data = collect();
  const id = $('f_id').value || newId();
  data.updatedAt = new Date().toISOString();
  entries = entries.filter(x => x.id !== id).concat([{id, ...data}]);
  render(); closeOverlay();
  try { await store.save(id, data); }
  catch(err){ flash('저장하지 못했습니다: ' + (err && err.message ? err.message : err)); }
}

async function removeEntry(id){
  entries = entries.filter(x => x.id !== id);
  render(); closeOverlay();
  try { await store.remove(id); } catch(err){ flash('삭제하지 못했습니다: ' + (err && err.message ? err.message : err)); }
}

function flash(msg){ const el = $('notice'); el.textContent = msg; el.hidden = false; }
function clearFlash(){ $('notice').hidden = true; }

/* ====== 설정 시트 ====== */
function openSettings(){
  const space = lsGet(LS_SPACE, DEFAULT_SPACE);
  const cloud = syncMode === 'cloud';
  let h = head('설정');
  h += '<p class="muted" style="margin:0 0 14px">'+
       (cloud ? '클라우드 동기화 중입니다. 다른 기기에서 같은 공간 코드를 넣으면 같은 기록이 보입니다.'
              : 'Firebase 설정이 없어 이 브라우저에만 저장됩니다. config.js 를 채우면 동기화됩니다.')+'</p>';
  h += '<div class="field"><label for="s_space">공간 코드</label>'+
       '<div class="srow"><input type="text" id="s_space" class="grow" value="'+esc(space)+'" placeholder="8자 이상">'+
       '<button class="ghost" id="s_apply" style="margin:0">적용</button></div>'+
       '<p class="muted" style="margin:0">다른 기기에서도 이 코드를 똑같이 입력하세요. 코드를 바꾸면 그 코드의 기록으로 전환됩니다.</p></div>';
  h += '<div class="hr"></div>';
  h += '<div class="field"><span class="flabel">백업</span><div class="srow">'+
       '<button class="ghost" id="s_export" style="margin:0">JSON 내보내기</button>'+
       '<button class="ghost" id="s_import" style="margin:0">JSON 가져오기</button></div>'+
       '<p class="muted" style="margin:0">가져오기는 기존 기록에 더해집니다 (같은 id는 덮어씀).</p></div>';
  h += '<div class="actions"><button class="primary" data-close="1">닫기</button></div>';
  openOverlay(h);
}

function exportJson(){
  const blob = new Blob([JSON.stringify(entries, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tt-records-' + todayStr() + '.json';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function importJson(file){
  try {
    const list = JSON.parse(await file.text());
    if(!Array.isArray(list)) throw new Error('배열 형식이 아닙니다');
    for(const raw of list){
      const id = raw.id || newId();
      const {id:_drop, ...data} = raw;
      entries = entries.filter(x => x.id !== id).concat([{id, ...data}]);
      await store.save(id, data);
    }
    render(); closeOverlay();
    flash(list.length + '건을 가져왔습니다.');
  } catch(err){ flash('가져오기 실패: ' + err.message); }
}

/* ====== 탭 · 이벤트 ====== */
function setView(v){
  view = v;
  ['cal','stats','list'].forEach(k => {
    $('tab-'+k).setAttribute('aria-selected', String(k===v));
    $('view-'+k).hidden = (k !== v);
  });
  render();
}
['cal','stats','list'].forEach(k => $('tab-'+k).addEventListener('click', () => setView(k)));

$('prevM').addEventListener('click', () => { cursor.setMonth(cursor.getMonth()-1); renderCal(); });
$('nextM').addEventListener('click', () => { cursor.setMonth(cursor.getMonth()+1); renderCal(); });
$('todayBtn').addEventListener('click', () => {
  const t = new Date(); cursor = new Date(t.getFullYear(), t.getMonth(), 1);
  if(view !== 'cal') setView('cal'); else renderCal();
});
$('syncBtn').addEventListener('click', openSettings);

function applyTheme(mode){
  if(mode==='dark' || mode==='light') document.documentElement.setAttribute('data-theme', mode);
  else document.documentElement.removeAttribute('data-theme');
}
$('themeBtn').addEventListener('click', () => {
  const cur = lsGet(LS_THEME, 'system');
  const next = cur==='system' ? 'light' : (cur==='light' ? 'dark' : 'system');
  lsSet(LS_THEME, next); applyTheme(next);
});

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-date],[data-open],[data-new],[data-f],[data-close],[data-edit],[data-del],[data-type],[data-status],[data-pass],[data-rdel],#addRound,#s_apply,#s_export,#s_import');
  if(!el) return;

  if(el.id==='addRound'){
    const box = $('roundsBox');
    box.insertAdjacentHTML('beforeend', roundRowHtml({label:'',opp:'',my:'',op:''}, box.querySelectorAll('.roundrow').length));
    return;
  }
  if(el.id==='s_apply'){
    const v = $('s_space').value.trim();
    if(v.length < 8){ flash('공간 코드는 8자 이상이어야 합니다.'); return; }
    lsSet(LS_SPACE, v); location.reload(); return;
  }
  if(el.id==='s_export'){ exportJson(); return; }
  if(el.id==='s_import'){ $('importFile').click(); return; }

  if(el.hasAttribute('data-close')){ closeOverlay(); return; }
  if(el.hasAttribute('data-open')){ openDetail(el.getAttribute('data-open')); return; }
  if(el.hasAttribute('data-edit')){
    const e = entries.find(x => x.id === el.getAttribute('data-edit'));
    if(e) openForm(e, el.hasAttribute('data-finish'));
    return;
  }
  if(el.hasAttribute('data-del')){ removeEntry(el.getAttribute('data-del')); return; }
  if(el.hasAttribute('data-new')){
    const t = el.getAttribute('data-new');
    openForm(blankEntry(TYPES[t] ? t : 'tournament', el.getAttribute('data-date') || todayStr()));
    return;
  }
  if(el.hasAttribute('data-f')){ listFilter = el.getAttribute('data-f'); renderList(); return; }
  if(el.hasAttribute('data-type')){
    $('f_type').value = el.getAttribute('data-type');
    Array.from($('typeSeg').children).forEach(b => b.setAttribute('aria-pressed', String(b===el)));
    applyTypeVisibility(); return;
  }
  if(el.hasAttribute('data-status')){
    $('f_status').value = el.getAttribute('data-status');
    Array.from($('statusSeg').children).forEach(b => b.setAttribute('aria-pressed', String(b===el)));
    applyTypeVisibility(); return;
  }
  if(el.hasAttribute('data-pass')){
    $('f_pass').value = el.getAttribute('data-pass');
    Array.from($('passSeg').children).forEach(b => b.setAttribute('aria-pressed', String(b===el)));
    return;
  }
  if(el.hasAttribute('data-rdel')){
    const rows = $('roundsBox').querySelectorAll('.roundrow');
    const i = n(el.getAttribute('data-rdel'));
    const row = el.closest('.roundrow');
    if(rows.length > 1) row.remove();
    else row.querySelectorAll('input').forEach(inp => { inp.value = ''; });
    return;
  }
  if(el.hasAttribute('data-date')){ openDay(el.getAttribute('data-date')); return; }
});

document.addEventListener('submit', (ev) => {
  if(ev.target && ev.target.id === 'entryForm'){ ev.preventDefault(); saveEntry(); }
});
$('importFile').addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if(f) importJson(f);
  ev.target.value = '';
});
$('overlay').addEventListener('click', (ev) => { if(ev.target === $('overlay')) closeOverlay(); });
document.addEventListener('keydown', (ev) => { if(ev.key==='Escape' && !$('overlay').hidden) closeOverlay(); });

/* ====== 저장소 연결 ====== */
function setSyncUI(mode, label){
  syncMode = mode;
  $('syncDot').className = 'dot ' + (mode==='cloud' ? 'on' : 'off');
  $('syncLabel').textContent = label;
}

function localStore(){
  const read = () => { try { return JSON.parse(lsGet(LS_ENTRIES, '[]')) || []; } catch(e){ return []; } };
  const write = () => lsSet(LS_ENTRIES, JSON.stringify(entries));
  entries = read();
  return { save: async () => write(), remove: async () => write() };
}

async function cloudStore(space){
  const [{ initializeApp }, fs] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
  ]);
  const app = initializeApp(firebaseConfig);
  const fdb = fs.getFirestore(app);
  const col = fs.collection(fdb, 'spaces', space, 'entries');
  fs.onSnapshot(col, (snap) => {
    entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    clearFlash();
    render();
  }, (err) => {
    flash('기록을 불러오지 못했습니다: ' + err.message + ' (Firestore 규칙과 공간 코드를 확인하세요)');
  });
  return {
    save: (id, data) => fs.setDoc(fs.doc(col, id), data),
    remove: (id) => fs.deleteDoc(fs.doc(col, id))
  };
}

/* ====== 부팅 ====== */
applyTheme(lsGet(LS_THEME, 'system'));
setView('cal');

(async () => {
  const space = lsGet(LS_SPACE, DEFAULT_SPACE);
  if(firebaseConfig && firebaseConfig.projectId && space.length >= 8){
    try {
      setSyncUI('cloud', '동기화 중');
      store = await cloudStore(space);
      return;
    } catch(err){
      flash('Firebase 연결에 실패해 이 기기에만 저장합니다: ' + err.message);
    }
  }
  setSyncUI('local', '이 기기에만 저장');
  store = localStore();
  render();
})();
