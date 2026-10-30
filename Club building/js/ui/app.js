// 앱 제어: 상태를 들고 화면을 그리고, 버튼 동작을 게임 로직 함수로 연결한다.

import {
  createNewGame, chooseLeague, advance, startUserMatch, simulateUserMatch, finishUserMatch,
  simulateToSeasonEnd, startNextSeason, callUpYouth, sendDownToYouth, STATE_VERSION,
  renewContract, upgradeFacility, setStaffLevel,
  bidForPlayer, offerTerms, respondToOffer, setTransferListed, loanOut, offerLoan, buyLoanedPlayer,
  fireManager, hireManager, answerRequest,
  openMessage, markViewRead, markAllRead, firingCost, userClub,
  adjustBudgets, upgradeState, setTicketPrice, forecast, seasonForecast, orderMerch, setMerchPrice, ITEMS, pitchSponsor, answerSponsor, rejectSponsor, chooseTour, SLOTS, INDUSTRIES, TOURS, bookEvent, cancelEvent, askCoach, setRegistered, releasePlayer, releaseCost, buildPitchSystem, answerRental, startCampaign, EVENTS, CAMPAIGNS,
} from '../core/game.js';
import { FACILITIES, PROMISES } from '../data/economy.js';
import { won } from './format.js';
import { upgradeInfo } from '../core/facilities.js';
import { withParticle } from '../core/korean.js';
import { saveState, loadState, clearState, exportState, importState } from '../save/storage.js';
import {
  newGameView, layout, homeView, squadView, scheduleView, tableView, settingsView,
  fixtureDetail, seasonEndBanner, confirmModal, historyView, clubView, financeView, fansView, forecastText, merchForecastText, sponsorsView,
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
    root.addEventListener('input', (ev) => this.onInput(ev));
  }

  async start() {
    try {
      this.state = (await loadState()) ?? null;
      if (this.state) upgradeState(this.state);
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
      home: homeView, squad: squadView, schedule: scheduleView,
      table: tableView, history: historyView, settings: settingsView, club: clubView, finance: financeView, fans: fansView, sponsors: sponsorsView, transfers: transfersView, manager: managerView,
    };
    let content = (views[this.ui.view] ?? homeView)(s, this.ui);
    if (s.phase === 'seasonEnd' && this.ui.view === 'home') content = seasonEndBanner(s, this.ui) + content;
    if (this.ui.fixtureId) content += fixtureDetail(s, this.ui.fixtureId);
    if (this.ask) content += confirmModal(this.ask);
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
    this.ui.view = res.stop === 'transferOffer' ? 'transfers' : res.stop === 'decision' ? res.view : 'home';
    this.ui.decision = res.stop === 'decision' ? [...new Set(res.titles)] : null;
    this.render();
  }

  openMatch() {
    this.ui.view = 'match';
    this.render();
  }

  afterUserMatch() {
    const s = this.state;
    const fixture = finishUserMatch(s);
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

  // 게임 안 확인 창을 띄우고, 확인하면 run을 실행한다
  confirm(ask, run) {
    this.ask = { ...ask, run };
    this.render();
  }

  toSeasonEnd() {
    if (!this.ask?.confirmed) return this.confirm({ title: '시즌 끝까지 진행', text: '내 경기도 결과만으로 처리하며 시즌 끝까지 진행합니다. 계속할까요?', yes: '진행' }, () => this.toSeasonEnd());
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
      this.ui.view = res.stop === 'transferOffer' ? 'transfers' : res.stop === 'decision' ? res.view : 'home';
      this.ui.decision = res.stop === 'decision' ? [...new Set(res.titles)] : null;
      this.persist();
      this.render();
    }, 30);
  }

  // ---- 이벤트 ----

  onClick(ev) {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    // 모달 안쪽을 눌렀을 때 바깥 배경의 닫기 동작이 잡히지 않게 한다
    const panel = ev.target.closest('[data-stop]');
    if (panel && !panel.contains(el)) return;
    const a = el.dataset.action;
    const d = el.dataset;
    const s = this.state;
    // 확인 창에서 확인을 누르면 원래 동작을 다시 실행하고, 그 동작 안에서는 다시 묻지 않는다
    if (a === 'confirmYes' || a === 'confirmNo') {
      const ask = this.ask;
      this.ask = null;
      if (a === 'confirmYes') {
        this.ask = { confirmed: true };
        ask.run();
        this.ask = null;
      }
      this.render();
      return;
    }
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
        if (!this.ask?.confirmed) return this.confirm({ title: '감독 해고', text: `감독을 해고할까요? 위약금 ${withParticle(won(firingCost(s)), '이')} 나갑니다.`, yes: '해고' }, () => this.onClick(ev));
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
      case 'showProfile':
        this.ui.profileId = d.id || null;
        this.render();
        break;
      case 'logScope':
        this.ui.logScope = d.scope;
        this.render();
        break;
      case 'readAll':
        markAllRead(s);
        this.persist();
        this.render();
        break;
      case 'openMessage': {
        const view = openMessage(this.state, d.id);
        if (view) {
          this.ui.view = view;
          markViewRead(this.state, view);
        }
        this.persist();
        this.render();
        break;
      }
      case 'squadTab':
        this.ui.squadTab = d.tab;
        this.ui.playerId = null;
        this.render();
        break;
      case 'nav':
        this.ui.view = d.view;
        markViewRead(this.state, d.view);
        this.persist();
        this.ui.fixtureId = null;
        this.ui.merchItem = null;
        this.ui.pitchSlot = null;
        this.ui.sponsorMsg = null;
        this.ui.fanMsg = null;
        this.ui.decision = null;
        this.ui.tourRegion = null;
        this.ui.budgetOpen = false;
        this.ui.eventFixture = null;
        this.ui.clubMsg = null;
        this.ui.transferMsg = null;
        this.ui.managerMsg = null;
        this.render();
        break;
      case 'upgradeFacility': {
        const name = FACILITIES[d.key].name;
        const info = upgradeInfo(userClub(s), d.key);
        if (!this.ask?.confirmed) return this.confirm({ title: `${name} 업그레이드`, text: info ? `${withParticle(name, '를')} 업그레이드할까요? 공사비 ${withParticle(won(info.cost), '이')} 바로 나가고 ${info.months}개월 뒤 완료됩니다.` : `${withParticle(name, '를')} 업그레이드할까요?`, yes: '공사 시작' }, () => this.onClick(ev));
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
      case 'askCoach': {
        const res = askCoach(s);
        this.ui.managerMsg = { ok: res.ok, text: res.ok ? `감독이 ${res.made.length}명을 추천했습니다. 이적 탭의 영입 요청에서 승인하거나 거절하세요.${res.open ? '' : ' 지금은 이적시장이 닫혀 있어, 승인하면 다음 시장이 열릴 때 협상할 수 있습니다.'}` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'openBudget':
        this.ui.budgetOpen = !!d.open;
        this.render();
        break;
      case 'openTour':
        this.ui.tourRegion = d.region || null;
        this.render();
        break;
      case 'openPitch':
        this.ui.pitchSlot = d.slot || null;
        this.render();
        break;
      case 'pitchSponsor': {
        const res = pitchSponsor(s, d.slot, d.industry);
        this.ui.pitchSlot = null;
        this.ui.sponsorMsg = { ok: res.ok, text: res.ok ? `${SLOTS[d.slot].name} 자리에 ${INDUSTRIES[d.industry].name} 업종 영업을 시작했습니다. ${res.ready}쯤 결과가 나옵니다.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'sponsorAccept':
      case 'sponsorAsk': {
        const ask = d.action === 'sponsorAsk' ? Number(this.root.querySelector(`#ask-${d.id}`).value) * 1e8 : null;
        const res = answerSponsor(s, d.id, ask === null ? { accept: true } : { ask });
        this.ui.sponsorMsg = { ok: res.ok, text: res.ok ? `${withParticle(res.contract.company, '와')} 연 ${won(res.contract.amount)}, ${res.contract.until.slice(0, 4)}년 6월까지 계약했습니다.${res.contract.from ? ` (지금 계약이 끝난 뒤 ${res.contract.from}부터)` : ''}` : res.reason.replace(/연 ([0-9,]+)원/, (m, n) => `연 ${won(Number(n.replace(/,/g, '')))}`) };
        this.persist();
        this.render();
        break;
      }
      case 'sponsorReject':
        rejectSponsor(s, d.id);
        this.ui.sponsorMsg = { ok: true, text: '제안을 거절했습니다.' };
        this.persist();
        this.render();
        break;
      case 'chooseTour': {
        const res = chooseTour(s, d.region);
        this.ui.sponsorMsg = { ok: res.ok, text: res.ok ? (d.region === 'none' ? '이번 시즌은 투어를 가지 않습니다.' : `${TOURS[d.region].name} 투어를 떠납니다. 7월 31일에 돌아옵니다.`) : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'openEvent':
        this.ui.eventFixture = d.id || null;
        this.ui.eventMsg = null;
        this.render();
        break;
      case 'bookEvent': {
        const res = bookEvent(s, d.id, d.kind);
        this.ui.eventMsg = { ok: res.ok, text: res.ok ? `${withParticle(EVENTS[d.kind].name, '을')} 예약했습니다. 비용 ${won(res.cost)}.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'cancelEvent': {
        const res = cancelEvent(s, d.id);
        this.ui.eventMsg = { ok: res.ok, text: res.ok ? `행사를 취소했습니다. ${withParticle(won(res.refund), '을')} 돌려받았습니다.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'startCampaign': {
        const res = startCampaign(s, d.kind);
        this.ui.fanMsg = { ok: res.ok, text: res.ok ? `${withParticle(CAMPAIGNS[d.kind].name, '을')} 시작했습니다. 참여: ${res.campaign.players.join(', ')}.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'rentalAnswer': {
        const res = answerRental(s, d.id, !!d.accept);
        this.ui.sponsorMsg = { ok: res.ok, text: res.ok ? (d.accept ? `${res.offer.date} 대관을 잡았습니다. 대관료 ${won(res.offer.fee)}.` : '대관 제안을 거절했습니다.') : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'buildPitchSystem': {
        const res = buildPitchSystem(s);
        this.ui.sponsorMsg = { ok: res.ok, text: res.ok ? `잔디 보호 시스템 공사를 시작했습니다. ${won(res.cost)}, ${res.done} 완공 예정.` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'openMerch':
        this.ui.merchItem = d.item || null;
        this.ui.merchMsg = null;
        this.render();
        break;
      case 'merchOrder': {
        const price = Number(this.root.querySelector('#merchPrice').value);
        const quantity = Number(this.root.querySelector('#merchQty').value);
        const design = this.root.querySelector('#merchDesign')?.value;
        const res = orderMerch(s, d.item, { price, quantity, design });
        this.ui.merchMsg = { ok: res.ok, text: res.ok ? `${ITEMS[d.item].name} ${quantity.toLocaleString()}개를 주문했습니다. 생산비 ${won(res.cost)}.${res.arrive !== s.date ? ` ${res.arrive} 도착.` : ''}` : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'merchPrice': {
        const res = setMerchPrice(s, d.item, Number(this.root.querySelector('#merchPrice').value));
        this.ui.merchMsg = { ok: res.ok, text: res.ok ? '가격을 바꿨습니다.' : res.reason };
        this.persist();
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
      case 'setRegistered': {
        const res = setRegistered(s, d.id, d.registered === '1');
        this.ui.contractMsg = { ok: res.ok, text: res.ok ? (d.registered === '1' ? '1군에 등록했습니다.' : '등록을 해제했습니다. 이 선수는 경기에 나갈 수 없습니다.') : res.reason };
        this.persist();
        this.render();
        break;
      }
      case 'releasePlayer': {
        const p = s.players[d.id];
        if (!this.ask?.confirmed) return this.confirm({ title: `${p.name} 계약 해지`, text: `${withParticle(p.name, '와')} 계약을 해지할까요? 위약금 ${withParticle(won(releaseCost(s, p)), '이')} 바로 나갑니다.`, yes: '해지' }, () => this.onClick(ev));
        const res = releasePlayer(s, d.id);
        this.ui.contractMsg = { ok: res.ok, text: res.ok ? `${p.name} 계약을 해지했습니다. 위약금 ${won(res.cost)}.` : res.reason };
        if (res.ok) this.ui.playerId = null;
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
        if (!this.ask?.confirmed) return this.confirm({ title: '새 게임', text: '현재 진행 상황이 삭제됩니다. 새 게임을 시작할까요?', yes: '새로 시작' }, () => this.onClick(ev));
        clearState().finally(() => {
          this.state = null;
          this.ui = { view: 'home' };
          this.render();
        });
        break;
      default:
    }
  }

  // 재정 조정 바를 끄는 동안 금액만 바꿔 보여 준다
  onInput(ev) {
    const el = ev.target;
    if (el.dataset?.preview === 'merch') {
      const box = this.root.querySelector('#merchForecast');
      const price = Number(this.root.querySelector('#merchPrice').value);
      const qty = Number(this.root.querySelector('#merchQty').value);
      const design = this.root.querySelector('#merchDesign')?.value;
      box.textContent = merchForecastText(this.state, userClub(this.state), box.dataset.item, price, design);
      const cost = this.root.querySelector('#merchCost');
      cost.textContent = `생산비 ${won(Number(cost.dataset.unit) * qty)}`;
      return;
    }
    if (el.dataset?.change === 'ticketPrice') {
      const price = Number(el.value);
      this.root.querySelector(`#price-${el.dataset.grade}`).textContent = won(price);
      this.root.querySelector(`#fc-${el.dataset.grade}`).textContent = forecastText(userClub(this.state), el.dataset.grade, price);
      return;
    }
    if (el.dataset?.change !== 'wageBudget') return;
    const wage = Number(el.value);
    this.root.querySelector('#budgetWage').textContent = won(wage);
    this.root.querySelector('#budgetTransfer').textContent = won(Math.max(0, Number(el.dataset.pool) - wage * Number(el.dataset.weeks)));
  }

  onChange(ev) {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const s = this.state;
    const d = el.dataset;
    switch (d.change) {
      case 'ticketPrice':
        setTicketPrice(s, d.grade, Number(el.value));
        this.persist();
        this.render();
        return;
      case 'wageBudget':
        adjustBudgets(s, Number(el.value));
        this.persist();
        this.render();
        return;
      case 'importSave': {
        const file = el.files?.[0];
        if (!file) return;
        importState(file)
          .then((loaded) => {
            if (loaded.version !== STATE_VERSION) throw new Error('이전 버전에서 저장한 파일이라 불러올 수 없습니다.');
            this.state = upgradeState(loaded);
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
      case 'logSeason':
        this.ui.logSeason = Number(el.value);
        this.render();
        break;
      case 'setViewMode':
        s.settings.viewMode = el.value;
        this.persist();
        break;
      case 'toggleDecision':
        s.settings.decisions = { ...s.settings.decisions, [d.key]: el.checked };
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
