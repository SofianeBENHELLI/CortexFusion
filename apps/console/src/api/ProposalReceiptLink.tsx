import { Link, useSearchParams } from "react-router-dom";
import { proposalHref } from "./navigation";
import { proposalLabels, type ProposalReceipt } from "./proposal-receipt";

export function ProposalReceiptLink({
  domain,
  receipt,
}: {
  domain: string;
  receipt: ProposalReceipt;
}) {
  const [params] = useSearchParams();
  return (
    <p role="status">
      Proposition enregistrée : {receipt.id}. État au retour :{" "}
      {proposalLabels[receipt.status]}.{" "}
      <Link to={proposalHref(params, domain, receipt.id)}>
        Ouvrir la revue de cette proposition
      </Link>
      . La revue relira son état actuel. Ce formulaire ne prend aucune décision
      d’approbation ou de publication ; le ticket n’est pas automatiquement
      résolu.
    </p>
  );
}
