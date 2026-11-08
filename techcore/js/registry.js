// Static registry. Every status defaults to "unverified". Update only with verified evidence.
const TC_STATUS = {
  unverified: { label: "미확인", cls: "" },
  reported: { label: "사용자 보고(미확인)", cls: "warn" },
  pass: { label: "확인됨", cls: "ok" },
  fail: { label: "실패", cls: "err" },
};

const TC_FIELDS = [
  { id: "plc-hmi", no: 1, name: "PLC·HMI·자동화", intro: "PLC 래더·코드 작성, HMI 설계, PLC-HMI 일관성 검사, 자동화 설비·로봇·제조 업무를 다룹니다.", reported: true, tool: "panellab" },
  { id: "electric", no: 2, name: "전기·전자", intro: "회로, 배선, 전원, 전자 부품, 에너지 설비의 전기 관련 업무를 다룹니다.", reported: true },
  { id: "mechanical", no: 3, name: "기계·설비", intro: "기계 설계, 설비 구조, 부품 선정, 건축·화학 공정·모빌리티·디자인 관련 업무를 다룹니다." },
  { id: "software", no: 4, name: "소프트웨어·IT", intro: "소프트웨어 개발, 시스템·네트워크, 여러 분야 공통 기술 지원 업무를 다룹니다." },
];

// Former field ids stay reachable (bookmarks). They open the group below with a notice. Grouping is a proposal; agent roles are unverified.
const TC_FIELD_ALIAS = {
  robotics: { to: "plc-hmi", name: "로봇 · 자동화" },
  industry: { to: "plc-hmi", name: "산업 · 제조" },
  energy: { to: "electric", name: "에너지 · 환경" },
  civil: { to: "mechanical", name: "건축 · 토목" },
  chemical: { to: "mechanical", name: "화학 · 공정 · 소재" },
  mobility: { to: "mechanical", name: "모빌리티" },
  design: { to: "mechanical", name: "디자인 · 설계" },
  common: { to: "software", name: "공통 기술 지원" },
};

// Home task cards. "ready" means PanelLab has a menu of that name; it does not mean results are verified.
const TC_TASKS = [
  { id: "ladder", t: "래더 만들기", d: "PLC 동작 순서를 그림으로 구성해요.", menu: "래더 작화", ready: true },
  { id: "drawing", t: "전기 도면 살펴보기", d: "전기 도면과 설비 구성을 분석해요.", menu: "도면 분석", ready: true },
  { id: "error", t: "PLC 오류 찾아보기", d: "잘못된 부분을 찾기만 해요. 고치지는 않아요.", menu: "오류 검사", ready: true, warn: true },
  { id: "hmi", t: "HMI 화면 만들기", d: "터치 패널 화면을 설계해요.", menu: "HMI 작업실", ready: true },
  { id: "review", t: "PLC 프로그램 검토하기", d: "프로그램 전체를 살펴봐요.", menu: "", ready: false },
];

const TC_PLANNED_AGENTS = 104;

// Six independent states per agent. Each carries its own source, check date and evidence reference.
const TC_STATE_FIELDS = [
  { key: "provisioned", label: "생성" },
  { key: "linked", label: "AGENT 01 연결" },
  { key: "callTest", label: "호출 테스트" },
  { key: "roleCheck", label: "역할 확인" },
  { key: "workTest", label: "업무 테스트" },
  { key: "verification", label: "결과 검증" },
];
const TC_SOURCES = { user_report: "사용자 보고", test_log: "테스트 로그", manual_review: "수동 검토" };
const tcNewState = () => ({ status: "unverified", source: null, checkedAt: null, evidenceRef: null });
const tcAgent = (no, name, role, field, states) => ({
  no, name, role, field,
  states: Object.assign(Object.fromEntries(TC_STATE_FIELDS.map((f) => [f.key, tcNewState()])), states || {}),
});
// "pass" is shown only with a test_log/manual_review source and an evidence reference; otherwise it falls back to reported/unverified.
function tcEffectiveStatus(s) {
  if (!s) return "unverified";
  if (s.status === "fail") return "fail";
  if (s.status === "pass" && (s.source === "test_log" || s.source === "manual_review") && s.evidenceRef) return "pass";
  return s.status === "reported" || s.status === "pass" || s.source === "user_report" ? "reported" : "unverified";
}

// Only entries with verified evidence may be set to "pass".
const TC_AGENTS = [
  tcAgent("AGENT 01", "통합 운영 에이전트", "요청 분석, 전문 에이전트 호출, 결과 취합·검토", "공통"),
];

const TC_VALIDATION_STAGES = ["AI 논리 검토", "정적 검사", "전문 프로그램 검사", "시뮬레이션", "실제 환경 검증"];

// PLC/HMI guide items. "ready" is true only where PanelLab has a matching menu (panellab/index.html nav).
const TC_PLC_STEPS = [
  { t: "래더 설계", d: "래더 작화 메뉴에서 시각적으로 그립니다.", ready: true },
  { t: "도면 분석", d: "도면 분석 메뉴에서 전기 도면을 살펴봅니다.", ready: true },
  { t: "오류 검사", d: "프로그램의 문제 후보를 찾습니다. 검사만 하고 고치지 않습니다.", ready: true },
  { t: "수정 제안", d: "수정 후보를 보여 줍니다. 승인 전에는 원본에 적용하지 않습니다.", ready: true },
  { t: "프로그램 검증", d: "수행한 검증 단계만 표시합니다. 실제 설비 검증은 별도로 해야 합니다.", ready: false },
  { t: "PLC 보고서", d: "준비 중입니다. PanelLab 지원 여부가 확인되지 않았습니다.", ready: false },
];
const TC_HMI_STEPS = [
  { t: "화면 자동 설계", d: "HMI 작업실에서 AI가 화면 초안을 만듭니다.", ready: true },
  { t: "직접 편집과 객체 배치", d: "화면 요소를 끌어서 배치하고 고칩니다.", ready: true },
  { t: "PLC 라벨 연결", d: "글로벌 라벨과 화면 요소를 연결합니다.", ready: true },
  { t: "화면 검사와 개선 제안", d: "PLC와의 일관성을 검사합니다.", ready: true },
];

const TC_FILE_TYPES = [
  { type: "PDF", status: "unverified", note: "브라우저 미리보기 가능성 검토 예정" },
  { type: "이미지", status: "unverified", note: "브라우저 미리보기 가능성 검토 예정" },
  { type: "Excel · CSV", status: "unverified", note: "CSV는 브라우저 처리 가능성 검토, Excel은 미확인" },
  { type: "JSON · 구조화 데이터", status: "unverified", note: "브라우저 처리 가능성 검토 예정" },
  { type: "CAD · 3D 모델", status: "unverified", note: "서버 측 변환 필요 가능성" },
  { type: "회로 · PCB", status: "unverified", note: "서버 측 변환 필요 가능성" },
  { type: "PLC · HMI 자료", status: "unverified", note: "PanelLab 프로젝트 JSON은 PanelLab에서 처리" },
  { type: "Word · 기술 보고서", status: "unverified", note: "서버 측 변환 필요 가능성" },
];

const TC_GLOSSARY = {
  PLC: "공장 설비를 제어하는 산업용 컴퓨터(프로그래머블 로직 컨트롤러)입니다.",
  HMI: "사람이 설비 상태를 보고 조작하는 화면(휴먼 머신 인터페이스)입니다.",
  래더: "PLC 프로그램을 전기 회로 그림처럼 그려 표현하는 방식입니다.",
  MCP: "AI가 외부 도구를 사용할 수 있게 해 주는 연결 규격입니다.",
  "AGENT 01": "요청을 분석해 필요한 전문 에이전트를 호출하고 결과를 취합하는 중앙 에이전트입니다.",
};

const TC_HELP_QA = [
  { q: "래더 만들기", a: "PanelLab에서 PLC 코드 작성과 래더 작화를 할 수 있습니다.", route: "#/tools/panellab" },
  { q: "HMI 화면 만들기", a: "PanelLab의 HMI 작업실을 사용하세요.", route: "#/tools/panellab" },
  { q: "에이전트 상태 확인", a: "에이전트 관리(전문가 모드)에서 6가지 상태를 따로 확인합니다.", route: "#/agents" },
  { q: "AI에게 요청하기", a: "새 작업의 통합 AI 작업실에서 AI 에이전트에게 요청합니다.", route: "#/workroom" },
  { q: "검증 상태 확인", a: "작업 이력 및 검증에서 단계별 검증 여부를 확인합니다.", route: "#/history" },
  { q: "프로젝트 관리", a: "프로젝트 관리에서 프로젝트별 자료를 확인합니다.", route: "#/projects" },
];
