# Audit du code, de la complétude produit et de l’architecture

Date : **5 octobre 2026**. Audit demandé par Sofiane, réalisé sur l’arbre de travail local de `feat/frontend-mock` (HEAD `c8bab43` **avec de nombreuses modifications et créations non commitées**). Les conclusions portent sur cet arbre, pas seulement sur HEAD. Aucun correctif applicatif, changement de données ou déploiement n’est effectué par cet audit.

## Suivi de réalisation — bilan du 12 octobre 2026

Les constats datés du 5 octobre ci-dessous restent l’état initial de l’audit. Les correctifs et leurs limites sont suivis dans le [journal](brain-delivery-status.fr.md) et la [matrice frontend](frontend-acceptance-matrix.fr.md). La fenêtre du 5–6 octobre est expirée et sa relance a été supprimée ; ce bilan ne réouvre pas la réalisation.

AUD-02 est corrigée dans sa portée extractive bornée. L’accès à session optionnelle, la navigation/reprise, les imports en lecture seule et la revue ont progressé sans clôturer AUD-01/03/04/05. Dernier correctif : un réessai idempotent de création peut retourner une proposition déjà approuvée/publiée ; les formulaires acceptent maintenant son état courant et proposent de relire la revue. Preuves :42 tests ciblés/7 fichiers, build API manuel,5/5 contrôles HTTP natifs. Le build session final, le dernier ajustement CI et le parcours Chrome ne sont pas entièrement revalidés. **28 actions demeurent ouvertes**, Step 1 à10 000, pilote biomimétique et UI/UX toujours incomplets. Priorités de reprise détaillées dans la roadmap ; aucun nouveau test ou correctif exécuté pendant ce bilan.

## 1. Conclusion

Open Br**AI**n **possède un socle de savoir gouverné et une navigation locale substantiels. Il n’est pas encore le cerveau collectif utilisable de bout en bout décrit par la spécification.** La publication, la provenance, les contrats et plusieurs protections d’accès sont les acquis à préserver. Les lacunes déterminantes sont l’accès utilisateur, le parcours owner, la qualité de l’exploitation du savoir, la qualification à froid et les mécanismes biomimétiques.

Trois distinctions conditionnent le plan :

- **Stocker et publier un document ne garantit pas de savoir répondre avec son contenu.** Le retrieval exclut un corps dépassant le budget au lieu d’en sélectionner une unité utile. Un concept de plus de 20 000 caractères ne peut donc jamais entrer dans la réponse extractive actuelle, alors que la publication native accepte 200 000 caractères.
- **Une réponse de carte bornée ne garantit pas un travail serveur borné.** Le lecteur progressif garde des vérifications et des traitements globaux, ainsi qu’un mutex partagé pendant les lectures et la préparation. Les mesures chaudes ne lèvent pas les échecs historiques à froid et en mémoire.
- **Une capacité backend ne constitue pas un parcours frontend livré.** La revue connectée prépare une commande pour un autre outil ; l’accès demande un tenant et un JWT ; le gestionnaire d’import, le brief owner et plusieurs fonctions d’administration ne sont pas des parcours aboutis dans la console.

Recommandation : **conserver le socle, corriger les ruptures, puis compléter les mécanismes**. Ne pas engager une réécriture générale ou ajouter des visualisations avant ces corrections. Le Step 1, le pilote biomimétique et la clôture UI/UX restent trois validations distinctes, toutes ouvertes.

## 2. Référentiel et méthode

### Sources de la cible

Le dossier original v0.5 a été retrouvé dans la copie locale de référence, extérieure à ce dépôt. Lecture des notes de recommandation, runtime, monitoring et architecture (12, 04, 05, 16), du plan et de l’observation (13, 02), et des sections pertinentes du modèle, de l’apprentissage et du backlog (01, 03, 09). Il ne s’agit pas d’une nouvelle validation de toutes les hypothèses marché, modèles ou licences des 17 notes. Le dossier confidentiel n’a pas été importé dans Git.

Ordre d’interprétation : décisions explicites ultérieures de Sofiane → périmètre accepté du prototype → spécification fonctionnelle originale et arbitrages documentés. Références de travail : [périmètre](prototype-scope.md), [expérience BrainMap](brain-experience-design.fr.md), [roadmap](roadmap.md), [état d’implémentation](../implementation-status.md), [matrice frontend](frontend-acceptance-matrix.fr.md), [protocole 10 000](brain-scale-10000.fr.md) et ADR existants.

Les demandes ultérieures rendent obligatoires le savoir OKF privé réellement publié, les 10 000 concepts qualifiés, la caméra continue façon carte géographique, les concepts et liens navigables, les thèmes monochromes et la Chronique. Elles n’autorisent ni l’envoi du corpus à un modèle externe, ni la publication de son contenu. Les Représentations restent différées.

### Nature des preuves

- **Code** : lecture ciblée des frontières UI, contrats, gouvernance, retrieval, publication, projections, layouts, scripts d’ingestion/qualification et CI. Les constats indiquent leurs chemins ; ce n’est pas une revue ligne par ligne de tout le dépôt ni un pentest.
- **Tests relancés** : suites locales sans mutation du corpus, détaillées en section 8. Un test de composant ne remplace pas Chrome.
- **Historique** : recettes navigateur, rapprochements et performances du journal des 2–5 octobre. Leurs dates, versions, dénominateurs et limites sont conservés ; ils n’ont pas été rejoués ici.
- **Disponibilité présente** : le 5 octobre vers 17:52 UTC, `curl` vers `http://127.0.0.1:5175/` échoue à se connecter (sortie 7, HTTP 000). Aucune nouvelle recette visuelle connectée n’est revendiquée. Cette observation ne prouve pas une panne des services de données ; aucun runtime privé n’a été relancé pour l’audit.

## 3. Ce que le produit doit permettre

| Utilisateur / responsabilité | Résultat attendu | Écart actuel déterminant |
|---|---|---|
| Collaborateur lecteur | Se connecter, choisir son domaine, poser une question, obtenir une réponse proportionnée et sourcée, ouvrir le concept et la preuve, signaler une erreur | Connexion technique ; réponse lexicale ; longs concepts exclus ; qualité métier non qualifiée |
| Explorateur du savoir | Zoomer et se déplacer continûment, comprendre les macro-liens puis les détails, rechercher, suivre les liens, lire intégralement, conserver ses repères | Navigation réelle présente ; deux lecteurs divergents ; stabilité après ajout/retrait et agrégats temporels incomplets |
| Owner / mainteneur | Comprendre ce qui a changé, examiner un lot et ses effets, demander une correction, approuver, publier, voir le résultat et le retrouver dans les réponses | Socle de décision présent ; interface de bout en bout manquante ; risque seulement bas ; brief et consolidation non intégrés |
| Responsable de corpus | Importer avec provenance, suivre les lots et exceptions, reprendre une interruption, enrichir sans doublonner, distinguer référence documentaire et relation validée | Scripts privés et capacités backend présents ; console d’import et apprentissage sémantique incomplets |
| Administrateur | Gérer domaines, identités, droits, budgets, disponibilité, sauvegardes et état réel du service | Primitives et recettes techniques ; accès produit et exploitation durable non qualifiés |
| Agent / client externe | Interroger via contrat stable, recevoir contexte ou réponse avec version et preuves, retourner un feedback ; proposer sans auto-approuver | HTTP/MCP et compagnon substantiels ; boucle complète avec IdP externe/harness et runtime sémantique incomplète |

Le biomimétisme doit avoir des effets explicables : mémoire active dérivée de savoir publié, conservation long terme, archivage gouverné avec rappel explicite, consolidation candidate sous budget et service continu sur la version publiée. Maturité, tier mémoire, statut du cycle de vie et état de publication sont des dimensions différentes. Un document importé n’est pas une mémoire court terme ; une référence Markdown n’est pas un renforcement ; un retrait n’est pas un archivage.

## 4. Complétude par rapport à la v0.5 et aux demandes ultérieures

Les références K/A/S/G/N/E/T renvoient aux familles du backlog original, **pas à des priorités de cet audit**. « Partiel » ne compte jamais comme « terminé ».

| Capacité / référence | Backend | Frontend / usage | Reste à livrer |
|---|---|---|---|
| Identités, domaines, provenance, journal — K01/K04–09 | Sous-ensemble source/verbatim, rôles, versions, journal et compensation existants | Lecture de concepts, liens, preuves et événements | Résumés canoniques, provenance par attribut, gouvernance étendue et export produit |
| Corpus et apprentissage — A01/A03/A09/A10/A12, T01 | Imports et worker ; scripts répétables ; contrôles de spans exacts ; extraction optionnelle | Import connecté absent ; revue sémantique des références absente | Segmentation logique, dédoublonnage/enrichissement, contradictions, résumé et fidélité ; suivi des lots |
| Servir — S01–11 | Retrieval lexical/extractif, épisodes, citations, feedback ; synthèse optionnelle et reçus durables | Conversations et preuves connectées | Entrée sémantique, expansion du graphe, budget en tokens, niveaux d’extrapolation, qualité sur questions métier |
| Gouverner — G01/G02, versionnage | Approbation humaine distincte, protection/rejeu, publication ; règle `owner_low_risk_v1` | Revue partielle ; commande préparée hors console | Décision authentifiée dans le produit, progression du lot, risque medium/high, règles reviewers/quorum |
| BrainMap + Chronique — G05, BRN-01–04 | Métadonnées globales et scènes/pages progressives ; historique borné avec couverture | Caméra, recherche, liens, preuve, événements ; lecteur progressif optionnel | Un seul parcours cohérent, positions stables, changements agrégés, travail serveur progressif, qualification complète |
| Mémoire et dynamique — K10/K11, BRN-05 | Non construits comme mécanisme actif | Non disponibles comme mesures réelles | Activations autorisées/dédoublonnées, sélection versionnée, règles de renforcement et decay associatif |
| Archive/réactivation — S12, BRN-06 | Retrait/compensation présents ; cycle archive absent | Pas de parcours gouverné d’archive | Impact, conservation d’identité, consultation explicite, réactivation revue |
| Sommeil et deux vitesses — N01–07, BRN-07 | Publication et reprise existent ; consolidation durable candidate absente | Pas de suivi réel des phases/effets | Orchestration, budgets, reprise, épreuves, revue et publication des effets ; rollback de release à compléter |
| Éclairer — E01–09 | Brief de référence et observations partielles ; pas de monitoring biomimétique complet | Chronique présente ; brief/admin/état collectif incomplets | Récit sourcé, actions owner, tendances avec couverture, coûts et santé opérationnelle sans score inventé |
| Évaluation — T01–08 | Tests et petites évaluations synthétiques | Recettes navigateur datées | Banque gouvernée métier, cas tenus à l’écart, qualité/fraîcheur/coût comparés au point de départ |
| Observer / converser avec experts — O/C | Proprioception partielle via épisodes/tickets ; pas d’observateur ou campagne complète | Pas de parcours correspondant | Connecteurs et consentement ; hypothèses → revue, jamais observation → vérité automatique |
| Exploitation / clients externes | RLS, JWKS, health/ready, reprise et restaurations locales documentées | Accès manuel et orchestration de développement | Connexion réelle, supervision, restauration coordonnée répétable, budgets, rétention, external-client acceptance |

L’import privé acquis (historique : **1 538 concepts/sources publiés et 16 217 références documentaires**) est un vrai jalon de préservation et de publication. Il ne qualifie pas la compréhension, les résumés, le retrieval métier ou les relations Cortex. Les fixtures 10 000 demeurent séparées du corpus.

## 5. Constats prioritaires du code

Priorités : **P1** = rupture de parcours ou obstacle au Step 1 ; **P2** = prochaine capacité structurante/pilote ; **P3** = extension après les portes de sortie. Aucun incident de sécurité critique nouvellement reproduit n’est affirmé ici. Cela ne constitue pas une certification de sécurité.

### F01 — P1 : le savoir long publié peut être inutilisable dans les réponses

**Suivi après audit, 5 octobre au soir :** correctif AUD-02 implémenté et éprouvé en extraction littérale, voir [ADR 0015](../architecture/decisions/0015-bounded-literal-context-passages.md). Passages sourcés bornés et statut `context_limited`, sans faux ticket ni Concept tronqué ; recette native et Chrome documentée dans le journal. Le constat ci-dessous décrit l’état au moment de l’audit. Résumé canonique, recherche sémantique, coût à l’échelle et parité générale restent ouverts.

**Preuve code.** [Snapshot natif](../../services/rust-core/src/snapshot.rs#L20) : corps jusqu’à 200 000 caractères. [Retrieval](../../services/rust-core/src/retrieval.rs#L121) : budget maximal 20 000, défaut 8 000 ; [sélection](../../services/rust-core/src/retrieval.rs#L210) : rejet du concept entier si son corps dépasse le budget restant. [Référence Python](../../services/core/src/cortex_core/service.py#L793) : même règle. Si aucun corps ne passe, le runtime produit `knowledge_gap` et crée un ticket, même quand le classement a trouvé du savoir pertinent.

**Impact.** Une recherche sur le titre et une lecture complète de la fiche peuvent réussir alors que la conversation n’utilise jamais ce concept. La phrase d’abstention mentionne le budget, mais le type du signal ne distingue pas absence de savoir et exclusion budgétaire. Cette conclusion découle du chemin de code ; aucune nouvelle requête au corpus privé n’est présentée comme preuve.

**Correction attendue.** Unité de retrieval courte et sourcée, puis résumé canonique fidèle/expansion sous budget ; accès au corps sur demande. Distinguer les causes d’abstention et ne pas alimenter une fausse lacune. Ne pas résoudre le défaut en injectant 200 000 caractères ou en relevant le plafond. Tester une réponse placée au début, au milieu et à la fin d’un corps long, les limites Unicode, la version et les droits.

### F02 — P1 : l’entrée produit repose encore sur une session de développeur

**Suivi 6 octobre00:47 UTC :** adaptateur OIDC, tentatives/sessions bornées, façade ASGI et proxy explicite des 26 méthodes/routes console codés dans `services/browser-gateway`. Lanceur local configurable, secrets par fichier privé, sans journalisation d’accès ni confiance aux headers forwarded. **238 tests protocole/session/proxy/CLI réussis ensemble** ; deux scénarios distincts de protocole et gateway sur HTTP loopback, ce dernier relayant aussi GET/POST vers des doubles synthétiques. Bornes de données, CSRF/Origin, en-têtes issus du grant, perte de réponse sans rejeu automatique et courses logout/déconnexion vérifiés. Adaptateur frontend cookie/CSRF, restauration et purge du cache, relais de développement Vite désormais codés sous `VITE_AUTH_MODE=session`. Suite console363 réussie, puis24 tests de frontière après ajustement du callback et10 tests relais finaux ; builds manuel/session réussis. Complément du6 octobre01:39 UTC : huit contrôles HTTP intégrés réussis sur8 via fournisseur synthétique/gateway CLI/Vite/natif, avec droits statiques, preuves longues, idempotence et cycle de session réel. HTTPX ne rend pas React ; Chrome reste à vérifier. Mode manuel toujours par défaut, renewal/identité réelle/confirmation owner/topologie HTTPS ouverts. La rupture d’accès utilisateur n’est pas déclarée résolue. Ces résultats ne remplacent pas la preuve Chrome ni une qualification avec fournisseur réel ; les droits natifs statiques de la fixture ont été exercés dans la chaîne HTTP.

**Preuve code.** [ApiConnection](../../apps/console/src/api/ApiConnection.tsx#L27) conserve la session en mémoire et initialise tenant/jeton vides ; le [formulaire](../../apps/console/src/api/ApiConnection.tsx#L136) demande les paramètres techniques. Le script [okf_workspace](../../scripts/okf_workspace.py) émet des accès locaux temporaires et un runtime à durée bornée. Il ne fournit pas un login navigateur renouvelable.

**Impact.** Sans accompagnement, l’utilisateur ne sait pas accéder au produit ou retrouver sa session. La conservation en mémoire protège le bearer ; elle n’est pas en soi un défaut de sécurité. Les demandes répétées d’accès de Sofiane correspondent à une rupture de parcours réelle.

**Correction attendue.** Connexion standard à l’identité configurée, choix de domaine, renouvellement et reconnexion préservant le contexte, déconnexion effective, refus explicites. Privilégier une session serveur/BFF avec cookie protégé pour le navigateur après ADR ; ne pas exposer de clé de signature ni stocker un bearer longue durée dans le frontend. Séparer « lancer l’environnement local » et « se connecter au produit ».

### F03 — P1 : les deux BrainMap ont des contrats d’expérience différents

**Suivi 5 octobre 20:45 UTC :** le sous-cas de perte de conversation a un correctif URL et des régressions de composants (retour, 401/reconnexion, changement de domaine, réponse tardive). Recette Chrome interrompue par une fenêtre d’extension bloquant le contrôle : aucune validation navigateur nouvelle de ce sous-cas. Période/caméra communes et convergence des lecteurs restent ouvertes. L’ADR 0016 fixe séparément le futur accès utilisateur, sans l’annoncer livré.

**Preuve code.** [ApiConnection](../../apps/console/src/api/ApiConnection.tsx#L14) charge `SpatialBrainWorkspace` par défaut ; la [bascule](../../apps/console/src/api/ApiConnection.tsx#L39) vers `ProgressiveBrainWorkspace` dépend de `map_transport=viewport`. Le [lecteur par défaut](../../apps/console/src/brain/SpatialBrainWorkspace.tsx#L67) recharge `graph.map` toutes les 60 secondes ; sa [période](../../apps/console/src/brain/SpatialBrainWorkspace.tsx#L148) est un état local `all`/nombre de jours et son historique est borné à cinq pages. Le progressif porte les intervalles exacts, reprises et sélections temporelles plus récentes. Les paramètres `time_from/time_to` d’un lien ne sont donc pas interprétés de façon équivalente dans ces deux entrées.

**Impact.** Un test vert sur la variante optionnelle ne valide pas ce que l’utilisateur ouvre par défaut. Corrections de droits, focus, filtres et reprise doivent être maintenues deux fois ; une ancienne URL peut suggérer une période que l’écran n’applique pas.

**Correction attendue.** Un état de navigation canonique partagé et une seule expérience cible ; promouvoir le lecteur progressif seulement après parité démontrée. Migrer les anciennes URLs, annoncer les paramètres non pris en charge, puis retirer le chemin doublon après recette. Conserver carte/corpus/Chronique/preuve/domaine/période/caméra lors des reprises.

### F04 — P1 : scènes bornées, mais verrou global et travail global

**Preuve code.** [GraphService](../../services/rust-core/src/graph.rs#L16) partage un mutex de cache. [Lecture de scène](../../services/rust-core/src/graph_scene.rs#L642) : verrou acquis avant préparation de projection, transaction, empreinte des droits, lecture de l’index documentaire et assemblage ; gardé jusqu’au commit. [Construction de scène](../../services/rust-core/src/graph_scene.rs#L350) : regroupement des points globaux avant filtrage de fenêtre. [Transactions](../../services/rust-core/src/graph_read.rs#L167) : verrou partagé sur les sources du domaine ; [révision](../../services/rust-core/src/sql/graph_scene_revision.sql) recalculée depuis les droits.

**Impact.** Les lectures de domaines/utilisateurs distincts attendent le même verrou ; un travail froid peut retarder les autres. La limite 24 glyphes / 120 tracés / 64 Kio protège le transport et le rendu, pas le coût de préparation. Les contrôles de droits sont utiles et ne doivent pas être supprimés au nom de la vitesse. L’impact de contention identifié est structurel ; aucun nouveau débit n’a été mesuré dans cet audit.

**Correction attendue.** Préparations mutualisées par version/périmètre, concurrence bornée, verrou de cache court ; index spatial/multi-échelles préconstruit et requêtes de voisinage ciblées. Introduire une révision d’autorisations transactionnelle seulement si tous ses écrivains sont couverts, avec les mêmes garanties anti-fuite. Mesurer séparément attente, SQL, préparation, transport et rendu.

### F05 — P1 : coût de publication et première lecture amplifié par les copies complètes

**Preuve code.** [Publication](../../services/rust-core/src/publication.rs#L168) recharge l’état précédent, applique les changements et prépare un snapshot complet. [Projection de lecture](../../services/rust-core/src/graph_read.rs#L40) : chargement du snapshot publié puis matérialisation de tous les concepts, sources et relations à la première lecture d’une version absente. [Migration 0026](../../services/core/migrations/versions/0026_graph_read_projection.py#L21) conserve corps JSON et texte de recherche par version. Les snapshots Terminus, le journal/manifeste SQL et les projections SQL ont des rôles distincts ; les mécanismes de préparation/activation sont déjà documentés.

**Impact.** Pagination des échanges et lectures chaudes rapides ne suppriment pas le coût en mémoire, écritures, historique et reconstruction. Un nouvel utilisateur ou une nouvelle version peut payer un travail absent du benchmark chaud. Les échecs froid/mémoire du rapport 10 000 sont cohérents avec ce risque, sans établir à eux seuls sa cause unique.

**Correction attendue.** Préparer les index requis avant d’annoncer la visibilité, rendre observable l’état « en préparation », matérialiser les deltas et définir les projections reconstructibles. Conserver l’historique logique ; ne pas supprimer de versions utilisateur pour améliorer artificiellement une mesure. Tester publication interrompue, reprise, restauration coordonnée et croissance sur plusieurs versions.

### F06 — P1 : les positions ne sont stables que pour certaines évolutions

**Preuve code.** [Placement serveur](../../services/rust-core/src/graph_scene.rs#L172) dépend du nombre et du rang des familles, puis de l’ordre et du nombre des membres. L’ajout d’une famille ou d’un membre peut déplacer des éléments inchangés. Les recettes acquises vérifient surtout l’édition des mêmes identités/topologies, pas cette invariance générale.

**Impact.** Les repères se déplacent au moment même où l’utilisateur compare des changements. Cela contredit l’expérience Google Maps demandée, même si la caméra reste au même zoom.

**Correction attendue.** Identité de layout et ancres persistantes/versionnées, ajout local, retrait laissant un repère historique si nécessaire ; recalcul global seulement sur demande explicite. Définir un seuil de déplacement et le tester sur ajouts, retraits, scissions et changement de famille, dans chaque disposition offerte.

### F07 — P1 : le cycle import → revue → publication n’aboutit pas dans la console

**Suivi du6 octobre03:47 UTC :** trois défauts de revue reproduits/corrigés (corps restant après refus de preuve/historique, comparaison ancienne pendant actualisation). Sélection URL/reconnexion et lecture détail/comparaison/détail ajoutées, avec garde sur état/révision et historique plus récent. Console394 tests puis17 finaux ciblés,35 retours de session et4/4 contrôles HTTP natifs ; quatre scénarios Chrome de revue attendent toujours une exécution. Pas de snapshot transactionnel ni confirmation humaine intégrée : AUD-04/05 restent ouverts. Le workflow HTTP AUD-03 inclut désormais ce lecteur, mais reste non exécuté sur GitHub et sans navigateur.

**Suivi du6 octobre02:54 UTC :** lecture personnelle des imports de texte, état par fichier, collection et source intégrale désormais codés dans la console/gateway. 155 tests gateway, 377 tests console puis14 ciblés finaux et5/5 contrôles HTTP natifs réussis ; quatre scénarios Chrome restent à exercer, aucun nouveau parcours validé. La création/traitement/reprise et la décision/publication frontend restent absents ; ce suivi n’est pas celui du pipeline OKF. Le constat de cycle incomplet et AUD-05 restent ouverts. Les preuves ci-dessous décrivent l’état initial de l’audit.

**Preuve code.** [ReviewCommand](../../apps/console/src/api/ReviewCommand.tsx#L58) propose reporter/demander des changements/rejeter et explique qu’il ne signe ni n’exécute la décision. [GovernanceWorkspace](../../apps/console/src/api/GovernanceWorkspace.tsx) et [opérations du client](../../apps/console/src/api/operations.ts) n’exposent pas le cycle complet d’import, approbation et publication. Les scripts d’ingestion ont réalisé le corpus privé ; ce succès ne transforme pas ce script en parcours utilisateur.

**Impact.** Le lecteur peut constater un changement mais l’owner ne peut pas fermer la boucle depuis le produit. L’expérience reste dépendante d’un opérateur technique. Les relations documentaires navigables restent distinctes des relations validées, distinction correcte à préserver.

**Correction attendue.** Un parcours par lot : progression, erreurs/reprise, aperçu et preuves, décision authentifiée liée à la révision, publication, confirmation de visibilité et lien vers la Chronique. Brancher un composant de confirmation humaine de confiance ; ne jamais confier le pouvoir de signature à l’agent. Réessai après réponse perdue sans doublon, conflit de révision et rôle insuffisant font partie de la recette.

### F08 — P2, bloquant avant élargissement : apprentissage et risque restent un sous-ensemble

**Preuve code.** [Validation de proposition](../../services/rust-core/src/proposals.rs#L432) renseigne systématiquement `owner_low_risk_v1`, `risk: low` et `verbatim_v1`. [Concept](../../services/rust-core/src/snapshot.rs#L28) comporte identité, titre, corps, maturité, sources et liens ; pas de résumé canonique dédié. [LinkKind/Link](../../services/rust-core/src/knowledge.rs#L65) représentent structurel/associatif, cible et poids ; pas tout le modèle sémantique et de gouvernance original.

**Impact.** Fidélité d’une citation et absence de cycle ne prouvent ni pertinence d’une extraction, ni absence de doublon/contradiction, ni faible risque métier. Cela ne signifie pas que le backend auto-approuve : la frontière humaine existe. Il faut empêcher que le label bas risque soit pris pour une évaluation générale.

**Correction attendue.** Rendre la politique limitée explicite dans le produit ; ajouter résumés sourcés et épreuves, propositions d’enrichissement/fusion distinctes, sémantique des relations, risque motivé et règles de reviewers. La conversion des références OKF en relations demeure une revue, jamais une conversion en masse par défaut.

### F09 — P2 structurant : le cœur biomimétique est encore à construire

**Preuve code.** [Workflows](../../services/workflows/README.md) et [agents](../../packages/agents/README.md) restent des composants planifiés ; les workers de fichiers existants ne sont pas un moteur de sommeil. Les changements de concepts/retraits ne fournissent pas activations, archive/réactivation ou cycles candidats durables.

**Impact.** Le différenciateur central n’est pas livré par la carte. Des KPI de publications sont utiles, mais ne doivent pas devenir des KPI fictifs de mémoire, de renforcement automatique ou de consolidation.

**Correction attendue.** BRN-05 → BRN-06 → BRN-07, chacun avec événements réels, politiques versionnées, droits, reprise, explication dans le frontend et tests métier. Épreuves et budgets précèdent les changements automatiques. Les liens structurels ne subissent pas de decay d’usage.

### F10 — P1 : les preuves automatiques ne ferment pas les parcours connectés

**Suivi du6 octobre02:57 UTC :** un workflow API de transport HTTP est ajouté localement (builds natif/API, fixture synthétique gouvernée unique, puis recettes session/imports), avec résultat séparé de tout navigateur et sans upload de runtime. Syntaxes et synthèse de rapport vérifiées ; aucun job GitHub exécuté, aucune nouvelle recette Chrome. La CI navigateur API et les régressions dédiées scènes/fenêtres restent ouvertes : ce raccord partiel ne clôture pas AUD-03. Le constat suivant décrit le pipeline au moment de l’audit.

**Preuve code.** [CI frontend](../../.github/workflows/frontend-mock.yml) construit/teste le mock et lance les parcours navigateur sans backend ; [configuration navigateur](../../apps/console/playwright.config.ts) démarre le serveur Vite du mock. La [CI native](../../.github/workflows/rust.yml) couvre déjà des intégrations réelles via `verify_rust_http.py`, **y compris le journal de publications appelé indirectement**. En revanche, les recettes dédiées de projection/fenêtres/recherche/différences ciblées/textes longs ne sont pas toutes raccordées à cet agrégateur ; les nouvelles scènes ne bénéficient pas d’une recette navigateur API en CI.

**Impact.** Tests unitaires et contrats verts peuvent coexister avec un trajet utilisateur absent ou divergent. Les rapports manuels ne protègent pas automatiquement les prochains changements.

**Correction attendue.** Pipeline API + navigateur sur données synthétiques isolées ; inventaire explicite des scripts réellement exécutés, matrice capability→scénario→résultat, build API, contrôle de couverture des contrats et conservation des traces sans données privées. Garder les tests rapides et ne réserver les scénarios lourds qu’aux changements pertinents.

### F11 — P2 : architecture et documentation n’ont plus une vérité courante unique

Le dossier cible Python/TypeScript et une expérience de stockage à trancher. Le code ajoute un backend Rust substantiel, Terminus, un modèle de lecture SQL et plusieurs lecteurs frontend. Ces évolutions peuvent être justifiées ; elles ne prouvent pas à elles seules l’abandon des frontières initiales. Des pages continuent à dire « pas de frontend » ou à présenter le seul backend Python comme l’autorité courante.

**Correction attendue.** Documenter une seule carte des responsabilités, une cible de runtime décidée, le maintien ou gel de la référence Python, le format canonique et les règles de compatibilité. La mise à jour documentaire de cet audit corrige les entrées de lecture ; elle ne décide pas silencieusement une migration de production.

## 6. Architecture recommandée et décisions à acter

### Conserver les garanties, simplifier les chemins

Le noyau autorise les décisions et publie ; les workers préparent des candidats ; les clients consomment les mêmes contrats ; le frontend ne possède pas de privilège de publication implicite. Le journal de décisions et les preuves sont durables. Les projections de recherche, de carte et les caches sont dérivés, versionnés et reconstructibles. Une projection préparée n’est pas publiée avant l’activation cohérente de son manifeste.

| Décision | Recommandation de l’audit | Condition de validation |
|---|---|---|
| Runtime produit Python ou Rust | Éviter deux implémentations métier évoluant indéfiniment. Conserver Rust comme candidat du frontend actuel ; limiter Python à la référence/compatibilité tant que l’ADR de cible n’est pas accepté. Pas de réécriture immédiate | Parité des invariants métier et tests de reprise ; coût de maintenance et exploitation documenté |
| Rôle de Terminus | Le juger sur publication, froid, mémoire, historique et restauration. Garder SQL journal/manifeste comme frontière d’autorité actuelle. Si les portes échouent, comparer un remplacement **derrière l’adaptateur** | Même S20/S100/M20/M100, mêmes données, budgets et droits ; aucun gain fondé sur une densité réduite |
| Lecteur frontend de référence | Faire converger vers le progressif, après parité. Garder un seul état de navigation et des composants métier partagés | Liens existants, Chronique, corpus privé, erreurs/reprise, clavier/mobile et performances passent |
| Authentification produit | Identité standard et session navigateur ; confirmation humaine sensible distincte de l’agent | Login/refresh/logout/reprise démontrés, secrets hors navigateur et Git, permissions fraîches |
| Modèle de savoir | Source immuable + concept réutilisable + résumé vérifié + relations motivées ; corps intégral disponible séparément | Une question utilise un concept long sans perdre la provenance ; nouveaux résumés soumis à revue/fidélité |
| Orchestration | Un exécuteur durable avec idempotence, checkpoint, budget et annulation ; évaluer Temporal prévu initialement contre une solution plus légère avant adoption | Test interruption/reprise/échec de publication ; ne pas prendre un cron ou un réessai HTTP pour une consolidation durable |

**Points produit à trancher** : le premier pilote est-il d’abord une tranche « lire, comprendre, revoir et publier » ou doit-il inclure le premier sommeil mesuré ? Recommandation : livrer la première tranche comme jalon utilisable, conserver le sommeil comme porte distincte du pilote biomimétique, sans le déclarer hors objectif. Si un IdP et un groupe pilote sont déjà choisis, les utiliser ; sinon préparer un raccord standard et sélectionner le domaine/owner de recette avant de promettre une qualité métier. Les objectifs 10 000, confidentialité OKF et BrainMap sont déjà actés et ne sont pas remis en question.

## 7. Backlog restant, ordonné et testable

Chaque ligne ci-dessous est **ouverte** au moment de l’audit. Les dépendances expriment un ordre de livraison, pas l’interdiction de préparer les contrats ou tests en parallèle. Taille indicative S/M/L = local / plusieurs composants / chantier ; ce n’est pas une estimation calendaire. Les identifiants AUD servent à suivre les écarts sans remplacer CF ou BRN.

Suivi de réalisation ultérieur : **AUD-02 corrigé dans le périmètre extractif borné** le 5 octobre ; les 28 autres actions restent ouvertes. Les preuves et limites priment sur ce décompte. AUD-04 : perte de sélection au retour BrainMap corrigée dans le code, tests de composants réussis, recette Chrome en attente (blocage d’extension). AUD-01/05 : [contrat d’architecture fixé](../architecture/decisions/0016-browser-session-and-human-confirmation.md), protocole OIDC, session/proxy HTTP et configuration locale éprouvés en isolation ; adaptateur frontend optionnel et relais local codés ; chaîne HTTP native synthétique éprouvée (8/8 contrôles), Chrome, fournisseur réel, renewal, confirmation et topologie de production restants.

### Lot A — Corriger immédiatement les ruptures (P1)

| ID / taille | Action | Dépendance | Preuve de fermeture |
|---|---|---|---|
| AUD-01 / M | Accès produit, session et démarrage local explicites (F02) | ADR identité | Chrome vierge → connexion → domaine ; refresh, expiration, déconnexion, retour au même contexte ; aucun JWT à copier dans l’usage nominal |
| AUD-02 / M | Corriger l’exclusion des corps longs et les faux tickets de lacune (F01) | Contrat d’unité sourcée | Concepts courts/200 000 caractères, réponse au milieu/fin, budget petit, Unicode et droits ; résultat cohérent aussi en conversation frontend |
| AUD-03 / M | Ajouter le pipeline connecté et les régressions des constats (F10) | Fixture isolée, contrats existants | Build API ; source → publication → réponse/preuve ; graph.scene/map_nodes, longue fiche, ancienne URL, erreurs/reprise ; rapport des scénarios exécutés |
| AUD-04 / M | Unifier état URL, période, caméra, sélection et récupération (F03) | Contrat UX commun | Même lien reproduit la même vue ; retour/refresh/reconnexion ; invalidation des données refusées ; mock/API clairement identifiés |
| AUD-05 / M | Achever import/revue/publication dans la console (F07) | AUD-01 ; confirmation humaine | Lot synthétique suivi, exception corrigée, décision, publication visible, réponse perdue/reprise sans doublon et conflit de révision traités |

**Première livraison souhaitée :** un utilisateur autonome peut entrer, trouver un savoir long, le lire, obtenir une réponse correctement sourcée et un owner peut publier une correction depuis l’interface. Ne pas attendre tous les mécanismes biomimétiques pour fermer ce parcours.

### Lot B — Qualifier réellement BrainMap et le Step 1 (P1, BRN-01–04/08)

| ID / taille | Action | Dépendance | Preuve de fermeture |
|---|---|---|---|
| AUD-06 / L | Borner calculs/lectures et supprimer le verrou global de longue durée (F04) | ADR projection/ACL ; AUD-03 | Coût de zoom local mesuré ; domaine lent n’immobilise pas un autre ; droits frais, annulations, cinq sessions et mémoire respectent le protocole |
| AUD-07 / L | Préparer les lectures avant visibilité et réduire les copies par version (F05) | ADR stockage | Nouvelle version à froid, redémarrage avec projection, publication interrompue/reprise ; historique intact et budgets de mémoire respectés |
| AUD-08 / M | Ancres/layouts stables lors d’ajouts et retraits (F06) | Contrat de placement | Test de déplacement des identités inchangées ; ajout d’une famille ; zoom et repères conservés dans les dispositions maintenues |
| AUD-09 / M | Signaux temporels des agrégats et macro-liens | AUD-04/06 ; couverture journal | Haut niveau → détail réconcilie les mêmes objets et la même période ; pas de double comptage, zéro différent de non couvert, code couleur facultatif |
| AUD-10 / M | Promouvoir le lecteur unique et retirer le doublon | AUD-04/06/08/09 | Parité privée/synthétique, catalogue, lecture intégrale, Chronique, erreurs, clavier, mobile, clair/sombre ; plus de branche spéciale requise dans l’URL |
| AUD-11 / L | Compléter qualification S20/S100/M20/M100 et croissance de versions | AUD-06/07/10 | Identités/relations/sources/journal rapprochés ; froid, chaud, p50/p95, rendu, mémoire de tous les processus, concurrence et santé moteur ; budgets initiaux conservés |
| AUD-12 / M | Qualifier accessibilité et reprise de tous les parcours exposés | AUD-03/05/10 | Écran 320/390, clavier dont Entrée, lecteur d’écran, gestes tactiles ; vide/erreur/session/droits ; dénominateur et exclusions explicites |

Les S20/S100 déjà publiés sont réutilisés. M20/M100 sont les distributions **multidomaines 9 000 / 900 / 100**, pas une augmentation artificielle du corpus OKF. Les mesures historiques chaudes n’exemptent pas AUD-11. Les objectifs gelés restent notamment première vue utilisable ≤2 s, interactions chaudes ≤1 s, Rust ≤1 Gio, conteneurs synthétiques ≤4 Gio, delta navigateur ≤512 Mio, selon la méthode complète du [protocole](brain-scale-10000.fr.md).

### Lot C — Transformer le corpus en savoir exploitable (P2, CF-017–030)

| ID / taille | Action | Dépendance | Preuve de fermeture |
|---|---|---|---|
| AUD-13 / L | Extraction guidée par l’existant, résumé canonique, fidélité et provenance | AUD-02/05 | Source → candidats nouveau/enrichissement/contradiction ; exactitude vérifiée ; refus d’un résumé non soutenu ; historique du modèle/prompt si utilisé |
| AUD-14 / M | Revue des relations et enrichissement sémantique du modèle | AUD-05/13 | Aperçu de direction/type/effet ; décision traçable ; référence documentaire restant référence tant que non approuvée ; absence de faux poids |
| AUD-15 / L | Retrieval sémantique et expansion du graphe sous budget en tokens | AUD-02/13/14 | Questions métier hors correspondance lexicale ; contrôle du niveau de détail ; citations exactes, filtrage avant assemblage, abstention motivée |
| AUD-16 / M | Banque de questions gouvernée et mesure de qualité | Peut commencer dès AUD-02 | Questions annotées, sous-ensemble tenu à l’écart, sources/réponses attendues, baseline ; qualité, fraîcheur et coût mesurés sans score inventé |
| AUD-17 / M | Gouvernance par risque et file owner exploitable | AUD-05 ; politique explicite | Bas/medium/high, agent incapable de s’accorder une décision humaine, reviewers/quorum/veto selon politique ; décision périmée refusée, motifs et effets visibles |
| AUD-18 / M | Brief owner et administration domaines/budgets | AUD-01/05/16 | Changé / à décider / lacunes / limites ; liens vers preuves et actions ; paramètres réellement appliqués ; données personnelles non élargies implicitement |

Aucun appel à un fournisseur avec l’OKF ne découle de ce backlog. Les tests utilisent des fixtures synthétiques ; un traitement externe du corpus exigerait une instruction distincte. La provenance par attribut peut être introduite progressivement, mais son absence doit rester explicite.

### Lot D — Livrer le différenciateur biomimétique (P2, BRN-05–07)

| ID / taille | Action | Dépendance | Preuve de fermeture |
|---|---|---|---|
| AUD-19 / M | Activations et mémoire active dérivée | AUD-16 ; contrats d’événements | Même concept entre/sort de la sélection sans recréation ni changement de maturité ; signaux permis, dédoublonnés et expliqués ; tendance à couverture connue |
| AUD-20 / M | Renforcement/decay associatifs gouvernés | AUD-14/19 | Avant/après, cause, bornes/plancher, politique versionnée ; aucune décroissance structurelle et aucun pouce bas transformé automatiquement en vérité |
| AUD-21 / M | Archivage et réactivation gouvernés | AUD-05/17 | Impact et décision ; identité/histoire conservées ; archive absente de l’usage ordinaire mais consultable ; consultation sans réactivation silencieuse |
| AUD-22 / L | Premier sommeil durable, limité à des effets construits | AUD-16/19/21 ; ADR orchestration | Phases, dette motivée, budget, annulation/reprise, candidat et épreuves ; service publié inchangé pendant préparation ; owner voit/publie les effets |
| AUD-23 / M | Releases candidates, rollback de lot/release et vérification post-bascule | AUD-17/22 | Rejeu des changements intervenus, régression bloquante, bascule cohérente et restauration sans effacer décisions/provenance |

Les premiers contrats de mémoire, archive et sommeil peuvent être conçus avant le lot C complet. Leurs mutations automatiques et annonces de qualité restent conditionnées aux preuves nécessaires. Les KPI frontend doivent être construits avec chaque mécanisme, pas ajoutés comme habillage après coup.

### Lot E — Pilote durable puis long terme

| ID / horizon | Action | Condition de sortie |
|---|---|---|
| AUD-24 / P2 | ADR runtime/persistence, observabilité, budgets et restauration | Un runtime cible ; frontières/dépendances connues ; traces expurgées, métriques de bout en bout, restauration SQL/Terminus/source/identité cohérente testée ; projections reconstructibles |
| AUD-25 / P2 | Client externe et harness réellement validés | Login externe, découverte, contexte/réponse, preuves, feedback et reprise ; impossibilité pour l’agent de s’accorder une approbation |
| AUD-26 / P2 | Gouvernance des données et export | Export lisible/rejouable, contrats de rétention, provenance et droits ; corpus privé absent des commits, bundles et logs ; séparation des tenants éprouvée |
| AUD-27 / P3 | Observer/connecteurs puis contributions d’experts | Un connecteur choisi, liste des sources autorisées, permissions héritées, agrégats/pointeurs et consentement ; production de candidats uniquement |
| AUD-28 / P3 | Multi-domaines avancé, temporalité et restructuration | Besoin métier prouvé ; transitions scission/fusion et références distantes gouvernées ; pas de fuite entre domaines ; aucune confusion journal historique/topologie historique |
| AUD-29 / P3 | Médias, multilingue, avatars, fédération et industrialisation large | Pilote évalué ; demande et budget définis ; ne pas retarder les parcours de base pour ces extensions |

Les Représentations ne sont pas ouvertes dans ces lots. Le scénario spécifique de retrait de Bob demeure suspendu à son autorisation antérieure ; aucune nouvelle tentative ni substitution n’est incluse dans cet audit.

### Portes de livraison

1. **Parcours utilisable** : AUD-01–05 et les corrections qui empêchent effectivement leur usage ; preuve Chrome pour collaborateur, owner et responsable corpus.
2. **Step 1 à 10 000 qualifié** : AUD-06–12, corpus privé préservé, import connecté et limitations explicites. La taille du graphe seule ne suffit pas.
3. **Savoir compétent** : AUD-13–18, qualité mesurée sur questions métier ; aucune promesse de raisonnement issue du seul nombre de concepts.
4. **Pilote biomimétique** : AUD-19–26 avec événements observables et exploitation adaptée. Une dette fonctionnelle majeure ne disparaît pas parce qu’une fenêtre autonome se termine.

## 8. Vérifications de cet audit

Résultats du 5 octobre vers 17:46–17:55 UTC, journaux locaux ignorés dans `.runtime/brain/audit-20261005/`. Ce dossier ne contient pas le corpus métier. Les nombres suivants couvrent des ensembles différents ; ils ne sont pas convertis en pourcentage de complétude.

| Commande / ensemble | Résultat obtenu | Portée |
|---|---|---|
| `npm run test --prefix apps/console` | **307 tests / 41 fichiers réussis** | Modèle et composants de console, pas une recette connectée complète |
| `cargo test -p cortex-rust-core --lib --locked --offline` avec environnement Rust local | **67 réussis** | Bibliothèque native ; pas une nouvelle intégration PostgreSQL/Terminus réelle |
| `.venv/bin/python -m pytest -q` sur les 9 fichiers listés ci-dessous | **163 réussis**, 2 avertissements de dépréciation | Contrats, préparation/ingestion/reconciliation simulées et qualification de l’horloge ; aucune publication privée |
| `npm test` à la racine | **11 réussis** | Contrats et adaptateur harness |
| `npm run typecheck` | Réussi | TypeScript racine |
| `VITE_DATA_MODE=api npm run build --prefix apps/console -- --outDir ../../.runtime/brain/audit-20261005/build-api` | Réussi, typage et Vite | Build API isolé ; ne remplace pas l’application servie |
| `npm run contracts:check` | **120 contrats TypeScript vérifiés** | Cohérence des artefacts générés |
| Exports `--check` : `export_contracts.py`, `export_rust_contracts.py`, `export_frontend_reference.py`, `export_interactions.py` | **87 schémas, 14 extensions natives, 79 descriptions HTTP/MCP, 79 interactions HTTP / 95 outils MCP de référence** | Inventaires de contrat, pas autant de parcours testés |
| `cargo fmt --all --check` ; `.venv/bin/ruff check .` | Réussis | Format/style, pas correction métier |
| Sonde HTTP `127.0.0.1:5175` | Échec de connexion / sortie 7, HTTP 000 | Pas de nouveau scénario Chrome validé dans cet audit |

Fichiers Python : `tests/test_contracts.py`, `tests/test_native_frontend_bundle.py`, `tests/test_brain_map_index.py`, `tests/test_okf_preparation.py`, `tests/test_okf_ingestion.py`, `tests/test_okf_ingestion_transport.py`, `tests/test_okf_reconciliation.py`, `tests/test_brain_scale_qualification.py`, `tests/test_qualification_clock.py`.

**Historique conservé, non rejoué :** P01–P16 = 8 validés et 8 partiels ; les 50 parcours antérieurs (45 validés, 4 partiels, 1 bloqué) sont un autre ensemble. Rapprochement natif S100 : 10 000 concepts/sources, 100 000 relations, 202 publications. Les budgets froid/mémoire et M20/M100 restent ouverts. Ni le présent audit ni les tests relancés ne certifient le déploiement, la qualité du corpus, toutes les ACL concurrentes, l’accessibilité complète ou la capacité de production.

## 9. Prochaine action recommandée

Commencer par **AUD-02 et sa régression connectée**, pendant que le contrat d’accès/confirmation de **AUD-01/AUD-05** est fixé. C’est le chemin le plus court pour vérifier que le savoir déjà publié sert réellement l’utilisateur. Ensuite livrer l’accès et le cycle owner, faire converger BrainMap, qualifier le stockage/les lectures, puis ouvrir les mécanismes de mémoire et de sommeil sur cette base.

Cet audit met à jour le plan ; il ne marque aucun des correctifs AUD comme réalisé et ne clôture pas l’UI/UX.
