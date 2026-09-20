import { ChartIcon, DocumentIcon, KanbanIcon, MessageIcon } from "./Icons";

export type ViewName = "conversation" | "dashboard" | "workshop" | "notes";

const TABS: { id: ViewName; label: string; icon: React.ReactNode }[] = [
  { id: "conversation", label: "Conversation", icon: <MessageIcon /> },
  { id: "dashboard", label: "Dashboard", icon: <ChartIcon /> },
  { id: "workshop", label: "Workshop", icon: <KanbanIcon /> },
  { id: "notes", label: "Notes", icon: <DocumentIcon /> },
];

export function ViewTabs({ view, onChange }: { view: ViewName; onChange: (view: ViewName) => void }) {
  const activeIndex = Math.max(0, TABS.findIndex((tab) => tab.id === view));
  return (
    <div className="view-tabs" role="tablist">
      <div
        className="view-tabs__indicator"
        style={{ width: `calc((100% - 8px) / ${TABS.length})`, transform: `translateX(${activeIndex * 100}%)` }}
      />
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={view === tab.id}
          className={view === tab.id ? "is-active" : ""}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
