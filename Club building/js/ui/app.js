// 앱 제어: 상태를 들고 화면을 그리고, 버튼 동작을 게임 로직 함수로 연결한다.

import {
  createNewGame, chooseClub, advance, startUserMatch, simulateUserMatch, finishUserMatch,
  simulateToSeasonEnd, userClub, userLeagueId, startNextSeason, chooseNewClub, callUpYouth, sendDownToYouth,
} from '../core/game.js';
import { unavailableSet } from '../core/state.js';
import { autoLineup, resolveLineup } from '../core/tactics.js';
import { FORMATIONS } from '../data/formations.js';
import { DEFAULT_ROLE, ROLES } from '../data/roles.js';
import { saveState, loadState, clearState, exportState, importState } from '../save/storage.js';
import {
  newGameView, layout, homeView, squadView, tacticsView, scheduleView, tableView, settingsView,
  fixtureDetail, seasonEndBanner, chooseJobView, youthView, historyView,
} from './views.js';
import { LiveMatchView } from './match.js';

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
    if (!s || s.phase === 'chooseClub' || !s.manager) {
      this.root.className = 'app newgame-root';
      this.root.innerHTML = newGameView(s, this.ui);
      return;
    }
    if (s.phase === 'chooseJob') {
      this.root.className = 'app newgame-root';
      this.root.innerHTML = chooseJobView(s, this.ui);
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
      table: tableView, history: historyView, settings: settingsView,
    };
    let content = (views[this.ui.view] ?? homeView)(s, this.ui);
    if (s.phase === 'seasonEnd' && this.ui.view === 'home') content = seasonEndBanner(s, this.ui) + content;
    if (this.ui.fixtureId) content += fixtureDetail(s, this.ui.fixtureId);
    this.root.innerHTML = layout(s, this.ui, content);
  }

  // ---- 진행 ----

  continue() {
    const s = this.state;
    if (s.liveMatch) return this.openMatch();
    const res = advance(s);
    if (res.stop === 'userMatch') {
      if (s.settings.viewMode === 'result') {
        simulateUserMatch(s);
        this.afterUserMatch();
        return;
      }
      startUserMatch(s);
      this.persist();
      this.openMatch();
      return;
    }
    this.persist();
    this.ui.view = 'home';
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
      simulateToSeasonEnd(this.state);
      this.ui.busy = false;
      this.ui.view = 'home';
      this.persist();
      this.render();
    }, 30);
  }

  // ---- 전술 편집 ----

  editLineup(fn) {
    const club = userClub(this.state);
    const t = club.tactics;
    const current = resolveLineup(club, this.state.players, { unavailable: unavailableSet(this.state, userLeagueId(this.state), club) });
    t.lineup = current.lineup.map((e) => (e ? { ...e } : null));
    t.bench = null;
    fn(t);
    this.persist();
    this.render();
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
      case 'pickClub': {
        const name = (this.root.querySelector('#managerName')?.value ?? this.ui.managerName ?? '').trim();
        if (!name) {
          this.ui.error = '감독 이름을 입력하세요.';
          this.render();
          return;
        }
        this.state = this.ui.preview;
        chooseClub(this.state, d.id, name);
        this.ui = { view: 'home' };
        this.persist();
        this.render();
        break;
      }
      case 'nav':
        this.ui.view = d.view;
        this.ui.fixtureId = null;
        this.render();
        break;
      case 'continue':
        this.continue();
        break;
      case 'toSeasonEnd':
        this.toSeasonEnd();
        break;
      case 'nextSeason':
        this.nextSeason();
        break;
      case 'previewLeague':
        this.ui.managerName = this.root.querySelector('#managerName')?.value ?? this.ui.managerName;
        this.ui.previewLeague = d.league;
        this.render();
        break;
      case 'tableLeague':
      case 'historyLeague':
      case 'jobLeague':
        this.ui[a] = d.league;
        this.render();
        break;
      case 'takeJob':
        chooseNewClub(s, d.id);
        this.ui = { view: 'home' };
        this.persist();
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
      case 'autoLineupNow': {
        const club = userClub(s);
        const squad = club.squad.map((id) => s.players[id]);
        const { lineup, bench } = autoLineup(squad, club.tactics.formation, { unavailable: unavailableSet(s, userLeagueId(s), club) });
        club.tactics.lineup = lineup;
        club.tactics.bench = bench;
        this.persist();
        this.render();
        break;
      }
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
      case 'setTactic': {
        const club = userClub(s);
        const value = el.value || null;
        if (d.key === 'formation') {
          club.tactics.formation = value;
          if (club.tactics.lineup) {
            // 같은 선수들을 새 포메이션 자리에 다시 배치한다
            const slots = FORMATIONS[value];
            club.tactics.lineup = club.tactics.lineup.map((e, i) => e && {
              playerId: e.playerId,
              role: ROLES[e.role]?.positions.includes(slots[i]) ? e.role : DEFAULT_ROLE[slots[i]],
            });
          }
        } else {
          club.tactics[d.key] = value;
        }
        this.persist();
        this.render();
        break;
      }
      case 'setSlotPlayer':
        this.editLineup((t) => {
          const i = Number(d.slot);
          const other = t.lineup.findIndex((e) => e?.playerId === el.value);
          // 이미 선발인 선수를 고르면 두 자리를 맞바꾼다
          if (other >= 0) t.lineup[other] = t.lineup[i] && { ...t.lineup[i], role: t.lineup[other].role };
          t.lineup[i] = { playerId: el.value, role: t.lineup[i]?.role ?? DEFAULT_ROLE[FORMATIONS[t.formation][i]] };
        });
        break;
      case 'setSlotRole':
        this.editLineup((t) => {
          t.lineup[Number(d.slot)].role = el.value;
        });
        break;
      case 'toggleAutoLineup': {
        const club = userClub(s);
        if (el.checked) {
          club.tactics.lineup = null;
          club.tactics.bench = null;
          this.persist();
          this.render();
        } else {
          this.editLineup(() => {});
        }
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
