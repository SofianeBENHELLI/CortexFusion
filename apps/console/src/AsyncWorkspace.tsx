import { ActivityStatus } from "./ActivityStatus";
import { Component, Suspense, type ReactNode } from "react";

class WorkspaceBoundary extends Component<
  { name: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <section className="workspace-message" role="alert">
        <h2>Impossible d’ouvrir {this.props.name}</h2>
        <p>
          Rechargez la page pour réessayer. En mode connecté, vous devrez vous
          reconnecter ; votre lien de navigation sera conservé.
        </p>
        <button onClick={() => window.location.reload()}>
          Recharger la page
        </button>
      </section>
    ) : (
      this.props.children
    );
  }
}

/** A failed workspace leaves its surrounding navigation and sign-out usable. */
export function AsyncWorkspace({
  name,
  resetKey,
  children,
}: {
  name: ReactNode;
  resetKey: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceBoundary key={resetKey} name={name}>
      <Suspense
        fallback={<ActivityStatus>Ouverture de {name}…</ActivityStatus>}
      >
        {children}
      </Suspense>
    </WorkspaceBoundary>
  );
}
