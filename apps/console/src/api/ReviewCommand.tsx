import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { ActivityStatus } from "../ActivityStatus";
import { ApiError, type CortexApi } from "./client";
import { validateIdentity } from "./identity";
import type { DomainVersion } from "../../../../packages/contracts/src/DomainVersion";
import {
  availableDecisions,
  decisionCommand,
  decisionLabels,
  decisionEffect,
  type DecisionAction,
  type DecisionIntent,
} from "./decisionCommands";
import type { ProposalView } from "../../../../packages/contracts/src/ProposalView";
import type { ReviewInput } from "../../../../packages/contracts/src/ReviewInput";
export function reviewCommand(
  domain: string,
  proposal: ProposalView,
  action: ReviewInput["action"],
  reason: string,
  key: string,
) {
  const allowed =
    proposal.status === "ready"
      ? ["reject", "defer", "request_changes"]
      : proposal.status === "deferred"
        ? ["reject", "request_changes", "reopen"]
        : proposal.status === "changes_requested"
          ? ["reject"]
          : [];
  if (
    !allowed.includes(action) ||
    !reason.trim() ||
    Array.from(reason).length > 2000
  )
    throw new Error(
      "Décision incompatible avec l’état affiché ou motif invalide.",
    );
  return {
    name: "api_proposals_review",
    arguments: {
      path: { domain, ident: proposal.id },
      body: {
        action,
        digest: proposal.digest,
        expected_review_revision: proposal.review_revision,
        reason: reason.trim(),
        idempotency_key: key,
      },
    },
  };
}
export type ReviewCommandHandle = {
  act: (intent: DecisionIntent) => Promise<string>;
};
export const ReviewCommand = forwardRef<
  ReviewCommandHandle,
  {
    api: CortexApi;
    domain: string;
    proposal: ProposalView;
    capabilities?: readonly string[];
    onReadError?: (error: Error) => void;
    onNotice?: (message: string) => void;
  }
>(function ReviewCommand(
  { api, domain, proposal, capabilities = [], onReadError, onNotice },
  ref,
) {
  const [reason, setReason] = useState("");
  const [prepared, setPrepared] = useState<{
    command: ReturnType<typeof decisionCommand>;
    action: DecisionAction;
    subject: string;
    domainName: string;
    version: DomainVersion;
    reason: string;
    checkedAt: number;
  }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const preparedRef = useRef<typeof prepared>();
  const readController = useRef<AbortController>();
  const mounted = useRef(true);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readController.current?.abort();
    };
  }, []);
  const allowed = availableDecisions(proposal.status, capabilities);
  const validReason =
    reason.trim().length > 0 && Array.from(reason).length <= 2000;
  function notice(value: string) {
    if (mounted.current) {
      setMessage(value);
      onNotice?.(value);
    }
    return value;
  }
  async function prepare(action: DecisionAction, input: string) {
    if (inFlight.current) return notice("Une vérification est déjà en cours.");
    if (preparedRef.current)
      return notice(
        "Un projet de décision existe déjà. Consultez-le ou annulez-le avant d’en préparer un autre.",
      );
    if (!allowed.includes(action))
      return notice(
        "Cette décision n’est pas disponible avec vos accès et l’état affiché.",
      );
    inFlight.current = true;
    const controller = new AbortController();
    readController.current = controller;
    setBusy(true);
    try {
      const identity = validateIdentity(
        await api.call("identity.read", {}, undefined, {
          signal: controller.signal,
        }),
      );
      const scope = identity.domains.find((d) => d.id === domain);
      if (
        !scope ||
        !availableDecisions(proposal.status, scope.capabilities).includes(
          action,
        )
      )
        throw new ApiError(403, "not_authorized");
      const version = await api.call("domain.version", { domain }, undefined, {
        signal: controller.signal,
      });
      const current = await api.call(
        "proposals.read",
        {
          domain,
          proposal_id: proposal.id,
        },
        undefined,
        { signal: controller.signal },
      );
      if (
        !current ||
        current.id !== proposal.id ||
        current.digest !== proposal.digest ||
        current.review_revision !== proposal.review_revision ||
        current.status !== proposal.status ||
        current.base_version !== proposal.base_version
      )
        throw new ApiError(409, "review_changed");
      const command = decisionCommand(
        domain,
        current,
        version,
        action,
        input,
        crypto.randomUUID(),
      );
      if (!mounted.current)
        return "Préparation interrompue ; aucune décision envoyée.";
      const next = {
        command,
        action,
        subject: identity.subject,
        domainName: scope.name,
        version,
        reason: input.trim(),
        checkedAt: Date.now(),
      };
      preparedRef.current = next;
      setPrepared(next);
      if (details.current) details.current.open = true;
      return notice(
        `${decisionLabels[action]} · révision ${current.review_revision}. Projet préparé pour confirmation dans votre hôte MCP ; décision non exécutée.`,
      );
    } catch (error) {
      if (controller.signal.aborted || !mounted.current)
        return "Préparation interrompue ; aucune décision envoyée.";
      if (error instanceof ApiError) {
        onReadError?.(error);
        return notice(
          error.status === 409
            ? "La proposition a changé. Actualisez la revue avant de préparer une décision."
            : "Accès ou lecture indisponible. Actualisez avant de décider.",
        );
      }
      return notice(
        error instanceof Error ? error.message : "Préparation indisponible.",
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function act(intent: DecisionIntent) {
    if (intent.kind === "decision_prepare") {
      setReason(intent.reason);
      return prepare(intent.action, intent.reason);
    }
    if (intent.kind === "decision_confirm")
      return notice(
        "La confirmation humaine dans cette console n’est pas raccordée. Faites examiner la commande exacte par votre hôte MCP de confiance ; aucun envoi n’a lieu ici.",
      );
    if (intent.kind === "decision_cancel") {
      if (inFlight.current)
        return notice("Attendez la fin de la vérification.");
      preparedRef.current = undefined;
      setPrepared(undefined);
      return notice(
        "Projet local fermé. Une commande déjà exécutée ailleurs n’est pas annulée.",
      );
    }
    if (details.current) details.current.open = true;
    return notice(
      prepared
        ? `${decisionLabels[prepared.action]} · commande exacte disponible dans le dossier ; décision non exécutée par cette console.`
        : "Aucun projet de décision préparé.",
    );
  }
  useImperativeHandle(ref, () => ({ act }));
  if (!allowed.length) return null;
  return (
    <details ref={details} className="decision-preparation">
      <summary>Préparer une décision pour l’hôte de confiance</summary>
      <p>
        La confirmation humaine dans cette console n’est pas raccordée. Vous
        pouvez préparer la commande exacte à faire examiner et confirmer dans
        votre hôte MCP de confiance.
      </p>
      {!prepared && (
        <>
          <label>
            Motif de la décision
            <textarea
              maxLength={4000}
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {Array.from(reason).length > 2000 && (
            <p role="alert">Le motif doit contenir au plus 2 000 caractères.</p>
          )}
          {allowed.map((action) => (
            <button
              key={action}
              disabled={busy || (action !== "publish" && !validReason)}
              onClick={() => void prepare(action, reason)}
            >
              Préparer : {decisionLabels[action]}
            </button>
          ))}
        </>
      )}
      {busy && (
        <ActivityStatus>
          Vérification des accès, versions et de la proposition…
        </ActivityStatus>
      )}
      {prepared && (
        <section aria-label="Projet de décision">
          <h4>{decisionLabels[prepared.action]} · décision à confirmer</h4>
          <p>
            {prepared.domainName} · acteur {prepared.subject} · révision de
            revue {proposal.review_revision}
          </p>
          <p>{decisionEffect(prepared.action)}</p>
          {prepared.action !== "publish" && <p>Motif : {prepared.reason}</p>}
          <p>
            Savoir accepté : v{prepared.version.accepted_version} · publié : v
            {prepared.version.published_version}. Vérification faite à{" "}
            {new Date(prepared.checkedAt).toLocaleTimeString("fr")}. Une
            préparation ne réserve pas les versions. Les droits et versions
            seront revérifiés par le serveur à l’exécution.
          </p>
          <details>
            <summary>Commande MCP exacte et références</summary>
            <p>
              Proposition {proposal.id} · empreinte {proposal.digest}. Ne
              transmettez cette commande qu’à votre hôte autorisé pour ce
              domaine.
            </p>
            <label>
              Commande MCP à faire confirmer
              <textarea
                readOnly
                rows={12}
                value={JSON.stringify(prepared.command, null, 2)}
              />
            </label>
          </details>
          <p>
            Après exécution par l’hôte, actualisez la proposition et son
            historique pour connaître le résultat. Conservez la même commande en
            cas de résultat inconnu ; une nouvelle préparation crée une nouvelle
            intention.
          </p>
          <button onClick={() => void act({ kind: "decision_cancel" })}>
            Annuler le projet de décision
          </button>
        </section>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
});
