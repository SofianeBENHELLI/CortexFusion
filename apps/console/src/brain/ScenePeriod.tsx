import { useEffect, useState } from "react";
import type { BrainSelection } from "./model";
export const sceneIntervalLabel = (interval: NonNullable<SceneInterval>) =>
  `${interval.from.replace("T", " ").replace("Z", "")} → ${interval.to.replace("T", " ").replace("Z", "")} UTC`;

export type SceneInterval = BrainSelection["interval"];
export function ScenePeriod({
  interval,
  onChange,
}: {
  interval: SceneInterval;
  onChange: (value: SceneInterval) => void;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    setFrom(interval?.from ?? "");
    setTo(interval?.to ?? "");
    setError("");
  }, [interval?.from, interval?.to]);
  return (
    <div className="scene-period">
      <p>
        {interval
          ? sceneIntervalLabel(interval)
          : "Toutes les publications accessibles"}
      </p>
      <div
        className="scene-period-presets"
        aria-label="Périodes de la carte et de la chronique"
      >
        {[1, 7, 30].map((days) => (
          <button
            key={days}
            onClick={() => {
              const end = Date.now();
              onChange({
                from: new Date(end - days * 86400000).toISOString(),
                to: new Date(end).toISOString(),
              });
            }}
          >
            {days === 1 ? "24 heures" : `${days} jours`}
          </button>
        ))}
        <button disabled={!interval} onClick={() => onChange(null)}>
          Tout l’historique
        </button>
      </div>
      <details>
        <summary>Choisir un intervalle exact en UTC</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const start = Date.parse(from),
              end = Date.parse(to);
            if (
              !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
                from,
              ) ||
              !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(to) ||
              !Number.isFinite(start) ||
              !Number.isFinite(end) ||
              new Date(start).toISOString() !==
                from.replace(/(?<!\.\d{3})Z$/, ".000Z") ||
              new Date(end).toISOString() !==
                to.replace(/(?<!\.\d{3})Z$/, ".000Z") ||
              start >= end
            ) {
              setError(
                "Le début doit précéder la fin. Utilisez deux dates UTC au format AAAA-MM-JJTHH:mm:ss.sssZ.",
              );
              return;
            }
            onChange({
              from: new Date(start).toISOString(),
              to: new Date(end).toISOString(),
            });
            setError("");
          }}
        >
          <label>
            Début inclus (UTC)
            <input
              aria-label="Début inclus en UTC"
              type="text"
              placeholder="2026-10-04T05:50:34.000Z"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Fin exclue (UTC)
            <input
              aria-label="Fin exclue en UTC"
              type="text"
              placeholder="2026-10-04T05:50:34.000Z"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button type="submit">Appliquer la période</button>
          {error && <p role="alert">{error}</p>}
        </form>
      </details>
    </div>
  );
}
