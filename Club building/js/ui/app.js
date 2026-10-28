// 앱 제어: 상태를 들고 화면을 그리고, 버튼 동작을 게임 로직 함수로 연결한다.

import {
  createNewGame, chooseLeague, advance, startUserMatch, simulateUserMatch, finishUserMatch,
  simulateToSeasonEnd, startNextSeason, callUpYouth, sendDownToYouth, STATE_VERSION,
  renewContract, upgradeFacility, setStaffLevel,
  bidForPlayer, offerTerms, respondToOffer, setTransferListed, loanOut, offerLoan, buyLoanedPlayer,
  fireManager, hireManager, answerRequest,
} from '../core/game.js';
import { FACILITIES, PROMISES } from '../data/economy.js';
import { won } from './format.js';
import { withParticle } from '../core/korean.js';
import { saveState, loadState, clearState, exportState, importState } from '../save/storage.js';
import {
  newGameView, layout, homeView, squadView, tacticsView, scheduleView, tableView, settingsView,
  fixtureDetail, seasonEndBanner, youthView, historyView, clubView, financeView,
} from './views.js';
import { LiveMatchView } from './match.js';
import { transfersView } from './transfers.js';
import { managerView } from './manager.js';

export class App {
  constructor(root) {
    this.root = root;
    this.state = null;
    this.ui = { view: 'home' };
    this.live = null;
    root.addEventListener('click', (ev) => this.onClick(ev));
    root.addEventListener('change', (ev) => this.onChange(ev));
  }

  async start() {
    try {
      this.state = (await loadState()) ?? null;
      if (this.state && this.state.version !== STATE_VERSION) {
        this.state = null;
        this.ui.error = '이전 버전에서 저장한 게임이라 이어서 할 수 없습니다. 새 게임을 시작해 주세요.';
      }
    } catch (err) {
      console.error(err);
      this.ui.error = '저장된 게임을 불러오지 못했습니다.';
    }
    this.render();
  }

  persist() {
    if (!this.state) return;
    saveState(this.state).catch((err) => console.error('저장 실패', err));
  }

  // ---- 그리기 ----

  render() {
    this.live?.destroy();
    this.live = null;
    const s = this.state;
    if (!s || s.phase === 'chooseClub' || !s.user) {
      this.root.className = 'app newgame-root';
      this.root.innerHTML = newGameView(s, this.ui);
      return;
    }
    this.root.className = 'app';
    if (this.ui.view === 'match') {
      this.root.innerHTML = layout(s, this.ui, '');
      this.live = new LiveMatchView({
        state: s,
        root: this.root.querySelector('#content'),
        persist: () => this.persist(),
        onFinish: () => this.afterUserMatch(),
      });
      return;
    }
    const views = {
      home: homeView, squad: squadView, tactics: tacticsView, youth: youthView, schedule: scheduleView,
      table: tableView, history: historyView, settings: settingsView, club: clubView, finance: financeView, transfers: transfersView, manager: managerView,
    };
    let content = (views[this.ui.view] ?? homeView)(s, this.ui);
    if (s.phase === 'seasonEnd' && this.ui.view === 'home') content = seasonEndBanner(s, this.ui) + content;
    if (this.ui.fixtureId) content += fixtureDetail(s, this.ui.fixtureId);
    this.root.innerHTML = layout(s, this.ui, content);
  }

  // ---- 진행 ----

  // "계속": 한 주 진행. 경기 보기를 켜 두었으면 우리 경기 날 멈춰 중계를 연다
  continue() {
    const s = this.state;
    if (s.liveMatch) return this.openMatch();
    const res = advance(s, { watchMatches: s.settings.viewMode !== 'result' });
    if (res.stop === 'userMatch') {
      startUserMatch(s);
      this.persist();
      this.openMatch();
      return;
    }
    this.persist();
    this.ui.view = res.stop === 'transferOffer' ? 'transfers' : 'home';
    this.render();
  }

  openMatch() {
    this.ui.view = 'match';
    this.render();
  }

  afterUserMatch() {
    const s = this.state;
    const fixture = finishUserMatch(s);
    s.inbox.forEach((m) => { m.read = true; });
    this.persist();
    this.ui.view = 'home';
    this.ui.fixtureId = fixture.id;
    this.render();
  }

  nextSeason() {
    this.ui.busy = true;
    this.render();
    setTimeout(() => {
      startNextSeason(this.state);
      this.ui.busy = false;
      this.ui.view = 'home';
      this.ui.round = null;
      this.ui.tableLeague = null;
      this.persist();
      this.render();
    }, 30);
  }

  toSeasonEnd() {
    if (!confirm('내 경기도 결과만으로 처리하며 시즌 끝까지 진행합니다. 계속할까요?')) return;
    this.ui.busy = true;
    this.render();
    // 화면이 "진행 중"을 그린 다음 계산한다
    setTimeout(() => {
      if (this.state.liveMatch) {
        simulateUserMatch(this.state);
        finishUserMatch(this.state);
      }
      const res = simulateToSeasonEnd(this.state, { skipOffers: false });
      this.ui.busy = false;
      this.ui.view = res.stop === 'transferOffer' ? 'transfers' : 'home';
      this.persist();
      this.render();
    }, 30);
  }

  // ---- 이벤트 ----

  onClick(ev) {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    if (el.dataset.action === 'closeModal' && ev.target.closest('[data-stop]') && !ev.target.closest('button')) return;
    const a = el.dataset.action;
    const d = el.dataset;
    const s = this.state;
    switch (a) {
      case 'generateWorld': {
        const name = this.root.querySelector('#managerName').value.trim();
        const seed = this.root.querySelector('#seed').value.trim();
        this.ui.managerName = name;
        this.ui.seedInput = seed;
        this.ui.error = null;
        this.ui.preview = createNewGame(seed || String(Date.now()));
        this.render();
        break;
      }
      case 'pickLeague': {
        const name = (this.root.querySelector('#managerName')?.value ?? this.ui.managerName ?? '').trim();
        if (!name) {
          this.ui.error = '단장 이름을 입력하세요.';
          this.render();
          return;
        }
        this.state = this.ui.preview;
        chooseLeague(this.state, d.league, name);
        this.ui = { view: 'home' };
        this.persist();
        this.render();
        break;
      }
      case 'fireManager': {
        if (!confirm('감독을 해고할까요? 위약금이 나갑니다.')) return;
        const res = fireManager(s);
        this.ui.managerMsg = { ok: res.ok, text: res.ok ? `위약금 ${won(res.compensation)}을 내고 해고했습니다.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'hireManager': {
        const res = hireManager(s, d.id);
        this.ui.managerMsg = { ok: res.ok, text: res.ok ? `${res.coach.name} 감독과 계약했습니다.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'answerRequest': {
        const res = answerRequest(s, Number(d.id), d.answer);
        this.ui.transferMsg = { ok: res.ok, text: res.ok ? (d.answer === 'approve' ? '승인했습니다. 진행 중인 협상에서 이적료를 제안하세요.' : '요청을 거절했습니다.') : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'nav':
        this.ui.view = d.view;
        this.ui.fixtureId = null;
        this.ui.clubMsg = null;
        this.ui.transferMsg = null;
        this.ui.managerMsg = null;
        this.render();
        break;
      case 'upgradeFacility': {
        const name = FACILITIES[d.key].name;
        if (!confirm(`${name} 업그레이드를 수뇌부에 요청할까요? 승인되면 공사비가 바로 나갑니다.`)) return;
        const res = upgradeFacility(s, d.key);
        this.ui.clubMsg = { ok: res.ok, text: res.ok ? `${name} 공사를 시작합니다. 공사비 ${won(res.cost)}, ${res.months}개월 뒤 완료됩니다.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'staffLevel': {
        const res = setStaffLevel(s, d.key, Number(d.level));
        this.ui.clubMsg = res.ok ? null : { ok: false, text: res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'offerRenewal': {
        const wage = Number(this.root.querySelector('#offerWage').value) * 1e4;
        const years = Number(this.root.querySelector('#offerYears').value);
        const promise = this.root.querySelector('#offerPromise').value;
        const res = renewContract(s, d.id, { wage, years, promise });
        this.ui.contractMsg = { ok: res.ok, text: res.ok ? `${years}년, 주급 ${won(wage)}, ${PROMISES[promise].name} 약속으로 재계약했습니다.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'continue':
        this.continue();
        break;
      case 'searchPlayers': {
        const val = (id) => this.root.querySelector(id).value;
        const num = (id) => (val(id) === '' ? undefined : Number(val(id)));
        this.ui.search = {
          position: val('#sPosition') || undefined,
          leagueId: val('#sLeague') || undefined,
          minAge: num('#sMinAge'),
          maxAge: num('#sMaxAge'),
          maxValue: num('#sMaxValue') === undefined ? undefined : num('#sMaxValue') * 1e8,
          freeOnly: this.root.querySelector('#sFree').checked,
        };
        this.ui.transferMsg = null;
        this.render();
        break;
      }
      case 'selectTarget':
        this.ui.targetId = d.id || null;
        this.ui.transferMsg = null;
        this.render();
        break;
      case 'bidForPlayer': {
        const fee = Number(this.root.querySelector('#bidFee').value) * 1e8;
        const res = bidForPlayer(s, d.id, fee);
        this.ui.transferMsg = { ok: res.ok, text: res.ok ? `이적료 ${won(res.fee)}에 합의했습니다. 이제 선수와 개인 조건을 협상하세요.` : `${res.reason}${res.counter ? ` (${won(res.counter)})` : ''}` };
        this.persist();
        this.render();
        break;
      }
      case 'offerTerms': {
        const wage = Number(this.root.querySelector('#termWage').value) * 1e4;
        const years = Number(this.root.querySelector('#termYears').value);
        const promise = this.root.querySelector('#termPromise').value;
        const name = s.players[d.id].name;
        const res = offerTerms(s, d.id, { wage, years, promise });
        this.ui.transferMsg = { ok: res.ok, text: res.ok ? `${name} 영입을 마쳤습니다. (${years}년, 주급 ${won(wage)})` : res.reason };
        if (res.ok) this.ui.targetId = null;
        this.persist();
        this.render();
        break;
      }
      case 'respondOffer': {
        const id = Number(d.id);
        const answer = d.answer === 'counter' ? { counter: Number(this.root.querySelector(`#counter-${id}`).value) * 1e8 } : d.answer;
        const res = respondToOffer(s, id, answer);
        this.ui.transferMsg = { ok: res.ok, text: res.ok ? (d.answer === 'reject' ? '제안을 거절했습니다.' : `이적료 ${won(res.fee)}에 선수를 보냈습니다.`) : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'loanOut': {
        const name = s.players[d.id].name;
        const res = loanOut(s, d.id);
        this.ui.contractMsg = { ok: res.ok, text: res.ok ? `${name} 임대가 정해졌습니다. 시즌이 끝나면 돌아옵니다.` : res.reason };
        if (res.ok) this.ui.playerId = null;
        this.persist();
        this.render();
        break;
      }
      case 'offerLoan': {
        const wageShare = Number(this.root.querySelector('#loanShare').value);
        const name = s.players[d.id].name;
        const res = offerLoan(s, d.id, { wageShare });
        this.ui.transferMsg = { ok: res.ok, text: res.ok ? `${withParticle(name, '를')} 시즌 끝까지 임대로 데려왔습니다. 완전 이적 옵션 ${won(res.optionFee)}.` : res.reason };
        if (res.ok) this.ui.targetId = null;
        this.persist();
        this.render();
        break;
      }
      case 'buyLoaned': {
        const res = buyLoanedPlayer(s, d.id);
        this.ui.contractMsg = { ok: res.ok, text: res.ok ? `옵션 금액 ${won(res.fee)}을 내고 완전 영입했습니다.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'toggleListed':
        setTransferListed(s, d.id, !s.players[d.id].transferListed);
        this.persist();
        this.render();
        break;
      case 'toSeasonEnd':
        this.toSeasonEnd();
        break;
      case 'nextSeason':
        this.nextSeason();
        break;
      case 'tableLeague':
      case 'historyLeague':
        this.ui[a] = d.league;
        this.render();
        break;
      case 'callUp':
        callUpYouth(s, d.id);
        this.persist();
        this.render();
        break;
      case 'sendDown':
        sendDownToYouth(s, d.id);
        this.persist();
        this.render();
        break;
      case 'showFixture':
        this.ui.fixtureId = d.id;
        this.render();
        break;
      case 'closeModal':
        this.ui.fixtureId = null;
        this.render();
        break;
      case 'selectPlayer':
        this.ui.playerId = d.id || null;
        this.ui.contractMsg = null;
        this.render();
        break;
      case 'squadSort':
        this.ui.squadSort = d.sort;
        this.render();
        break;
      case 'setRound':
        this.ui.round = Number(d.round);
        this.render();
        break;
      case 'exportSave':
        exportState(s);
        break;
      case 'newGame':
        if (!confirm('현재 진행 상황이 삭제됩니다. 새 게임을 시작할까요?')) return;
        clearState().finally(() => {
          this.state = null;
          this.ui = { view: 'home' };
          this.render();
        });
        break;
      default:
    }
  }

  onChange(ev) {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const s = this.state;
    const d = el.dataset;
    switch (d.change) {
      case 'importSave': {
        const file = el.files?.[0];
        if (!file) return;
        importState(file)
          .then((loaded) => {
            if (loaded.version !== STATE_VERSION) throw new Error('이전 버전에서 저장한 파일이라 불러올 수 없습니다.');
            this.state = loaded;
            this.ui = { view: 'home' };
            this.persist();
            this.render();
          })
          .catch((err) => {
            this.ui.error = err.message;
            this.render();
          });
        break;
      }
      case 'setViewMode':
        s.settings.viewMode = el.value;
        this.persist();
        break;
      case 'toggleAutoSubs':
        s.settings.autoSubs = el.checked;
        this.persist();
        break;
      case 'togglePause':
        s.settings.pauses[d.key] = el.checked;
        this.persist();
        break;
      default:
    }
  }
}
