import type { ReactNode } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";

/** A phase reported by the operation, never a timed simulation of reasoning. */
export function ActivityStatus({
  children,
  state = "working",
  waitingForUser = false,
  size = 20,
}: {
  children: ReactNode;
  state?: OrbState;
  waitingForUser?: boolean;
  size?: 20 | 64;
}) {
  return (
    <div className="activity-status" role="status" aria-live="polite">
      {typeof CanvasRenderingContext2D !== "undefined" ? (
        <ThinkingOrb
          state={waitingForUser ? "breathing" : state}
          size={size}
          theme="auto"
          paused={waitingForUser}
          gravity={false}
          aria-hidden="true"
        />
      ) : (
        <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
            <circle
              key={n}
              cx={10 + Math.cos((n * Math.PI) / 4) * 7}
              cy={10 + Math.sin((n * Math.PI) / 4) * 7}
              r="1.1"
              fill="currentColor"
            />
          ))}
        </svg>
      )}
      <span>{children}</span>
    </div>
  );
}
