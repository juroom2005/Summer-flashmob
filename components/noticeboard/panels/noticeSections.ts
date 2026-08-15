// components/noticeboard/panels/noticeSections.ts
// ═══════════════════════════════════════════════════════════════════
// NOTICE 탭 섹션 데이터 (본문 NoticeDocPanel + 내비 NoticeNavRail 공유)
// ═══════════════════════════════════════════════════════════════════
//
// 본문과 폴더 바깥 내비게이터가 같은 섹션 목록을 참조해야 하므로
// 데이터·타입을 이 파일로 분리한다. 렌더 로직은 각 컴포넌트에.
// ═══════════════════════════════════════════════════════════════════

export type Bullet = {
  text: string;
  marker?: "square" | "chevron";
  blue?: boolean;
};

export type Block =
  | { type: "p"; text: string; blue?: boolean }
  | { type: "list"; items: Bullet[] }
  | { type: "dots"; items: string[] }
  | { type: "note"; text: string }
  | { type: "callout"; lines: string[] }
  | { type: "tail"; text: string };

export type TitleKind = "plain" | "yellow" | "blue";

export type Section = {
  id: string;
  navLabel: string;
} & (
  | { layout: "single"; title: string; titleKind: TitleKind; blocks: Block[] }
  | {
      layout: "two";
      left: { title: string; titleKind: TitleKind; blocks: Block[] };
      right: { title: string; titleKind: TitleKind; blocks: Block[] };
    }
);

export const NOTICE_SECTIONS: Section[] = [
  {
    id: "notice",
    navLabel: "Notice",
    layout: "single",
    title: "NOTICE",
    titleKind: "plain",
    blocks: [
      {
        type: "p",
        text: "SUMMER FLASH MOB! 커뮤니티는 약칭으로 서플커를 사용합니다.",
      },
      {
        type: "p",
        text: "본 커뮤니티는 신청서 합격제로 운영되며, MPC 포함 25명 내외의 인원을 예정하고 있습니다.\n상황에 따라 합격 인원 수가 변동될 가능성이 있습니다.",
      },
      {
        type: "p",
        text: "06년생 이상부터 신청서 접수가 가능합니다. 빠른 년생의 접수는 받지 않으며, 나이 속임·신분증 위조·도용은 적발 즉시 영구 제명됩니다. 더불어 글·그림·캐릭터 디자인의 도용 역시 제명 대상이니 유의 부탁드립니다.",
      },
      {
        type: "p",
        text: "마스토돈을 주 플랫폼으로 이용합니다. 서버는 자체 개설 서버 사용을 예정두고 있습니다.\n첫 마스토돈 커뮤니티 러닝은 가능하나, 첫 커뮤니티 러닝은 불가합니다.",
      },
      {
        type: "p",
        text: "커뮤니티 활동을 위한 홈페이지가 준비되어있습니다. 단순히 커뮤니티 경험을 풍부하게 돕고자 제공되는 홈페이지이나, 모바일만으로의 진행은 한계가 있기 때문에 어느정도의 PC접속이 필요합니다.",
      },
      {
        type: "p",
        text: "러닝 기간은 총 10일로 모든 스토리와 이벤트 안내는 21시에 예정되어 있습니다. 가급적 참여를 권장합니다. 이벤트 중에는 필수 참여를 요하는 내용은 특별히 없으나, 모든 이벤트를 불참할 수 밖에 없는 일정이시라면 신청을 재고해 주시기를 바랍니다.",
      },
      {
        type: "p",
        text: "투아웃 경고 제도를 사용합니다. 누적 경고 2회에 해당하는 캐릭터는 제명처리 됩니다. 하차와 제명은 처음부터 세계관에 없는 캐릭터로 취급하며, 해당 캐릭터에 대한 언급 및 연공을 일절 금합니다.",
      },
      {
        type: "dots",
        items: [
          "단체 경고 2회 누적 시 조기 엔딩을 맞습니다.",
          "경고 사항과 제명 사항은 하단의 공지를 확인해주세요.",
        ],
      },
    ],
  },
  {
    id: "community",
    navLabel: "Comunity",
    layout: "single",
    title: "Comunity",
    titleKind: "yellow",
    blocks: [
      {
        type: "p",
        text: "본 커뮤니티는 현대일본의 여름을 배경으로 하고 있으며, 일상힐링을 지향하고 있습니다.",
      },
      {
        type: "p",
        text: "서사를 바탕으로 하는 모든 행위를 허가하고는 있으나, 커뮤니티 분위기를 해칠 정도의 과도한 개그성 발언 및 사진 트레이싱 등 지나치게 가벼운 분위기 형성을 금합니다.",
      },
      {
        type: "p",
        text: "본 커뮤니티는 리얼타임제를 차용하여 진행하나, 날씨의 경우 임의로 커뮤니티 분위기에 맞추어 설정 예정입니다. 일자에 따른 날씨 변동은 홈페이지를 통해 확인하실 수 있습니다.",
      },
      {
        type: "p",
        text: "커뮤니티 내 별도의 통금 시간은 없습니다. 출근조, 새벽반 등의 무리 형성 플로우는 자제 부탁드립니다. 또한 기타 퍼블릭 트윗으로 올라오는 글들이 과열되지 않도록 많은 주의를 요할 예정입니다.",
      },
      {
        type: "p",
        text: "눈에 띄지 않는 DM 교류를 금하며, 모든 툿은 공개로 작성해주셔야 합니다.",
      },
      {
        type: "p",
        text: "모든 역극은 가급적 순서대로 답장하는 것을 권장드립니다. 단발성, 이벤트 대화를 우선시 하는 것을 이해하나 이를 악용하실 경우 제재가 가해질 수 있습니다.",
      },
      {
        type: "p",
        text: "합격 후 신청서 수정은 반드시 운영진을 거쳐 해주시면 감사하겠습니다. 확인되지 않은 비밀 설정 추가 혹은 변경 시 경고가 부여될 수 있습니다. (오타 및 비문 수정은 예외.)",
      },
    ],
  },
  {
    id: "warning",
    navLabel: "Warning",
    layout: "two",
    left: {
      title: "#Warning",
      titleKind: "blue",
      blocks: [
        {
          type: "list",
          items: [
            { text: "30분 이상 지속되는 탐대", marker: "square" },
            {
              text: "커뮤니티 분위기에 맞지 않는 개그 및 메타 발언의 지속",
              marker: "square",
            },
            {
              text: "러닝 중 공개/비밀란에 캐릭터 설정 추가 및 공개",
              marker: "square",
            },
            { text: "불필요한 오너 개입", marker: "square" },
            { text: "사념을 포함한 메타 발언", marker: "chevron" },
            {
              text: "로그 및 바이오 내 불필요한 오너사 기입\n(Ex.🫶, 킵, 늦었습니다… 등)",
              marker: "chevron",
            },
            { text: "모든 종류의 지인플 및 편파", marker: "square" },
            { text: "공개된 장소에서의 커뮤니티 유출", marker: "square" },
            {
              text: "공개 계정에서의 러닝 타래, 디스코드 실시간 공유 등의 행위",
              marker: "chevron",
            },
            {
              text: "타인의 역극 내용 및 로그를 외부로 유출하는 행위 일체",
              marker: "chevron",
            },
            {
              text: "운영 계정을 포함하지 않은 모든 종류의 DM",
              marker: "square",
            },
            { text: "하차 및 제명자 언급", marker: "square" },
            {
              text: "다른 러너로부터 지속적인 건의가 들어오는 경우",
              marker: "square",
            },
          ],
        },
        {
          type: "tail",
          text: "상기 내용 외,\n운영진 판단 하에 경고가 필요하다 생각되는 경우",
        },
      ],
    },
    right: {
      title: "#Expulsion",
      titleKind: "yellow",
      blocks: [
        {
          type: "list",
          items: [
            { text: "경고 N회 누적", marker: "square" },
            { text: "명의 도용, 타인의 작업물 도용", marker: "square" },
            { text: "하차 의사를 밝힌 자", marker: "square" },
            { text: "무통보 하차", marker: "chevron" },
            {
              text: "사전 합의 없는 48시간 이상 무통보 미접속자",
              marker: "chevron",
            },
            { text: "러닝 중 외부에서 썰풀이 행위 일체", marker: "square" },
            {
              text: "러닝 중 하차 및 제명자와의 교류 행위 일체",
              marker: "square",
            },
            { text: "타 커뮤니티 동시 러닝 (1캐 N커)", marker: "square" },
            { text: "러닝 중 고백로그", marker: "square" },
            { text: "타 러너에 대한 비방 행위 일체", marker: "square" },
          ],
        },
        {
          type: "tail",
          text: "시스템 악용, 불필요한 분쟁 조장 등\n커뮤니티 운영에 차질을 빚게 하는 모든 행위",
        },
      ],
    },
  },
  {
    id: "after",
    navLabel: "After",
    layout: "single",
    title: "After",
    titleKind: "yellow",
    blocks: [
      {
        type: "p",
        text: "커뮤니티 운영 종료 후 연락처 공유를 위한 최소 툿 개수(200개)가 있습니다.\n엔딩일을 기점으로 일정 툿을 넘기지 못할 경우 연공이 불가합니다.",
      },
      {
        type: "p",
        text: "엔딩 이후로는 나흘의 엠바고와 함께 다음의 주의사항을 갖습니다.",
      },
      {
        type: "dots",
        items: [
          "고백로그, 성사 금지",
          "주식 발언이나 로맨스 지향 플로우의 형성을 지양",
          "TRPG, 커뮤니티 인원을 대상으로한 음성·화면공유 (Jitsi, 디스코드 등), 온라인 게임 등",
        ],
      },
      {
        type: "p",
        text: "엔딩 후, 운영 측이 없는 공간에서 발생하는 모든 사건 및 사고는 일절 관여·중재하지 않습니다.",
      },
      {
        type: "callout",
        lines: [
          "공지사항을 숙지하지 않아 일어나는 모든 문제는 운영진 측에서 책임지지 않습니다.",
          "본 커뮤니티는 운영진의 취미로 운영되는 커뮤니티이며, 모든 일정이 유동적으로 변동될 수 있습니다.",
        ],
      },
    ],
  },
];

// 본문 섹션 엘리먼트에 부여할 DOM id (내비 ↔ 본문 연결 키)
export function sectionDomId(id: string): string {
  return `notice-sec-${id}`;
}