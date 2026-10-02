import { Icon, type IconName } from "@/components/Icon";
import { ThemeToggle } from "@/components/home/Home";

export type StateName = "perm" | "denied" | "fail" | "quota" | "offline";
export type StateAction = "allow" | "later" | "home" | "retry" | "recheck";

type Def = {
  icon: IconName;
  tone: "info" | "warn" | "danger" | "neutral";
  anim: string;
  title: string;
  body: string;
  list?: [IconName, string][];
  steps?: string[];
  primary: [string, StateAction];
  secondary?: [string, StateAction];
};

const STATE: Record<StateName, Def> = {
  perm: {
    icon: "pin",
    tone: "info",
    anim: "radar",
    title: "가까운 길을 찾으려면\n위치가 필요해요",
    body: "지금 서 있는 곳에서 출발해 다시 돌아오는 코스를 만들어요.",
    list: [
      ["pin", "현재 위치를 출발점으로 써요"],
      ["loop", "출발점으로 돌아오는 코스만 추천해요"],
    ],
    primary: ["위치 사용 허용하기", "allow"],
    secondary: ["다음에 할게요", "later"],
  },
  denied: {
    icon: "pinoff",
    tone: "warn",
    anim: "wobble",
    title: "위치 권한이 꺼져 있어요",
    body: "코스를 만들려면 위치 권한을 켜야 해요.",
    steps: ["주소창 왼쪽의 설정 아이콘을 눌러요", "‘위치’를 ‘허용’으로 바꿔요", "이 화면으로 돌아와 다시 시도해요"],
    primary: ["다시 시도하기", "allow"],
    secondary: ["홈으로", "home"],
  },
  fail: {
    icon: "warn",
    tone: "danger",
    anim: "shake",
    title: "코스를 만들지 못했어요",
    body: "잠시 뒤에 다시 시도해 주세요. 계속되면 목표 거리를 바꿔 보세요.",
    primary: ["다시 만들기", "retry"],
    secondary: ["목표 바꾸기", "home"],
  },
  quota: {
    icon: "moon",
    tone: "neutral",
    anim: "bob",
    title: "오늘 추천 한도를\n모두 사용했어요",
    body: "내일 다시 이용해 주세요.",
    primary: ["확인", "home"],
  },
  offline: {
    icon: "wifi",
    tone: "danger",
    anim: "blink",
    title: "인터넷에 연결되어 있지 않아요",
    body: "연결 상태를 확인한 뒤 다시 시도해 주세요.",
    primary: ["다시 연결 확인", "recheck"],
    secondary: ["목표 바꾸기", "home"],
  },
};

export function StateScreen({ name, onAction }: { name: StateName; onAction: (a: StateAction) => void }) {
  const d = STATE[name];
  return (
    <section className="screen state">
      <header className="topbar">
        <div className="logo">
          <img src="/logo.png" alt="" width={26} height={26} />
          루프런
        </div>
        <ThemeToggle />
      </header>
      <div className="state-body">
        <div className="state-ic" data-tone={d.tone} data-anim={d.anim}>
          <Icon name={d.icon} />
        </div>
        <h1>{d.title}</h1>
        <p>{d.body}</p>
        {d.list && (
          <ul className="state-list">
            {d.list.map(([icon, text]) => (
              <li key={text}>
                <Icon name={icon} />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        )}
        {d.steps && (
          <ol className="state-list">
            {d.steps.map((text, i) => (
              <li key={text}>
                <i>{i + 1}</i>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="cta-bar">
        <button type="button" className="cta" onClick={() => onAction(d.primary[1])}>
          {d.primary[0]}
        </button>
        {d.secondary && (
          <button type="button" className="text-btn" onClick={() => onAction(d.secondary![1])}>
            {d.secondary[0]}
          </button>
        )}
      </div>
    </section>
  );
}
