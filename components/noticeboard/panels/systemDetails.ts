// components/noticeboard/panels/systemDetails.ts
// ═══════════════════════════════════════════════════════════════════
// SYSTEM 상세 페이지 데이터 (스탯/뱃지/일일활동/일지/매점)
// ═══════════════════════════════════════════════════════════════════
//
// 상세마다 구조가 다르므로 블록 타입을 여러 개 둔다.
// 인라인 볼드 강조는 **텍스트** 로 표기 → 렌더 쪽에서 <strong> 처리.
//
// 아이콘 파일(/svg):
//   note(음표)=리듬감·연습 / heart(하트)=체력 / sparkle=표현력
//   cafe(커피잔)=카페 / headset=연습실
//   badgeNote/badgeHeart/badgeStar = 뱃지 시스템 일반색 뱃지(음표/하트/별)
//     ※ 표현력 뱃지는 별(star) 심볼. 연습/스탯의 sparkle 아이콘과 구분해 별도 키.
// ═══════════════════════════════════════════════════════════════════

export type IconKey =
  | "note"
  | "heart"
  | "sparkle"
  | "cafe"
  | "headset"
  | "badgeNote"
  | "badgeHeart"
  | "badgeStar";

// 상단(설명) 영역 블록
export type DetailBlock =
  | { type: "p"; text: string } // 볼드 강조 **..** 허용
  | { type: "grade"; text: string } // 굵은 한 줄 (스탯 등급표)
  | { type: "note"; text: string } // 파란 ※ 주석
  | { type: "list"; items: string[] } // 불릿 리스트 (볼드 강조 허용)
  | { type: "callout"; lines: string[]; hand?: boolean } // 안내 박스(손그림 여부)
  | { type: "bubble"; text: string; ex?: boolean }; // 말풍선(앞에 Ex. 표기)

// 하단 아이콘 그룹 (뱃지: 아이콘+라벨 / 일일활동: 부제+아이콘들)
export type IconItem = { icon: IconKey; label: string };
export type IconGroup = {
  title?: string; // 그룹 제목 (아르바이트/연습). 없으면 단일 줄
  subtitle?: string; // 파란 부제 (스탯 상승 低 / 모빌 획득 有)
  items: IconItem[];
};

export type SystemDetail = {
  id: string;
  label: string; // 폴더 아래 큰 라벨
  navLabel: string; // 사이드/메뉴 라벨
  ready: boolean;
  blocks: DetailBlock[];
  // 하단 카드 (제목 + 설명) — 스탯
  cards?: { title: string; desc: string }[];
  // 하단 아이콘 영역 — 뱃지·일일활동
  iconGroups?: IconGroup[];
};

export const SYSTEM_DETAILS: Record<string, SystemDetail> = {
  stat: {
    id: "stat",
    label: "스탯",
    navLabel: "스탯",
    ready: true,
    blocks: [
      {
        type: "p",
        text: "총 세 가지 스탯이 존재하며, 러닝 중 아르바이트나 연습을 통해 키울 수 있습니다. \n 일정 경험치 달성 시 스탯을 추가합니다. 스탯별 수준은 다음과 같습니다. \n 스탯은 엔딩 시 캐릭터에 영향을 미칩니다.",
      },
      {
        type: "grade",
        text: "0(문외한) – 1(몸이 따라주지 않음) – 2(일반인) – 3(아마추어) – 4(눈에 띔) – 5(프로 도전 가능)",
      },
      {
        type: "note",
        text: "※ 같은 스탯 사이에서도 가진 지식이나 그 정도에 따른 이해도 차이도 큰 편입니다.",
      },
    ],
    cards: [
      {
        title: "리듬감",
        desc: "박자와 군무의 핵심. 높을수록 고난도 안무를 흐름 끊김 없이 완벽하게 소화합니다.",
      },
      {
        title: "체력",
        desc: "모든 활동의 보조이자 기초. 높을수록 쉽게 지치지 않고 행동을 수행해냅니다.",
      },
      {
        title: "표현력",
        desc: "시선을 사로잡는 표정과 무대 아우라. 높을수록 시선을 잡아끕니다.",
      },
    ],
  },

  badge: {
    id: "badge",
    label: "뱃지",
    navLabel: "뱃지",
    ready: true,
    blocks: [
      {
        type: "p",
        text: "각 스탯이 커뮤니티 최종 레벨인 5레벨에 도달할 시 획득 가능한 리워드입니다. \n퍼스나콘의 형태로, 홈페이지 활동 시 확인이 가능하며 선착순 3인에 한하여 메달 컬러를 추가로 받습니다.   \n여러개의 뱃지를 소유한 경우 마이페이지에서 변경이 가능합니다. 뱃지 이미지는 아래와 같습니다.",
      },
    ],
    iconGroups: [
      {
        items: [
          { icon: "badgeNote", label: "리듬감" },
          { icon: "badgeHeart", label: "체력" },
          { icon: "badgeStar", label: "표현력" },
        ],
      },
    ],
  },

  daily: {
    id: "daily",
    label: "일일활동",
    navLabel: "일일활동",
    ready: true,
    blocks: [
      {
        type: "callout",
        hand: true,
        lines: [
          "아르바이트나 연습 외에도 매일 초기화 되는 시스템이 있어요.",
          "",
          "• 출석",
          ": 홈페이지 출석 탭 이용 (+300 모빌)",
          "• 일지 작성",
          ": 홈페이지 일지 탭 이용 (일일 최초 +100 모빌)",
          "",
          "그 외 상세한 내용은 문서를 참고해주세요.",
        ],
      },
      {
        type: "p",
        text: "캐릭터는 하루에 3회 아르바이트나 연습 활동을 할 수 있으며, KST AM 12:00가 지나면 캐릭터의 행동 횟수가 회복됩니다. \n 커뮤 전용 홈페이지 메뉴에서 플레이 가능하며, 한 번 행동할 때마다 행동 횟수가 1회씩 차감됩니다.\n 잔여 행동 횟수는 다음날로 이월되지 않고 초기화됩니다. 아래 아이콘을 터치하여 각 활동의 가이드를 확인 할 수 있습니다.",
      },
    ],
    iconGroups: [
      {
        title: "아르바이트",
        subtitle: "스탯 상승 低 / 모빌 획득 有",
        items: [
          { icon: "cafe", label: "카페" },
          { icon: "headset", label: "연습실" },
        ],
      },
      {
        title: "연습",
        subtitle: "스탯 상승 高 / 모빌 획득 無",
        items: [{ icon: "note", label: "연습" }],
      },
    ],
  },

  log: {
    id: "log",
    label: "일지",
    navLabel: "일지",
    ready: true,
    blocks: [
      {
        type: "p",
        text: "모두가 작성할 수 있는 다이어리입니다. \n 모두가 공유하는 연습 일지 노트라는 컨셉입니다.  \n 커뮤 전용 홈페이지 위젯에 위치해 있으며 마우스 클릭 시 팝업됩니다. \n 타이핑, 드로잉, 이미지 첨부, 스티커 부착 등이 가능합니다. \n 역극에 해당 내용을 인용하는 것이 가능하나,\n일지를 작성하지 않는 멤버가 있을 수도 있기에 **적당한 어필 용도**로만 사용 부탁 드립니다.",
      },
      {
        type: "list",
        items: [
          "부적절한 콘텐츠를 게시할 경우 대상자에게 경고 1회 부여 및 해당 콘텐츠를 삭제합니다.",
          "일지는 일자별로 페이지가 나뉩니다.",
          "타이핑을 제외한 활동은 매점에서 판매하는 아이템을 통해 이용 가능합니다.",
          "어디까지나 일지 작성 및 이용은 커뮤니티 경험을 풍부하게 돕기 위함이며, 참여를 **완전한 자율**에 맡깁니다.",
        ],
      },
    ],
  },

  shop: {
    id: "shop",
    label: "상점",
    navLabel: "매점",
    ready: true,
    blocks: [
      {
        type: "p",
        text: "모브 재단에서 운영하는 제법 큰 규모의 매점으로 여러 가지 물건을 팔고 있습니다. 아르바이트,\n 이벤트를 통해 얻을 수 있는 '모빌'만을 사용해 물건을 구매할 수 있으며, 가끔 파격적인 세일 이벤트를 진행하기도 합니다.",
      },
      {
        type: "p",
        text: "매점에서 구매한 물건 또는 모빌 자체에 대한 선물이 가능합니다. \n 선물 기능은 홈페이지, 그리고 마스토돈 봇을 통해 이용하실 수 있습니다.",
      },
      { type: "bubble", ex: true, text: '@robot_mob {@대상} 너 정말 춤을 잘 추는걸? [선물] {금액} 모빌 줄게~' },
      { type: "bubble", ex: true, text: '@robot_mob {@대상} 슬롯머신에서 뽑았다. [선물]줄게. "아이템명"... 2개.' },
    ],
  },
};

export const SYSTEM_ORDER = ["stat", "badge", "daily", "log", "shop"];