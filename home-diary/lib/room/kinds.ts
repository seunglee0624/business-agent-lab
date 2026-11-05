// 가구 종류별 고정 정보. 가격은 DB catalog 표에 있다.
// shortcut: 아이콘은 이모지 자리표시. M6에서 CC0 에셋으로 바꾼다.
export const KINDS = {
  closet: { name: "옷장", icon: "🚪", height: 52 },
  table: { name: "식탁", icon: "🍽️", height: 22 },
  desk: { name: "책상", icon: "💻", height: 26 },
  tv: { name: "TV", icon: "📺", height: 30 },
  plant: { name: "화분", icon: "🪴", height: 34 },
  bed: { name: "침대", icon: "🛏️", height: 20 },
  bookcase: { name: "책장", icon: "📚", height: 56 },
  piano: { name: "피아노", icon: "🎹", height: 36 },
} as const;

export type Kind = keyof typeof KINDS;

export const STYLE_COLORS = { wood: "#c9a977", modern: "#9fb3c8", vintage: "#b98b82" } as const;

export type Style = keyof typeof STYLE_COLORS;
