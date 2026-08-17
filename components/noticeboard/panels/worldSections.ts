// components/noticeboard/panels/worldSections.ts
// ═══════════════════════════════════════════════════════════════════
// WORLD 탭 섹션 데이터 (WorldDocPanel + WorldNavRail 공유)
// ═══════════════════════════════════════════════════════════════════
//
// world 탭은 WORLD / Who Is Mob? / 如月學院 / MAP 로 구성.
// MAP 은 별도 큰 작업이라 이번엔 placeholder 섹션만 둔다(내비에는 표시).
//
// 블록 타입은 notice 보다 많다(말풍선·형광문구·해시태그·들여쓰기 항목).
// ═══════════════════════════════════════════════════════════════════

export type WBlock =
  // 일반 문단
  | { type: "p"; text: string }
  // 노란 형광 소제목 (인라인, "Who Is Mob?" 등)
  | { type: "subhi"; text: string }
  // 불릿 리스트 (• 검정)
  | { type: "dots"; items: string[] }
  // 카톡풍 말풍선. side=left(회색) / accent(파랑). strongParts: 굵게 강조할 조각
  | { type: "bubble"; side: "gray" | "blue"; text: string }
  // 짧은 단독 줄(띠롱- 등)
  | { type: "line"; text: string }
  // 하단 노란 형광 손글씨풍 문구 (우측정렬, 여러 줄)
  | { type: "marker"; lines: string[] }
  // 해시태그 줄
  | { type: "tags"; tags: string[] }
  // 학년/라벨 + 설명 항목 (라벨 볼드 + 이어지는 본문)
  | { type: "labeled"; label: string; text: string };

export type WTitleKind = "plain" | "yellow";
// title: 큰 헤딩. kanji=true 면 한자 제목(如月學院) — 폰트만 본문볼드 계열로.
export type WorldSection = {
  id: string;
  navLabel: string;
  title: string;
  titleKind: WTitleKind;
  kanji?: boolean;
  placeholder?: boolean; // MAP 처럼 아직 미구현
  blocks: WBlock[];
};

export const WORLD_SECTIONS: WorldSection[] = [
  {
    id: "world",
    navLabel: "World",
    title: "WORLD",
    titleKind: "plain",
    blocks: [
      {
        type: "p",
        text: "이 모든 일의 시작을 알기 위해서는, 무엇보다 ‘키사라기 모브(如月 モブ)’라는 인물을 알아야 한다.",
      },
      { type: "subhi", text: "Who Is Mob?" },
      {
        type: "dots",
        items: [
          "둘째 가라면 서러운 재벌가 도련님.",
          "도쿄에 소유한 건물만 수십 채.",
          "도심 한복판 최고급 초고층 멘션 펜트하우스 거주.",
          "…그리고, 우리의 학생회장!",
        ],
      },
      {
        type: "p",
        text: "그를 둘러싼 수식어도, 소문도 한참 많지만… 보통은 '발 넓고 속 넓은 도련님' 정도로 통한다. 너른 시야를 바탕으로 저지르는 특유의 기행에는 이미 우리 모두가 익숙해져 있는 상태. 즉흥적이긴 해도 결코 변덕스럽지는 않은, 언제나 매사에 진심을 다하는 부르주아. 아쉬운 소리 하나 없이 모든 일에 최선을 다하는 그 도련님이 또 하고 싶은 것이 생기셨다는 것이… 이 거대한 판의 시작이다.",
      },
      {
        type: "p",
        text: "방학 직전부터 의사를 묻겠노라며 구두로 떠들고 다니던 그 선택의 시간이 기어이 오고 만 것이다. 모브 본인도 발로 뛰고, 친구의 친구를 수소문하고, 또 여럿을 설득하러 돌아다니고 있던 그 웃기지도 않는 버킷리스트의 때가! 그 많은 내용 중 첫 번이 하필 플래시 몹일 건 또 뭐람? 도대체 그놈의 춤이 뭐라고 이렇게까지 하는지 모르겠으나 연습실도, 참가비도, 게다가 아르바이트 자리마저 챙겨준다고 하니 각기 다른 이유들로 이 웃기지도 않는 도련님의 계획에 동참하게 됐다. 그도 그럴게… 춤만 조금 연습하면 손해 볼 게 없으니까!",
      },
      {
        type: "p",
        text: "하지만 그렇게 요란 떨기 무색하게 이번 방학이 다 가도록 연락이 없던 모브군. 그답지 않게 흐지부지 끝나나 싶던 계획은 방학이 끝나기 단 열흘 전, 모두에게 전송되는 문자들로 다시금 고개를 핀다.",
      },
      { type: "line", text: "띠롱-" },
      { type: "line", text: "띠롱. 띠롱—…!" },
      { type: "p", text: "연달아 화면을 채우며 폭주하는 알림음." },
      { type: "bubble", side: "gray", text: "미안! 너무 늦었지?" },
      { type: "bubble", side: "gray", text: "마음의 준비는 단단히 했을 거라 믿어." },
      { type: "bubble", side: "gray", text: "8월 21일 스페이스 모브 로 모여줘." },
      { type: "bubble", side: "gray", text: "시간은 밤 9시!" },
      {
        type: "bubble",
        side: "blue",
        text: "이름하여 '모브のフラッシュモブ 모브의 플래시몹'의 개시다!",
      },
      {
        type: "marker",
        lines: [
          "여름 방학의 끝자락.",
          "도쿄 도심에 뜨거운 청춘의 파도가 물결친다!",
        ],
      },
    ],
  },
  {
    id: "map",
    navLabel: "MAP",
    title: "MAP",
    titleKind: "yellow",
    blocks: [],
  },
  {
    id: "mob",
    navLabel: "Who Is Mob?",
    title: "Who Is Mob?",
    titleKind: "plain",
    blocks: [
      { type: "dots", items: ["키사라기 모브"] },
      {
        type: "tags",
        tags: [
          "#MAIN_NPC",
          "#재벌3세_후계자",
          "#최선을_다하는_부르주아",
          "#청춘낭만_중독자",
        ],
      },
      {
        type: "p",
        text: "일본 굴지의 키사라기 재벌, 그 3대 독자로 키사라기 가문의 단 하나뿐인 후계자입니다. 키사라기는 금융/유통 계열사로 가장 유명하며 이 외에도 재개발이나 부동산, 엔터테인먼트, 미디어 등 다방면으로 뻗어나 사업을 이어오고 있습니다. 3대 독자인 모브는 금지옥엽으로 자랐음이 유명하며, 그의 웬만한 기행들에도 보통은 가문이 지원하고 있습니다. 2학년 오르는 시점부터 그는 학생회장 직위를 맡아왔으며, 우리가 다니는 키사라기 학원 역시 그의 집안 소유입니다.",
      },
      { type: "p", text: "참고할만한 그의 기행은 다음과 같습니다." },
      {
        type: "labeled",
        label: "1학년",
        text: "문화제 반 부스(노점)를 위해 유명한 장인을 초빙. 메뉴 하나에 100엔으로 판매하며 차액은 전부 본인이 보충함.",
      },
      {
        type: "labeled",
        label: "2학년",
        text: "신입생 입학식에 벚꽃이 좀 부족한 것 같다며 자기 사비로 헬기와 드론 부대를 동원해 특수 처리된 생화 벚꽃잎 수십톤을 날림.",
      },
      {
        type: "labeled",
        label: "3학년",
        text: "강당과 교실 전역에 소파와 텐트, 침구류를 깔아가며 교내 야간 숙박 이벤트를 개최함.",
      },
      {
        type: "line",
        text: "버킷리스트-플래시몹을 실행하기 위해 상점가를 빌림! 〉NEW!",
      },
    ],
  },
  {
    id: "academy",
    navLabel: "如月學院",
    title: "如月學院",
    titleKind: "plain",
    kanji: true,
    blocks: [
      {
        type: "tags",
        tags: ["#명문_사립_학원", "#파격적인_지원과_자율성", "#학생회_중심_활동"],
      },
      {
        type: "p",
        text: "시부야구에 위치한 사립 학원. 도쿄 내에서도 손에 꼽는 교육 인프라를 자랑하며, 학생들에 대한 지원이 활발하여 갖가지 분야의 특기생을 매 분기 모집하고 있는 명문 학교입니다. 모기업이 되는 키사라기 그룹의 재정 지원을 바탕으로 구축된 최신식 설비들과 함께 학생들의 자발적인 열정과 창의성을 위해 노력하고 있습니다. 입시와 스펙 쌓기에만 매몰되지 않고, 음악, 예술, 기획 등 자신만의 청춘을 자유롭게 펼쳐 나갈 수 있게 돕고 있으며, 학비가 비싼 편이긴 하나, 열정과 능력, 그리고 낭만을 최우선으로 평가하며 온갖 이름으로 장학금을 안겨주기로 유명합니다. 초등부부터 중등부, 고등부까지 대부분 에스컬레이터 형식으로 진학합니다.",
      },
      {
        type: "p",
        text: "방과후 부 활동은 최대 2개 중복 활동이 가능하며, 부 개설은 부장 포함 3인의 학생만 있으면 됩니다. 유령 동아리가 적지 않으나 이를 방치하는 것까지도 하나의 낭만이라고 보는 편입니다. 학생회의 예산안 회의만 넘기면 그 무엇을 구매하고, 계획하는지도 크게 터치하지 않습니다.",
      },
      {
        type: "p",
        text: "상경한 학생들, 가정 문제, 운동부 합숙 등 여러 이유로 기숙사를 운영하고는 있으나 입사가 강제되고 있진 않으며, 이용하는 학생은 극히 일부입니다.",
      },
    ],
  },
];

export function worldSectionDomId(id: string): string {
  return `world-sec-${id}`;
}