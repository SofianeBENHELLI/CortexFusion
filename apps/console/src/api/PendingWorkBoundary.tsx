import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker, type BlockerFunction } from "react-router-dom";

type PendingWork = { label: string; state: "sending" | "uncertain" | "draft" };
const Boundary = createContext<{
  register: (id: string, work: PendingWork) => () => void;
  requestExit: (action: () => void) => void;
}>({ register: () => () => {}, requestExit: (action) => action() });

/** Only context changes unmount this workspace. Dossier navigation stays free. */
export function changesWorkContext(
  current: { pathname: string; search: string },
  next: { pathname: string; search: string },
) {
  const a = new URLSearchParams(current.search),
    b = new URLSearchParams(next.search);
  const view = (p: URLSearchParams) =>
    ["brain", "overview"].includes(p.get("api_view") ?? "")
      ? p.get("api_view")
      : "work";
  return (
    current.pathname !== next.pathname ||
    a.get("api_domain") !== b.get("api_domain") ||
    view(a) !== view(b)
  );
}

/** Requires the data router used at the application root, including browser Back. */
export function PendingWorkBoundary({ children }: { children: ReactNode }) {
  const registry = useRef(new Map<string, PendingWork>());
  const [revision, setRevision] = useState(0);
  const [manual, setManual] = useState<{ action: () => void }>();
  const dialog = useRef<HTMLDialogElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const register = useCallback((id: string, work: PendingWork) => {
    registry.current.set(id, work);
    setRevision((r) => r + 1);
    return () => {
      registry.current.delete(id);
      setRevision((r) => r + 1);
    };
  }, []);
  const requestExit = useCallback((action: () => void) => {
    if (registry.current.size === 0) action();
    else setManual({ action });
  }, []);
  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) =>
        registry.current.size > 0 &&
        changesWorkContext(currentLocation, nextLocation),
      [],
    ),
  );
  const work = useMemo(() => [...registry.current.values()], [revision]);
  const blocked = blocker.state === "blocked" || !!manual;
  const sending = work.some((item) => item.state === "sending");
  const drafts = work.some((item) => item.state === "draft");
  const commands = work.some((item) => item.state !== "draft");
  const draftOnly = drafts && !commands;
  const stay = useCallback(() => {
    if (blocker.state === "blocked") blocker.reset();
    setManual(undefined);
  }, [blocker]);
  useEffect(() => {
    if (!work.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [work.length]);
  useEffect(() => {
    if (!work.length && blocked) stay();
  }, [work.length, blocked, stay]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (blocked && !element.open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
      stayButton.current?.focus();
    } else if (!blocked && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
      returnFocus.current?.focus();
    }
  }, [blocked]);
  function leave() {
    if (sending) return;
    const action = manual?.action;
    setManual(undefined);
    if (action) {
      if (blocker.state === "blocked") blocker.reset();
      action();
    } else if (blocker.state === "blocked") blocker.proceed();
  }
  return (
    <Boundary.Provider
      value={useMemo(
        () => ({ register, requestExit }),
        [register, requestExit],
      )}
    >
      {children}
      <dialog
        ref={dialog}
        className="pending-work-dialog"
        role="alertdialog"
        aria-labelledby="pending-work-title"
        aria-describedby="pending-work-description"
        onCancel={(event) => {
          event.preventDefault();
          stay();
        }}
      >
        <h2 id="pending-work-title">
          {draftOnly
            ? "Des saisies ne sont pas enregistrées"
            : drafts
              ? "Du travail reste à terminer"
              : "Une action reste à vérifier"}
        </h2>
        <p id="pending-work-description">
          {drafts &&
            "Changer d’espace abandonnera les saisies ou préparations non enregistrées en mémoire. Aucun texte ne sera sauvegardé automatiquement. "}
          {commands &&
            "Changer d’espace peut faire perdre la préparation et la clé de reprise conservées dans cet onglet. Quitter n’annule pas une action déjà reçue par le serveur."}
        </p>
        <ul>
          {work.map((item, index) => (
            <li key={index}>
              {item.label} ·{" "}
              {item.state === "sending"
                ? "en cours"
                : item.state === "draft"
                  ? "non enregistré"
                  : "résultat inconnu"}
            </li>
          ))}
        </ul>
        <p>
          {sending
            ? "Attendez la fin de l’envoi pour vérifier son résultat."
            : draftOnly
              ? "Restez pour enregistrer ou annuler votre saisie. Quitter n’enverra rien."
              : "Revenez à l’action pour vérifier son reçu ou reprendre exactement le même envoi. Aucun nouvel envoi ne sera déclenché par ce dialogue."}
        </p>
        <div>
          <button ref={stayButton} onClick={stay}>
            {draftOnly ? "Revenir à ma saisie" : "Rester et vérifier"}
          </button>
          <button disabled={sending} onClick={leave}>
            {draftOnly ? "Quitter sans enregistrer" : "Quitter sans vérifier"}
          </button>
        </div>
      </dialog>
    </Boundary.Provider>
  );
}

/** Register only non-sensitive descriptions; never persist a command body here. */
export function usePendingWork(
  label: string,
  state: PendingWork["state"] | undefined,
) {
  const { register } = useContext(Boundary);
  const id = useId();
  useLayoutEffect(
    () => (state ? register(id, { label, state }) : undefined),
    [id, label, state, register],
  );
}
export const useExitRequest = () => useContext(Boundary).requestExit;
