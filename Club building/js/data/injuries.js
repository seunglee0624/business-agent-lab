// 부상 종류: 이름, 회복 기간(일), 상대 빈도. 1개월 이상 장기 부상이 약 20%가 되도록 맞춘다.

export const MATCH_INJURIES = [
  { name: '타박상', min: 3, max: 7, weight: 26 },
  { name: '발목 염좌', min: 7, max: 21, weight: 18 },
  { name: '햄스트링 부상', min: 14, max: 35, weight: 18 },
  { name: '종아리 부상', min: 10, max: 28, weight: 10 },
  { name: '사타구니 부상', min: 10, max: 25, weight: 8 },
  { name: '무릎 인대 부상', min: 30, max: 60, weight: 8 },
  { name: '갈비뼈 골절', min: 28, max: 45, weight: 4 },
  { name: '발 골절', min: 45, max: 90, weight: 4 },
  { name: '십자인대 파열', min: 180, max: 270, weight: 2 },
  { name: '아킬레스건 파열', min: 150, max: 240, weight: 2 },
];

export const TRAINING_INJURIES = [
  { name: '근육 피로', min: 2, max: 5, weight: 40 },
  { name: '타박상', min: 3, max: 7, weight: 25 },
  { name: '발목 염좌', min: 7, max: 18, weight: 20 },
  { name: '햄스트링 부상', min: 14, max: 30, weight: 12 },
  { name: '무릎 인대 부상', min: 30, max: 50, weight: 3 },
];

// 선수 1명이 하루 훈련 중 다칠 확률
export const TRAINING_INJURY_RATE = 0.0006;
