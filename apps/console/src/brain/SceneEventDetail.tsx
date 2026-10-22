import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, CortexApi } from "../api/client";
import { SourceEvidence } from "../api/SourceEvidence";
import { changeLabels, type BrainChange } from "./model";
import { validateNodePage, type MapBounds } from "./scene";
import type { Layout } from "./spatial-model";

export function SceneEventDetail({
  api,
  domain,
  event,
  stamp,
  layout,
  onFocus,
  onOpen,
  onFatal,
  onClose,
}: {
  api: CortexApi;
  domain: string;
  event: BrainChange;
  stamp: { at_version: number; visibility: string };
  layout: Layout;
  onFocus: (
    bounds: MapBounds,
    pair: { from: string; to: string; kind?: string } | null,
  ) => void;
  onOpen: (id: string) => void;
  onFatal: (error: Error) => void;
  onClose: () => void;
}) {
  const region = useRef<HTMLElement>(null);
  const callbacks = useRef({ onFatal, onFocus });
  callbacks.current = { onFatal, onFocus };
  const from = event.relation?.from ?? event.nodeIds[0];
  const to = event.relation?.to;
  const current = useQuery({
    queryKey: ["api", "scene-event", domain, event.id, stamp, layout],
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const read = async (focus: string, target?: string) => {
        try {
          const result = validateNodePage(
            await api.call("graph.map_nodes", { domain }, undefined, {
              signal,
              maxResponseBytes: 65536,
              query: { layout, ...stamp, focus, ...(target ? { target } : {}) },
            }),
            domain,
          );
          if (
            result.at_version !== stamp.at_version ||
            result.visibility !== stamp.visibility
          )
            throw new ApiError(409, "projection_changed");
          if (result.selected?.id !== focus)
            throw new ApiError(200, "invalid_response");
          return result;
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }
      };
      // Two bounded metadata reads. Never scan every page of a dense neighborhood.
      const [origin, target] = await Promise.all([
        read(from, to),
        to ? read(to, from) : null,
      ]);
      const relation = to
        ? (origin?.items.find(
            ({ link }) =>
              link?.from === from &&
              link.to === to &&
              link.kind === event.relation?.kind,
          )?.link ?? null)
        : null;
      return { origin, target, relation };
    },
  });
  useEffect(() => {
    region.current?.focus();
  }, [event.id]);
  useEffect(() => {
    if (
      current.error &&
      [401, 403, 409].includes((current.error as ApiError).status)
    )
      callbacks.current.onFatal(current.error);
  }, [current.error]);
  useEffect(() => {
    if (current.data?.origin?.focus_bounds)
      callbacks.current.onFocus(
        current.data.origin.focus_bounds,
        to ? { from, to, kind: event.relation?.kind } : null,
      );
  }, [current.data, from, to]);
  const ready = !current.isFetching && !current.error && current.data;
  const origin = ready && ready.origin?.selected;
  const target = ready && ready.target?.selected;
  const currentTargetName =
    event.relation?.toTitle === to && target ? target.title : null;
  const displayTitle =
    currentTargetName && to && event.title.endsWith(to)
      ? event.title.slice(0, -to.length) + currentTargetName
      : event.title;
  return (
    <section
      ref={region}
      tabIndex={-1}
      className="scene-event-detail"
      aria-label="Détail de l’événement"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="spatial-detail-actions">
        <span className="spatial-eyebrow">{changeLabels[event.kind]}</span>
        <button onClick={onClose}>Fermer l’événement</button>
      </div>
      <h3>{displayTitle}</h3>
      {currentTargetName && (
        <p className="spatial-help">
          Le nom de la cible vient de son état actuel ; son nom historique n’est
          pas documenté dans les publications chargées.
        </p>
      )}
      <p>
        Publication v{event.version} ·{" "}
        <time dateTime={event.time}>
          {new Date(event.time).toLocaleString("fr-FR")}
        </time>
      </p>
      <p>{event.detail}</p>
      {event.relation && (
        <p>
          Relation {event.relation.kind} · poids{" "}
          {event.relation.weight ?? "non renseigné"}
          {event.relation.kind === "structural"
            ? ` · primaire ${event.relation.primary ? "oui" : "non"}`
            : ""}
          .
          {event.kind === "relation_removed"
            ? " État juste avant le retrait."
            : " État à cette publication."}
        </p>
      )}
      <div className="scene-event-current">
        <h4>Sur la carte actuelle · v{stamp.at_version}</h4>
        {current.isFetching ? (
          <p role="status">Recherche des extrémités actuelles…</p>
        ) : current.error ? (
          <p role="alert">{current.error.message}</p>
        ) : (
          <>
            {!origin ? (
              <p>
                Le concept ou une extrémité n’est plus disponible dans le savoir
                accessible. L’événement historique ne le réintroduit pas dans la
                carte.
              </p>
            ) : (
              <>
                <button onClick={() => onOpen(origin.id)}>
                  Ouvrir {origin.title} ↗
                </button>
                {target && (
                  <button onClick={() => onOpen(target.id)}>
                    Ouvrir {target.title} ↗
                  </button>
                )}
                {to && (
                  <p>
                    {ready && ready.relation
                      ? `Relation actuelle ${ready.relation.kind} · poids ${ready.relation.weight ?? "non renseigné"}.`
                      : "Aucune relation actuelle de même type et de même sens entre ces concepts. Aucun ancien lien n’est dessiné."}
                  </p>
                )}
                <button
                  onClick={() =>
                    onFocus(
                      ready!.origin!.focus_bounds!,
                      to ? { from, to, kind: event.relation?.kind } : null,
                    )
                  }
                >
                  {to ? "Cadrer les deux concepts" : "Cadrer le concept"}
                </button>
              </>
            )}
          </>
        )}
      </div>
      <details className="spatial-proofs">
        <summary>
          {event.evidence?.length ?? 0} extrait(s) source de cette différence
        </summary>
        <p>
          Sources du concept avant et après cette publication. Ces extraits
          documentent le contexte ; ils ne constituent pas une validation
          automatique du lien.
        </p>
        {event.evidence?.map((ref) => (
          <SourceEvidence
            key={`${ref.source_id}:${ref.start}:${ref.end}`}
            api={api}
            domain={domain}
            source={ref}
            onReadError={(error) => {
              if ([401, 403, 404, 409].includes((error as ApiError).status))
                onFatal(error);
            }}
          />
        ))}
      </details>
    </section>
  );
}
