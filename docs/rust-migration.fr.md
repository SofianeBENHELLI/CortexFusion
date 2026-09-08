# Migration Rust et TerminusDB — état vérifiable

Cible autorisée : backend Rust utilisant TerminusDB, conservation des contrats HTTP/MCP et du frontend. Un vérificateur indépendant audite les changements et contre-vérifie les correctifs. La migration n’est pas considérée complète tant que des parcours restent exécutés par Python.

## Premier lot : fondations compilées

Le workspace Cargo et services/rust-core utilisent une toolchain1.98.1 et Cargo.lock. Le code comprend une première validation Unicode/DAG, des types de références et relations, un encodage de compatibilité des digests Python et un transport TerminusDB privé borné. Un serveur candidat local sert désormais trois premières routes natives ; le reste du backend reste à migrer.

Le contrôle de plages utilise les points de code Unicode, pas les octets UTF-8 ni les unités UTF-16. La détection de cycles est itérative. Les références vides et relations primaires associatives sont rejetées à la désérialisation. Les contraintes de domaine complètes (preuves, cibles et parent primaire unique) restent à porter.

L’encodage des digests reproduit le format historique Python, distinct de RFC8785/JCS. Des vecteurs figés produits par Python couvrent Unicode, exposants, zéro négatif et grands entiers ; cette compatibilité doit rester testée avant toute signature de confirmation Rust. La revue indépendante peut ajouter des contre-exemples.

L’adaptateur TerminusDB refuse HTTP distant, credentials dans l’URL, redirections et proxy implicite. Chaque appel a un timeout ; requêtes et réponses JSON sont bornées. Une mutation suivie d’une erreur5xx, d’une rupture transport ou d’une réponse2xx illisible est incertaine et ne doit pas être relancée aveuglément. Les paramètres documentaires sont explicites. L’adaptateur de snapshot devra encore exiger le commit retourné et maintenir le manifeste publié.

## Inventaire de migration

| Périmètre | État actuel |
|---|---|
| 79 opérations HTTP / 95 outils MCP | Référence Python conservée ; candidat Rust : GET /health, GET /v1/me et GET /v1/domains/{domain}/version, aucun outil MCP natif |
| Graphe TerminusDB | Prototype réel indépendant validé, pas encore stockage servi par les parcours applicatifs |
| Unicode, DAG, transport moteur, encodage JSON | Premières fonctions Rust compilées et testées ; parité métier complète non établie |
| PostgreSQL | Reste le backend servi et la référence des contrats pendant la transition |
| Frontend | Inchangé |

## Vérification

Exécuter `cargo test --workspace --locked`, `cargo clippy --workspace --all-targets --locked -- -D warnings` et `cargo fmt --all --check`. Le workflow Rust réalise ces vérifications séparément. Le rapport indépendant est conservé dans les livrables locaux ; il précise ce qui est relu statiquement et ce qui est réellement exécuté.

Les étapes suivantes portent la publication et les lectures derrière un manifeste fixé à un commit TerminusDB, puis étendent progressivement la parité HTTP/MCP. Aucun gain de performance ni remplacement complet du backend n’est revendiqué à ce stade.


### Boucle de revue indépendante du premier lot

Le vérificateur a fait corriger trois points avant intégration : paramètres documentaires du moteur, classement des issues de mutation incertaines, validation obligatoire après désérialisation. Neuf tests Rust passent après ces correctifs. Sa campagne séparée de100018 vecteurs JSON a ensuite trouvé28 divergences dues au départage des représentations décimales ; passage à Ryu, même oracle et même seed : zéro divergence. Les exemples fautifs deviennent des régressions permanentes. Ce résultat ne prouve pas encore la signature de confirmations en bout en bout. 

## Serveur candidat et identité

Le binaire `cortex-rust-core` utilise Axum et SQLx, sans exécuter Python. Il exige `CORTEX_RUST_DATABASE_URL`, `CORTEX_JWT_PUBLIC_KEY_FILE`, `CORTEX_JWT_ISSUER`, `CORTEX_JWT_AUDIENCE` et écoute uniquement en loopback (`CORTEX_RUST_BIND`, défaut127.0.0.1:8010). Les rôles PostgreSQL superuser, BYPASSRLS ou propriétaires de tables applicatives sont refusés au démarrage. La clé publique PEM est prise en charge ; JWKS et rotation restent à porter.

Les rôles sont relus dans les appartenances du domaine. Une déclaration de rôle dans le JWT ne confère aucun droit. Chaque transaction fixe localement le tenant ; les lectures de version utilisent REPEATABLE READ. `/v1/me` annonce uniquement `inspect` et aucun fournisseur d’extraction dans ce candidat. Les opérations non portées renvoient explicitement501/MIGRATION_NOT_IMPLEMENTED : il ne doit pas remplacer le service existant. La forme détaillée des erreurs de validation doit encore rejoindre le contrat historique.

La contre-vérification JWT a trouvé des écarts de coercition dans la bibliothèque Rust. Les claims sont désormais validés explicitement après la signatureRS256 : issuer string, audience homogène, expiration stricte, dates tronquées comme Python, `nbf` et `jti` présents correctement typés. Les18cas initiaux indépendants ne divergent plus. Les chaînes NumericDate exotiques (underscores, chiffres nonASCII, entiers au-delà de i128) restent refusées par le candidat même lorsque Python les accepte ; ce sont des restrictions de compatibilité connues, pas une parité exhaustive revendiquée.

`scripts/verify_rust_http.py` génère ses propres identités synthétiques et démarre le vrai binaire avec PostgreSQL. Il contrôle les JWT invalides, les rôles serveur, l’isolation tenant/domaine, la révocation et le refus des mutations non migrées. Aucun appel modèle. Le workflowRust exécute ce scénario sur une base neuve après migration, en plus des10testsRust, du formatage et deClippy.

## Snapshots typés TerminusDB en cours de validation

Le moduleRust `snapshot` représente les concepts comme classesTerminusDB, les preuves comme sous-documents ordonnés et les relations comme références vers les concepts. Il prépare une base privée neuve par snapshot, exige un identifiant de commit, relit ce commit et contrôle le digest et le nombre de concepts. Les requêtes suivantes utilisent exclusivement le commit immuable ; déplacer `main` ne doit jamais changer le résultat. Cette première stratégie consomme davantage de bases et de stockage ; son optimisation en branches par domaine reste à réaliser.

La préparation ne publie rien. Son descripteur ne doit jamais venir d’un client et n’inclut pas encore le tenant/domaine : il doit être stocké et résolu depuis un manifesteSQL protégé. La lecture brute du module ne filtre pas les ACL. Une erreur incertaine ne doit pas entraîner de relance automatique : réservation durable et suivi des snapshots orphelins restent à intégrer avant d’exposer une commande de publication. Le candidat ne sert pas encore ces snapshots aux utilisateurs.

Les tests locaux vérifient la conversion typée et les descripteurs. Le test moteur réel est explicitement ignoré hors environnementTerminusDB ; le workflowCI le lance avec `--ignored` sur le moteur isolé épinglé. Le résultatCI doit être consulté avant de considérer l’intégration moteur validée.

## Manifeste et lecture applicative — lot en vérification

MigrationSQL0019 : réservations de préparation et manifestes immuables, clés tenant/domaine/version et RLS forcée. La commande interne `cortex-rust-core --import-published <domainUUID>` exige l’identitéJWT via `CORTEX_MIGRATION_BEARER` et le tenant via `CORTEX_MIGRATION_TENANT`, ainsi que les configurations habituelles du candidat et du moteur. Elle exige le rôleowner et l’accès actuel à toutes les preuves. Elle copie uniquement la projection déjà publiée ; elle ne constitue pas une approbation ni une nouvelle publication. Ne pas lancer sur un corpus d’entreprise non autorisé.

La réservation est validée enSQL avant toute mutationTerminus ; sonUUID détermine le nom de la base de staging. Une préparation interrompue reste réservée et n’est pas automatiquement relancée. Une reprise réussie relit les droits. Une finalisation verrouille le domaine, l’appartenance et les preuves, recontrôle la version et l’expirationJWT, puis écrit le manifeste et l’étatready dans une transactionSQL. La réconciliation des préparations interrompues et le nettoyage contrôlé des orphelins restent à réaliser.

Les deux routesRust `GET /v1/domains/{domain}/concepts` et `GET /v1/domains/{domain}/concepts/{concept_id}` résolvent le manifeste de la version publiée, lisent son commitTerminus et relisent les droits après l’appel réseau. Elles masquent les concepts dont une preuve n’est plus accessible, ainsi que les relations vers les concepts masqués. Une version publiée sans manifeste renvoie503, sans repli implicite vers la projectionSQL. Cette cohabitation protège la cohérence mais n’est pas encore une bascule complète des écritures. Le détail des erreurs422, le reste des routes et MCP restent à porter.

La revue indépendante a déclenché trois corrections avant activation : accès aux preuves lors du rejeu, expirationJWT pendant les appels réseau et synchronisation de la finalisation avec les révocations/publications concurrentes. Les contre-tests dynamiques et le testHTTP+Terminus réel doivent confirmer ce lot.

Contre-vérificationR07–R09 : six scénarios indépendants passent avec le vrai binaireRust et PostgreSQL, moteurHTTP volontairement simulé pour imposer les courses. Source ou appartenance révoquée pendant staging, expiration pendant staging/lecture, perte de preuve avant rejeu et attente réelle du verrou domaine : aucun manifeste indu et aucune seconde mutation moteur au retry. Cette preuve de concurrence reste distincte du testTerminusDB réel. La suite historique complète passe après migration0019 (514Python et11Node).

## MCP natif — premier sous-ensemble

Le candidat utilise le SDK officielRust `rmcp3.2.0`, verrouillé dansCargo.lock. Le transportStreamableHTTP est sans session et vérifie l’identité sur chaque requête. Il annonce cinq outils natifs : `api_system_health`, `api_identity_read`, `api_domain_version`, `api_concepts_list`, `api_concepts_read`. Leurs schémas sont repris de l’inventaire historique. Les autres outils ne sont pas encore annoncés dans le candidatRust ; les95outils restent disponibles dans le servicePython existant.

Les appelsMCP invoquent en mémoire les routesRust, avec la même identitéHTTP et les mêmes services, sans délégation àPython. Les arguments ne peuvent ni fixer le tenant, ni déclarer un rôle, ni choisir une URL. Le candidatlocal refuse les origines navigateur et les hôtes horsloopback. Le corpsMCP est limité à64000octets et la réponse native à4Mo. Les clientsdistants et la configurationCORS restent à intégrer avant basculefrontend.

`scripts/verify_rust_mcp.py` compare schémas et réponsesHTTP/MCP, contrôle identité, arguments superflus, Host etOrigin. Le testgrapheCI compare aussi les résultatsMCP/HTTP pourowner/viewer. SantéHTTP a été alignée sur les trois champs du contrat historique : status, version, mode. Les descriptions annoncent explicitement le candidat de migration et ses limites.

Source du transport : [SDKMCP officielRust](https://github.com/modelcontextprotocol/rust-sdk).

## Publication ciblée native et confirmations — lot en validation

Le candidat ajoute `POST /v1/domains/{domain}/proposals/{proposal_id}/publish` et son outil `api_proposals_publish`. Le corps conserve `expected_published_version`. La proposition doit déjà être acceptée ; accepter et publier restent deux décisions distinctes. Une confirmationRS256 délivrée par un hôte de confiance est obligatoire, liée à l’identité, au tenant, à l’action et aux arguments exacts. Le candidat vérifie la clé publique via `CORTEX_CONFIRMATION_PUBLIC_KEY_FILE` ; il ne possède aucune clé privée de confirmation. HTTP et MCP partagent une consommation unique enSQL grâce à une preuve interne non forgeable par un en-tête.

La publication part du commitTerminus de la version publiée (ou du graphe vide pourversion0), revalide les preuves verbatim et les contraintes du graphe, prépare un nouveau snapshot puis active son manifeste. Manifeste, projectionSQL de compatibilité, événement de publication, outbox, statut de proposition et numéro de version sont validés ensemble dans une transactionSQL. TerminusDB ne participe pas à cette transaction : une préparation moteur seule ne rend jamais la version visible. La projectionSQL est maintenue pour les parcours encorePython ; les lectures natives utilisentTerminusDB.

La migration0020 conserve le digest, le nombre de concepts, la cible et la version de base attendus avant l’appel moteur. Après une réponse perdue, une nouvelle commande confirmée inspecte uniquement la base réservée et son commit immuable. Si le contenu est complet et identique, elle finalise après recontrôle des droits/version ; elle n’émet aucune nouvelle mutation moteur. Si la base est absente, incomplète ou différente, elle renvoie503. **Une nouvelle tentative sur base fraîche pour ces cas incomplets reste à réaliser** ; aucune reprise universelle n’est revendiquée.

Le rejeu d’une cible déjà publiée renvoie `changed=false`, même lorsqu’une autre proposition attend. Les confirmations consommées ne sont pas réutilisables après un échec : inspecter l’état puis obtenir une nouvelle décision signée. Les opérations personnelles avec confirmation (`owner=False` dans la référencePython) ne sont pas encore portées.

Vérification indépendante :23cas de confirmations concordent, y compris Unicode/flottants, TTL et consommation concurrente. Sept premiers scénarios de publication passent avec Rust/PostgreSQL réels et un moteur contrôlé : HTTP/MCP, réponse moteur perdue, rapprochement uniquementGET, refus incomplet/tamper, concurrence, révocation et expiration. Un contre-test de panneSQL et le scénarioTerminusDB réelCI complètent encore ce lot.
