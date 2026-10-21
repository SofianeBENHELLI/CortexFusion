# Branchement progressif du frontend — français

## État livré

Le mode par défaut reste `mock`. Il conserve tous les parcours de démonstration et leur stockage local. Le mode `api` ouvre un écran distinct de connexion : identité, domaines accessibles, rôle effectif, version acceptée et version publiée. Une erreur de connexion ne déclenche jamais un retour automatique vers des données synthétiques. Le transport API reste manuel par défaut ; `VITE_AUTH_MODE=session` active le nouvel adaptateur de session serveur, encore en recette.

L’interface raccorde les conversations extractives, citations et feedback, la consultation des tickets, la revue des propositions et BrainMap/Chronique. La carte utilise des fenêtres de résumés, le détail à la demande et les changements réellement publiés. La liste typée courante est maintenue dans `src/api/operations.ts`. La revue prépare certaines commandes pour l’hôte de confiance ; elle ne signe et n’exécute pas l’approbation ou la publication dans le navigateur.

## Démarrage

### Accès local direct temporaire — 16 octobre 2026

À la demande de Sofiane, l’espace privé peut être ouvert directement à
`http://127.0.0.1:5175/`, sans UUID ni jeton à saisir. BrainMap sélectionne le
domaine configuré uniquement s’il figure dans les droits relus par le backend.
Le login manuel et ses clés sont conservés. Il s’agit d’un mode personnel sur
ce Mac : toute personne ayant accès au navigateur local peut ouvrir cet espace.

Avec l’API privée8013 déjà démarrée et le port5175 libre :

```sh
.venv/bin/python -m scripts.okf_browser --access local
```

Ce lanceur démarre Vite5175 et la façade locale8015. Celle-ci réutilise l’identité
existante, conserve les jetons courts côté serveur et émet un cookie HttpOnly.
Un rechargement restaure l’accès ; l’expiration normale renouvelle la session
automatiquement. Un refus ou une panne masque les données et propose une reprise
explicite, sans rejouer de mutation. « Fermer l’espace » ferme la session courante ;
« Ouvrir ma base de connaissances » la rouvre. Ce bouton ne verrouille pas le mode
local : un nouveau chargement de l’adresse y donne à nouveau accès.

Pour rétablir la saisie manuelle, arrêter ce lanceur puis exécuter :

```sh
.venv/bin/python -m scripts.okf_browser --access manual
```

Aucune donnée, clé ou identité n’est supprimée. Aucun changement de permission,
de durée des jetons natifs (30 minutes), de configuration IdP ou de protection MCP.
Le mode reste explicite, désactivé par défaut dans les autres lancements. La
façade vérifie Host/Origin, conserve CSRF et les29 routes revues ; elle n’expose
pas MCP ni signature automatique d’approbation/publication. Ne pas publier cette
façade personnelle sur Internet. L’accès distant nécessite le mode authentifié.

Preuves nouvelles :197 tests Python session/proxy/CLI/local et90 tests console/
relais ciblés réussis ; build API session/local réussi. Chrome bureau : ouverture
de `/`, rechargement et fermeture/réouverture sans saisie. Ces preuves ne ferment
pas l’audit UI/UX ni les recettes mobile/IdP/charge encore ouvertes.

Depuis la racine du dépôt :

```sh
# Démonstration existante
npm run dev --prefix apps/console

# Connexion au backend, sur un autre port pour garder la démo ouverte
VITE_DATA_MODE=api CORTEX_API_TARGET=http://127.0.0.1:8011 npm run dev --prefix apps/console -- --port 5174
```

L’API Rust doit être démarrée séparément. Ajuster `CORTEX_API_TARGET` à son adresse réelle. Cette variable configure le proxy Vite côté serveur ; elle ne contient aucun secret. Redémarrer Vite après modification. Le backend doit autoriser l’origine exacte du navigateur avec `CORTEX_CORS_ORIGINS='["http://127.0.0.1:5174"]'`, y compris derrière le proxy : celui-ci conserve le header Origin. Le navigateur appelle uniquement `/api/v1/...` sur sa propre origine ; le proxy retire `/api`.

En production, `VITE_DATA_MODE=api` doit être défini au build et un reverse proxy doit fournir le même routage `/api` vers Rust. Le proxy de développement Vite n’est pas inclus dans les fichiers statiques produits. Utiliser HTTPS et le fournisseur d’identité prévu pour le déploiement.

## Session manuelle et droits

L’écran demande un UUID de tenant et un **jeton utilisateur Open Br**AI**n** déjà émis par le système d’identité. Ce n’est ni une clé OpenRouter, ni une clé de signature serveur. Aucun jeton n’est embarqué dans le bundle ou enregistré dans localStorage/sessionStorage. Le jeton est effacé du champ à la connexion, reste en mémoire et disparaît au rechargement ou à la déconnexion.

Le transport manuel envoie `Authorization: Bearer …` et `x-tenant-id`. La déconnexion annule les lectures en cours et retire les données API du cache. Les redirections sont refusées et les cookies ne sont pas envoyés dans ce mode. Les rôles et capacités proviennent de `/v1/me` ; le sélecteur de rôle de démonstration n’existe pas en mode API.

## Session serveur optionnelle — développement local

Depuis le 6 octobre, le mode `VITE_AUTH_MODE=session` restaure `/auth/session` au chargement et présente « Se connecter » vers le fournisseur configuré, sans formulaire tenant/JWT. Le [gateway](../../services/browser-gateway/README.md) et son fournisseur doivent être configurés et démarrés séparément ; aucun compte, IdP ou jeton utilisable n’est provisionné par la console. Le mode manuel reste disponible avec `VITE_AUTH_MODE=manual` ou sans cette variable. Une configuration invalide échoue explicitement, sans repli vers un autre mode.

```sh
# Après configuration explicite du gateway, avec CORTEX_BROWSER_ORIGIN=http://127.0.0.1:5174
.venv/bin/cortex-browser-gateway --check
.venv/bin/cortex-browser-gateway

# Dans un autre terminal ; API et fournisseur configuré déjà disponibles
VITE_DATA_MODE=api VITE_AUTH_MODE=session \
  CORTEX_BROWSER_GATEWAY_TARGET=http://127.0.0.1:8015 \
  npm run dev --prefix apps/console -- --port 5174
```

En session, `/auth` et `/api` sont relayés **sans retirer `/api`**, avec Host/Origin conservés, vers le gateway loopback explicite. Le relais Vite dédié fonctionne en développement et preview ; il évite le logger de proxy générique qui peut afficher l’URL de callback lors d’une erreur. Il n’enregistre aucun code/query/corps et renvoie un502 générique en cas de panne, avec timeout/annulation. Le gateway reste responsable de la vérification de l’origine canonique, cookies, CSRF et droits du grant. `CORTEX_API_TARGET` n’est pas utilisé dans ce mode. Les fichiers statiques seuls ne contiennent pas ce relais : la topologie HTTPS de production reste à construire et valider.

Les requêtes API emploient les cookies same-origin et, pour POST, le CSRF conservé uniquement en mémoire. Aucun bearer ni tenant choisi par le navigateur n’est envoyé. Le retour d’authentification ne transporte que les paramètres de navigation validés, jamais question/texte/jeton. Un401, l’échéance serveur ou une sortie dans l’historique masque/démonte les données privées et purge le cache ; la reconnexion conserve le contexte URL autorisé. La déconnexion masque immédiatement les données mais ne se dit terminée qu’après204/401 ; réponse perdue → message d’incertitude et réessai explicite, sans rejeu automatique.

Revenir au focus relit la session en masquant temporairement l’espace. Si session, identité et domaines sont inchangés, le composant et son brouillon non envoyé sont conservés. Si l’identité/droits changent, si la lecture échoue ou si la session expire, les anciennes données sont purgées ; un autre utilisateur ne récupère pas le brouillon. Les brouillons restent en mémoire et ne survivent pas à un véritable rechargement/expiration. Le renouvellement automatique de jetons n’est pas implémenté ; l’expiration exige une nouvelle connexion.

**Preuves au 6 octobre00:47 UTC :** tests composants/transport et relais Node/Vite sur HTTP synthétique, typage et builds API manuel/session réussis. La configuration Vite réelle a relayé `/auth/session` et `/api/v1/me` sans changer les chemins/Host, refusé `.runtime` et renvoyé502 à la panne. **Complément du6 octobre01:39 UTC : huit contrôles intégrés réussis sur8**, en HTTPX, sur fournisseur synthétique → gateway CLI → relais Vite → natif/PostgreSQL/Terminus. Identité/droits, preuve longue, idempotence, rotation/logout/expiration/reconnexion vérifiés sans réingestion. **Aucune exécution React/Chrome du nouveau mode** ; desktop/mobile, thèmes, clavier, politique des cookies et reprise visuelle restent à vérifier après déblocage du contrôle Chrome. Aucun nouveau droit natif ni confirmation owner découle de ce mode.

## Contrats disponibles

| Intention | Opération | Endpoint | État UI |
| --- | --- | --- | --- |
| Identifier l’utilisateur et ses domaines | `identity.read` | `GET /v1/me` | Branché |
| Retrouver ses imports de texte | `imports.list` | `GET /v1/domains/{domain}/imports` | Mes imports, pages de dix lots |
| Relire un lot | `imports.read` | `GET /v1/domains/{domain}/imports/{import_id}` | États par fichier, source intégrale et lien opaque |
| Relire sa collection accessible | `collections.read` | `GET /v1/domains/{domain}/collections/{collection_id}` | Nom relu avec droits actuels |
| Distinguer savoir accepté et publié | `domain.version` | `GET /v1/domains/{domain}/version` | Branché |
| Lire une fenêtre autorisée du graphe | `graph.window` | `GET /v1/domains/{domain}/graph/window` | BrainMap, pagination/recherche/focus |
| Lire un concept sélectionné | `concepts.read` | `GET /v1/domains/{domain}/concepts/{concept_id}` | Détail à la demande |
| Lire les publications récentes | `publications.list` | `GET /v1/domains/{domain}/publications` | Chronique owner, profondeur 20 ou jusqu’à 100 |
| Expliquer les différences publiées | `proposals.diff_summary` | `GET /v1/domains/{domain}/proposals/{proposal_id}/diff/summary` | Chronique, empreintes sans corps |
| Relire une preuve | `sources.read` | `GET /v1/domains/{domain}/sources/{source_id}` | Texte/empreinte avec droits actuels |
| Consulter les propositions | `proposals.list/read/diff/reviews` | Voir [la référence frontend](../../docs/frontend-api.fr.md) | Revue et historique, données réelles |
| Consulter les tickets et épisodes | `issues.list/read`, `episodes.read` | Voir [la référence frontend](../../docs/frontend-api.fr.md) | Lecture, preuves et traitement |
| Traiter un ticket | `issues.decide` | `POST /v1/domains/{domain}/issues/{ident}/decisions` | Prise en charge, résolution, écartement, réouverture avec motif et reçu |
| Proposer un ajout ou une correction de titre | `proposals.create` | `POST /v1/domains/{domain}/proposals` | Depuis un ticket et ses preuves ; aucune publication automatique |
| Lire tous les concepts | `concepts.list` | `GET /v1/domains/{domain}/concepts` | Sélection de la correction de titre ; non utilisé par BrainMap |
| Retrouver les conversations personnelles | `conversations.list` | `GET /v1/domains/{domain}/conversations` | Branché, pagination |
| Créer une conversation | `conversations.create` | `POST /v1/domains/{domain}/conversations` | Branché |
| Lire ses messages | `conversations.messages` | `GET /v1/domains/{domain}/conversations/{ident}/messages` | Branché |
| Interroger le domaine | `conversations.query` | `POST /v1/domains/{domain}/conversations/{ident}/query` | Branché, réponse JSON |
| Donner un retour personnel | `episodes.feedback` | `POST /v1/domains/{domain}/episodes/{episode_id}/feedback` | Branché |

Les types d’entrée et de sortie sont importés des contrats générés du dépôt. Les chemins et méthodes sont vérifiés contre OpenAPI et les extensions Rust maintenues. Le typage TypeScript ne remplace pas la validation à l’exécution : les consommateurs vérifient aussi identité, versions, fenêtres, différences et preuves avant affichage. Les projections mock, catalogue local et API sont distinctes ; aucun DTO connecté n’est remplacé par un objet de démonstration.

## Revue liée à une proposition

`api_proposal` restaure un identifiant opaque dans l’espace de travail, y compris hors première page et après connexion. Il conserve les identifiants de conversation/import du même domaine ; aucun motif, corps ou commande préparée ne va dans l’URL. La lecture vérifie successivement proposition, comparaison puis proposition : un changement de digest/révision/état/base interrompt l’affichage. L’approbation native peut changer l’état sans changer la révision de revue. Ce contrôle n’est pas un snapshot serveur ; le natif revalide toujours une commande au moment de la décision.

Actualiser masque l’ancienne comparaison pendant sa relecture. Refus de preuve/historique/détail : corps et intitulés cachés,401 propose la reconnexion. Un historique plus récent que la révision affichée force une relecture. Les reports, corrections, rejets et réouvertures possèdent des reçus de revue ; approbation et publication ont des reçus distincts. Préparer une commande pour l’hôte de confiance ne l’exécute pas et ne fournit aucun pouvoir de signature au navigateur.

Au6 octobre03:47 UTC : composants/régressions et4/4 contrôles HTTP natifs réussis sur la fixture synthétique persistante. Quatre nouveaux parcours Chrome de revue restent à exercer après déblocage ; aucun nouveau parcours navigateur qualifié. Voir AUD05-E–H dans la matrice.

## Erreurs et actions

Le suivi « Mes imports » est personnel et en lecture seule. Il concerne les lots du canal natif de texte local, pas les autres canaux d’ingestion ni le pipeline privé OKF. Les compteurs portent sur les fichiers traités et les lots de la page ; une source dédupliquée ne compte pas comme deux sources créées. Import réussi ne signifie ni proposition revue ni connaissance publiée. L’API native garde ses limites existantes (20 fichiers de30 000 caractères au plus par lot) ; aucune promesse d’upload de grands documents n’est déduite de ce lecteur.

La sélection `api_import` est un UUID, conservé avec `api_domain` dans le retour de connexion. Les curseurs/identités/états sont vérifiés avant affichage. Actualiser relit les données, sans réessai automatique de mutation. Refus de lot, collection ou source : anciens intitulés masqués, relecture/reconnexion explicite. Le frontend et le proxy ne proposent toujours pas création, traitement, retry, annulation, approbation ou publication de lot. Au6 octobre02:54 UTC : composants et5/5 contrôles HTTP natifs passés, quatre scénarios Chrome AUD05 encore en attente ; voir la matrice.

- 401 : reconnexion nécessaire ; 403 : action interdite ou origine de console refusée, si ce code public est présent ; 404 : absent ou inaccessible.
- 409 : conflit à relire, ou correction non publiée/inactive lorsque ces codes publics sont reconnus ; 422 : données invalides ; 429 : limite atteinte. Le corps d’erreur est borné et aucun message serveur arbitraire n’est affiché.
- Indisponibilité, timeout ou réponse non JSON : erreur explicite, jamais de faux succès. Le détail brut du serveur n’est pas affiché.
- Chaque appel accepte une annulation et un délai maximal, 30 secondes par défaut. La lecture BrainMap complète demande une annulation après 45 secondes ; son journal a aussi des budgets de réponses et d’événements décrits dans [ADR 0006](../../docs/architecture/decisions/0006-bounded-extended-journal.md).
- Aucun POST n’est relancé automatiquement. Le parcours appelant doit conserver la même clé d’idempotence pour reprendre la même intention après un résultat incertain.
- Les confirmations signées restent à raccorder via un service autorisé ; aucune clé privée ne doit être placée dans le navigateur.

## BrainMap, couverture et validation

Après connexion, ouvrir « Vue d’ensemble BrainMap », puis un domaine. Chaque domaine conserve sa propre version et ses stocks autorisés ; il n’existe pas encore de projection atomique ni de journal joint entre domaines. Carte, frise, journal et compteurs de changements partagent le périmètre sélectionné. Les stocks restent ceux du graphe actuel.

Le journal owner est limité à vingt publications par défaut, extensible à cinq pages de vingt dans une observation. Une lecture incomplète le reste explicitement ; les autres rôles ont un historique indisponible plutôt qu’un faux zéro. Un accès ou une version changé invalide la lecture ; les preuves sont relues à la demande avec offsets Unicode, pas UTF-16. La source complète n’est pas incluse dans chaque résumé.

L’affichage de la Chronique montre cinq événements, puis permet de parcourir les événements chargés par pages de quarante, avec accès direct à une page. Cette pagination locale ne charge pas une autre page de publications et ne complète pas l’historique serveur ; les indicateurs de couverture restent indépendants. Les libellés de cibles hors page peuvent être complétés par les différences autorisées déjà chargées, sans requête supplémentaire ni reconstruction d’un titre historique garanti. La [qualification locale à 1 000 concepts](../../docs/product/brain-scale-1000.fr.md) documente les mesures, les parcours et leurs limites.

La [recette connectée](../../docs/frontend-real-acceptance.fr.md) documente les scénarios effectivement réussis avec Rust, PostgreSQL et TerminusDB : publication puis observation, absence d’effet à la seule approbation, reprise sans inflation, preuves, poids explicitement modifiés, retraits, visibilité et reprise d’URL. Les publications de recette passent par le script gouverné, pas par un bouton de publication prétendument raccordé dans cette console. Le [bilan de préparation](../../docs/product/brain-pilot-readiness.fr.md) distingue ces preuves des mécanismes biomimétiques restant à construire.

Le build API exclut la démonstration et charge chaque espace à la demande. Un échec de module affiche une récupération explicite. Éviter de remplacer les assets d’une preview sous une session de recette sans la recharger : un ancien index peut demander un module qui vient d’être remplacé. Recharger garde le lien mais perd le jeton ; après reconnexion, domaine et sélection sont restaurés. Cela ne garantit pas la reprise d’une commande de mutation non confirmée.

## Conversation, citations et reprise

La sélection de conversation utilise `api_conversation` (UUID) dans l’URL, avec le domaine et l’espace. Un lien direct relit les échanges même si cette conversation n’apparaît pas dans la première page de la liste. Un UUID mal formé affiche une récupération explicite sans lecture d’échanges. Le lien vers une fiche actuelle conserve la conversation et les paramètres du même domaine ; changer de domaine les efface. Les boutons de reconnexion après 401 conservent cette URL, purgent le cache puis revérifient l’identité. La nouvelle recette navigateur de ce sous-cas AUD-04 reste à terminer ; voir la matrice.

Cette conservation ne rend pas les deux lecteurs BrainMap équivalents : période, caméra et dispositions du lecteur par défaut ne sont pas encore toutes représentées dans l’URL. Aucune question, citation ni credential n’est ajouté à l’URL par le parcours de conversation. Les identifiants ne donnent aucun droit ; le backend contrôle chaque lecture.

La question crée une conversation si nécessaire puis appelle le moteur extractif, sans synthèse externe. L’interface affiche la version servie, les lacunes et les extraits de citation dépliables avec leur source et localisation. Les images Markdown distantes ne sont pas chargées automatiquement. Les listes et échanges disposent d’une pagination.

La création, la question et le feedback disposent chacun d’une clé d’idempotence. En cas de résultat incertain, « Réessayer la même demande » ou « Réessayer le même retour » réemploie le payload initial et sa clé ; aucun nouveau POST n’est lancé automatiquement. La question reste en mémoire mais un rechargement, un changement de domaine, une déconnexion ou le démontage vers BrainMap perd la reprise locale. Un changement de conversation par Back annule l’intention locale et n’affiche jamais sa réponse tardive dans une autre conversation. L’historique confirmé reste côté serveur. Un refus de lecture masque les données précédemment affichées.

Les retours sont rattachés à l’épisode réel et leur réception est confirmée par le serveur. Ils ne modifient pas le savoir publié. Le choix de modèle, SSE et la génération de corrections restent à raccorder.

Les reçus de retour et les intentions incertaines restent liés à leur épisode dans la session de l’espace de conversation, y compris après une question suivante ou une sélection d’une autre conversation. Ils ne sont pas restaurés par une API dédiée après rechargement : la persistance de la restitution est distincte de l’enregistrement serveur du retour. La barre Conversations / Tickets et retours / Propositions déplace le focus sans démonter ces espaces.

La [matrice de recette frontend](../../docs/product/frontend-acceptance-matrix.fr.md) indique les parcours de navigateur vérifiés, les simulations de composants et les écarts de parité : import/administration générale, décisions sensibles exécutées depuis le navigateur, dictée API et mécanismes biomimétiques ne doivent pas être déduits de la démonstration.

Après une reprise explicite du chargement des versions, le résultat reçoit le focus uniquement si le même domaine est encore sélectionné. Dans BrainMap, fermer les preuves par le bouton ou Échap rend le focus au bouton source d’origine, avec repli sur l’espace courant si ce bouton a disparu. Un changement de domaine démonte les lectures précédentes ; leurs réponses tardives ne doivent pas remplacer le nouveau périmètre.

Après un retour négatif confirmé ou une question retournant une connaissance manquante, la liste des tickets du domaine est relue automatiquement. Le serveur reste la source de vérité ; une réponse incertaine ne confirme aucun nouveau ticket. Le reçu récupère le focus si le bouton de retour vient de disparaître, sans interrompre une saisie commencée dans un autre champ. Les reçus restent en mémoire : ce correctif ne les restaure pas après rechargement.

Le serveur local Vite (développement et preview) intercepte les chemins à encodage invalide avant le fallback SPA : page 400 avec retour à l’accueil pour la navigation, erreur JSON bornée pour les autres requêtes. Cela ne remplace pas la configuration du serveur d’un futur hébergement.
