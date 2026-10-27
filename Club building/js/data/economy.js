// 경제 기준값. 금액은 유로 기준으로 적고 EUR(1유로 = 1,500원)을 곱해 원으로 쓴다.

export const EUR = 1500;

// 리그별 구단당 평균 중계권 수입 (시즌, 유로). 절반은 매달 똑같이, 절반은 시즌 끝 순위 상금
export const TV_PER_CLUB = {
  ENG1: 24e6, ESP1: 19e6, GER1: 17e6, ITA1: 18e6, FRA1: 12e6,
  ENG2: 4.5e6, ESP2: 3e6, GER2: 3.3e6, ITA2: 2.7e6, FRA2: 2.3e6,
  ENG3: 1e6, ESP3: 0.85e6, GER3: 1e6, ITA3: 0.65e6, FRA3: 0.6e6,
};
export const TV_EQUAL_SHARE = 0.5;

// 티켓 기본값 (유로). 리그 단계별, 나라 보정
export const TICKET_PRICE = { 1: 21, 2: 12, 3: 8 };
export const TICKET_COUNTRY = { ENG: 1.25, ESP: 1, GER: 0.9, ITA: 0.95, FRA: 0.9 };

// 경기장 수용 인원 기준 (리그 단계 → 강팀/중위권/약팀)
export const STADIUM_BASE = {
  1: { strong: 58000, mid: 36000, weak: 25000 },
  2: { strong: 24000, mid: 17000, weak: 12000 },
  3: { strong: 12000, mid: 8500, weak: 5500 },
};
// 경기장 레벨: 수용 인원 구간. 증축하면 다음 레벨 목표 인원까지 늘어난다
export const STADIUM_LEVELS = [0, 10000, 20000, 35000, 55000];
export const STADIUM_TARGET = { 2: 15000, 3: 27000, 4: 45000, 5: 65000 };

export const FACILITIES = {
  stadium: { name: '경기장', effect: '관중 수용 인원 → 입장 수입. 증축 공사 중에는 수용 인원이 20% 줄어든다' },
  training: { name: '훈련장', effect: '선수 성장 속도' },
  academy: { name: '유스 아카데미', effect: '유스 입단 시 현재 능력' },
  medical: { name: '의료 시설', effect: '부상 회복 속도' },
  recovery: { name: '수영장·회복 센터', effect: '경기 후 체력 회복 속도' },
  sportsScience: { name: '스포츠 과학 센터', effect: '부상 확률 감소' },
  housing: { name: '선수 숙소·클럽하우스', effect: '선수 사기 유지' },
  jet: { name: '전용기', effect: '선수 사기 유지 (4단계: 유럽 원정 피로 감소)' },
  megastore: { name: '메가스토어', effect: '평균 관중 수와 티켓값 증가' },
};
export const FACILITY_KEYS = Object.keys(FACILITIES);
export const MAX_FACILITY = 5;

// 업그레이드 비용(유로)과 공사 기간(개월). level은 지금 레벨
export const upgradeCost = (key, level) => (key === 'stadium' ? 4 : 1) * 1.5e6 * 2.5 ** (level - 1);
export const upgradeMonths = (key, level) => (key === 'stadium' ? 6 + 2 * level : 2 + level);
// 시설 유지비 (한 달, 유로)
export const facilityUpkeep = (level) => 4000 * 2.2 ** (level - 1);

export const STAFF = {
  coach: { name: '코치', effect: '선수 성장 속도' },
  scout: { name: '스카우트', effect: '다른 구단 선수 능력치를 보는 정확도 (3-2 이적에서 사용)' },
  medical: { name: '의료진', effect: '부상 확률과 회복 속도' },
  youthCoach: { name: '유스 코치', effect: '유스 선수 잠재력' },
};
export const STAFF_KEYS = Object.keys(STAFF);
export const MAX_STAFF = 20;
// 스태프 한 명(분야)의 주급 (유로)
export const staffWage = (level) => 400 * 1.28 ** level;

// 계약의 출전 시간 약속과 기대 출전 비율
export const PROMISES = {
  starter: { name: '주전', share: 0.7, rank: 3 },
  rotation: { name: '로테이션', share: 0.3, rank: 2 },
  backup: { name: '백업', share: 0.08, rank: 1 },
};
