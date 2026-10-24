// 내 경기 화면: 하이라이트 / 전체 중계 재생, 결정 순간 멈춤, 교체와 전술 변경

import { stepMinute, isFinished, substitute, changeTactics, clockLabel } from '../core/match/engine.js';
import { commentary } from '../core/match/commentary.js';
import { isHighlight, pauseReason } from '../core/match/viewing.js';
import { withMatchRng } from '../core/game.js';
import { FORMATION_KEYS } from '../data/formations.js';
import { MENTALITIES, PRESSING, TEMPO, LINE } from '../core/tactics.js';
import { ROLES } from '../data/roles.js';
import { esc, clubLabel, posLabel, conditionBar } from './format.js';
import { VIEW_MODES } from './views.js';

// 재생 속도 (밀리초)
const SPEED = {
  highlights: { minute: 300, event: 1500 },
  full: { minute: 700, event: 1300 },
};

const ICON = {
  injury: '🚑', goal: '⚽', yellow: '🟨', secondYellow: '🟥', red: '🟥', sub: '🔁', save: '🧤', woodwork: '🥅',
  penalty: '❗', halftime: '⏸', fulltime: '🏁', kickoff: '▶', secondHalf: '▶',
};

const options = (map, current) =>
  Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === current ? 'selected' : ''}>${esc(v)}</option>`).join('');

export class LiveMatchView {
  constructor({ state, root, onFinish, persist }) {
    this.state = state;
    this.root = root;
    this.onFinish = onFinish;
    this.persist = persist;
    this.match = state.liveMatch;
    this.userSide = this.match.sides[0].clubId === state.manager.clubId ? 0 : 1;
    this.mode = state.settings.viewMode === 'full' ? 'full' : 'highlights';
    this.flags = {};
    this.log = [];
    this.timer = null;
    this.running = false;
    this.pause = null; // 멈춘 이유
    this.panel = false; // 교체·전술 패널 열림
    // 저장했다가 다시 연 경기라면 지난 이벤트를 다시 보여준다
    for (const e of this.match.events) if (this.visible(e)) this.log.push(this.line(e));
    root.addEventListener('click', (ev) => this.onClick(ev));
    root.addEventListener('change', (ev) => this.onChange(ev));
    this.render();
    if (isFinished(this.match)) return;
    if (this.match.phase === 'pre') this.play();
    else this.stop('경기를 이어서 진행합니다');
  }

  get names() {
    return { home: this.state.clubs[this.match.sides[0].clubId].name, away: this.state.clubs[this.match.sides[1].clubId].name };
  }

  visible(e) {
    if (e.type === 'tactics') return e.side === this.userSide;
    return this.mode === 'full' ? true : isHighlight(e);
  }

  line(e) {
    const mine = e.side === this.userSide;
    return {
      clock: e.type === 'kickoff' || e.type === 'secondHalf' ? '' : e.clock,
      icon: ICON[e.type] ?? '',
      text: commentary(this.match, e, this.names),
      cls: `${e.type} ${e.side === undefined ? '' : mine ? 'mine' : 'theirs'}`,
    };
  }

  play() {
    if (isFinished(this.match)) return;
    this.pause = null;
    this.panel = false;
    this.running = true;
    this.render();
    this.schedule(50);
  }

  stop(reason) {
    this.running = false;
    clearTimeout(this.timer);
    this.pause = reason;
    this.persist();
    this.render();
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), ms);
  }

  tick() {
    if (!this.running) return;
    const events = withMatchRng(this.state, (rng) => stepMinute(this.match, rng));
    const shown = events.filter((e) => this.visible(e));
    for (const e of shown) this.log.push(this.line(e));
    if (isFinished(this.match)) {
      this.running = false;
      this.persist();
      this.render();
      return;
    }
    const reason = pauseReason(this.match, this.userSide, events, this.state.settings.pauses, this.flags);
    if (reason) {
      this.stop(reason);
      return;
    }
    this.renderLive();
    const speed = SPEED[this.mode];
    this.schedule(shown.some((e) => e.type !== 'tactics') ? speed.event : speed.minute);
  }

  // 남은 시간을 한 번에 계산한다
  skip() {
    clearTimeout(this.timer);
    this.running = false;
    const side = this.match.sides[this.userSide];
    side.auto = true;
    withMatchRng(this.state, (rng) => {
      while (!isFinished(this.match)) {
        for (const e of stepMinute(this.match, rng)) if (isHighlight(e) && e.type !== 'sub') this.log.push(this.line(e));
      }
    });
    this.persist();
    this.render();
  }

  destroy() {
    clearTimeout(this.timer);
    this.running = false;
  }

  onClick(ev) {
    const el = ev.target.closest('[data-m]');
    if (!el) return;
    const act = el.dataset.m;
    if (act === 'play') this.play();
    if (act === 'pause') this.stop('일시정지');
    if (act === 'panel') {
      this.panel = !this.panel;
      if (this.running) this.stop('교체·전술');
      else this.render();
    }
    if (act === 'mode') {
      this.mode = this.mode === 'full' ? 'highlights' : 'full';
      this.render();
    }
    if (act === 'skip') this.skip();
    if (act === 'sub') {
      const out = this.root.querySelector('#subOut').value;
      const inn = this.root.querySelector('#subIn').value;
      const res = substitute(this.match, this.userSide, out, inn);
      if (res.ok) this.log.push(this.line(res.event));
      this.subError = res.ok ? null : res.reason;
      this.render();
    }
    if (act === 'finish') {
      this.destroy();
      this.onFinish();
    }
  }

  onChange(ev) {
    const el = ev.target.closest('[data-mt]');
    if (!el) return;
    changeTactics(this.match, this.userSide, { [el.dataset.mt]: el.value });
    this.log.push({ clock: clockLabel(this.match), icon: '📋', text: '전술을 바꿨습니다.', cls: 'tactics mine' });
    this.render();
  }

  // 진행 중에는 점수판과 중계만 다시 그린다 (선택 상자가 닫히지 않도록)
  renderLive() {
    const board = this.root.querySelector('.scoreboard');
    const log = this.root.querySelector('.commentary');
    const lineup = this.root.querySelector('.my-lineup');
    if (!board || !log) return this.render();
    board.outerHTML = this.scoreboard();
    log.innerHTML = this.logHtml();
    if (lineup) lineup.outerHTML = this.lineupHtml();
  }

  scoreboard() {
    const m = this.match;
    const [h, a] = m.sides;
    const clock = m.phase === 'pre' ? '경기 전' : m.phase === 'ht' ? '하프타임' : m.phase === 'ft' ? '경기 종료' : clockLabel(m);
    const poss = Math.round((h.possession / Math.max(1, h.possession + a.possession)) * 100);
    return `<div class="scoreboard">
      <div class="team">${clubLabel(this.state.clubs[h.clubId], this.userSide === 0)}</div>
      <div class="score"><strong>${h.score} - ${a.score}</strong><div class="clock">${clock}</div></div>
      <div class="team">${clubLabel(this.state.clubs[a.clubId], this.userSide === 1)}</div>
      <div class="mini-stats muted small">슈팅 ${h.shots}(${h.onTarget}) - ${a.shots}(${a.onTarget}) · 점유 ${poss}% - ${100 - poss}%</div>
    </div>`;
  }

  logHtml() {
    return this.log.slice().reverse().map((l) => `<div class="c-line ${l.cls}"><span class="c-clock">${l.clock}</span><span class="c-icon">${l.icon}</span><span>${esc(l.text)}</span></div>`).join('');
  }

  lineupHtml() {
    const side = this.match.sides[this.userSide];
    const p = this.match.players;
    return `<div class="my-lineup">
      <h4>우리 팀 <span class="muted small">교체 ${side.subsUsed}/${side.maxSubs}</span></h4>
      ${side.onPitch.map((s) => `<div class="lu ${s.sentOff || s.injured ? 'off' : ''}">${posLabel(s.pos)} <span>${esc(p[s.playerId].name)}</span>${s.yellow ? '<span class="card-y"></span>' : ''}${s.sentOff ? '<span class="card-r"></span>' : ''}${s.injured ? '🚑' : ''}${conditionBar(s.energy)}</div>`).join('')}
    </div>`;
  }

  panelHtml() {
    const side = this.match.sides[this.userSide];
    const p = this.match.players;
    const t = side.tactics;
    const canSub = side.subsUsed < side.maxSubs && side.bench.length > 0;
    return `<div class="card match-panel">
      <h4>교체</h4>
      ${canSub ? `<div class="form-row">
        <select id="subOut">${side.onPitch.filter((s) => !s.sentOff).sort((a, b) => b.injured - a.injured).map((s) => `<option value="${s.playerId}">${s.pos} ${esc(p[s.playerId].name)} ${s.injured ? '(부상)' : `(체력 ${Math.round(s.energy)})`}</option>`).join('')}</select>
        <span>→</span>
        <select id="subIn">${side.bench.map((id) => `<option value="${id}">${p[id].position} ${esc(p[id].name)}</option>`).join('')}</select>
        <button class="btn primary small" data-m="sub">교체</button>
      </div>` : '<p class="muted small">더 이상 교체할 수 없습니다.</p>'}
      ${this.subError ? `<p class="error small">${esc(this.subError)}</p>` : ''}
      <h4>전술</h4>
      <div class="form-row">
        <label>포메이션 <select data-mt="formation">${FORMATION_KEYS.map((f) => `<option ${f === t.formation ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label>성향 <select data-mt="mentality">${options(MENTALITIES, t.mentality)}</select></label>
        <label>압박 <select data-mt="pressing">${options(PRESSING, t.pressing)}</select></label>
        <label>템포 <select data-mt="tempo">${options(TEMPO, t.tempo)}</select></label>
        <label>라인 <select data-mt="line">${options(LINE, t.line)}</select></label>
      </div>
      <p class="muted small">역할: ${side.onPitch.filter((s) => !s.sentOff).map((s) => `${s.pos} ${esc(ROLES[s.role].name)}`).join(' · ')}</p>
    </div>`;
  }

  summaryHtml() {
    const m = this.match;
    const mine = Object.entries(m.stats)
      .filter(([, st]) => st.side === this.userSide && st.minutes > 0)
      .sort((a, b) => b[1].rating - a[1].rating);
    return `<div class="card match-summary">
      <h3>경기 종료</h3>
      <div class="attrs">${mine.map(([pid, st]) => `<div class="attr"><span>${esc(m.players[pid].name)} <span class="muted small">${st.minutes}분${st.goals ? ` · ${st.goals}골` : ''}${st.assists ? ` · ${st.assists}도움` : ''}</span></span><span class="${st.rating >= 7.5 ? 'a-high' : st.rating >= 6.8 ? 'a-good' : st.rating >= 6 ? 'a-mid' : 'a-low'}">${st.rating.toFixed(1)}</span></div>`).join('')}</div>
      <button class="btn primary" data-m="finish">결과 확인하고 계속 ▶</button>
    </div>`;
  }

  controls() {
    if (isFinished(this.match)) return '';
    return `<div class="match-controls">
      ${this.running
        ? '<button class="btn" data-m="pause">⏸ 일시정지</button>'
        : `<button class="btn primary" data-m="play">▶ ${this.match.phase === 'ht' ? '후반전 시작' : '계속'}</button>`}
      <button class="btn" data-m="panel">교체·전술</button>
      <button class="btn" data-m="mode">${this.mode === 'full' ? '하이라이트로 전환' : '전체 중계로 전환'}</button>
      <button class="btn" data-m="skip">건너뛰기 ⏭</button>
      <span class="muted small">${VIEW_MODES[this.mode]}</span>
      ${this.pause ? `<span class="pause-reason">⏸ ${esc(this.pause)}</span>` : ''}
    </div>`;
  }

  render() {
    const finished = isFinished(this.match);
    this.root.innerHTML = `
      <div class="match-view">
        ${this.scoreboard()}
        ${this.controls()}
        ${!finished && (this.panel || (this.pause && this.pause !== '일시정지')) ? this.panelHtml() : ''}
        ${finished ? this.summaryHtml() : ''}
        <div class="match-body">
          <div class="card commentary">${this.logHtml()}</div>
          <div class="card">${this.lineupHtml()}</div>
        </div>
      </div>`;
  }
}
