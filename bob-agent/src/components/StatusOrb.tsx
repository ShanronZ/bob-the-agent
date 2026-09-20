import type { BobState } from "../types";

const LABELS: Record<BobState, string> = {
  idle: "Off",
  listening: "Listening",
  evaluating: "Thinking",
  speaking: "Speaking",
};

export function StatusOrb({ state }: { state: BobState }) {
  return (
    <div className={`status-orb status-orb--${state}`}>
      <span className="status-orb__dot" />
      <span className="status-orb__label">{LABELS[state]}</span>
    </div>
  );
}
