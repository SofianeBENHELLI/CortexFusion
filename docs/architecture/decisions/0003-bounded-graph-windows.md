# ADR 0003 — Fenêtres de lecture du graphe publié

Date : 2 octobre 2026. Statut : lecture backend et intégration BrainMap implémentées ; agrégation de territoires et qualification de charge à poursuivre.

## Problème

La console connectée téléchargeait tous les concepts publiés, leurs textes, leurs preuves et leurs relations avant de dessiner un périmètre limité. La pagination visuelle ne bornait pas ce transfert. Le journal récent possède déjà une fenêtre indépendante ([ADR 0002](0002-recent-publication-windows.md)). Il faut séparer les résumés utiles à la carte et les détails consultés sur demande, sans perdre les droits ni présenter les éléments d’une page comme l’ensemble du cerveau.

## Décision

Ajouter la lecture native `graph.window`, `GET /v1/domains/{domain}/graph/window`, également exposée par `api_graph_window`. Elle reste accessible aux membres qui peuvent consulter les concepts. Le filtrage de toutes les sources et des deux extrémités des relations précède la projection.

- `limit` : 24 par défaut, entre 1 et 50. Les résumés contiennent identité, titre, maturité, nombre de sources uniques et degrés entrant/sortant autorisés. Aucun corps de concept ni extrait/source privée n’est transféré.
- Sans `focus`, le périmètre comprend les concepts autorisés du domaine. Avec `focus`, il comprend le concept central et ses voisins directs entrants et sortants (`direction=both`, défaut), ou seulement sortants (`direction=outgoing`, utilisé par BrainMap). Le centre reste présent sur chaque page et compte dans la limite, qui doit alors être au moins 2. Un focus inexistant ou inaccessible retourne le même 404.
- Hors recherche, ordre croissant des UUID, curseurs exclusifs `after`/`next_after` et `before`/`previous_before`. `locate` retourne la page contenant un concept autorisé du périmètre. Ces trois positions sont mutuellement exclusives. Cet ordre sert au parcours stable ; il n’est pas un classement de pertinence ni un regroupement sémantique.
- `search` filtre les titres et corps autorisés par sous-chaîne littérale, avec casefold Unicode et accents conservés, sur 1 à 100 caractères. Il ne se combine pas avec `focus` ou `locate`. La recherche retourne aussi des résumés sans corps. Depuis le 4 octobre, son ordre privilégie titre exact → préfixe du titre → sous-chaîne du titre → mention dans le corps, puis UUID comme départage déterministe. Les curseurs de recherche identifient une position dans cet ordre ; un identifiant absent du résultat autorisé est rejeté (422), sans distinction entre inconnu et caché. Le même terme, la même version et la même visibilité sont requis pour poursuivre le parcours.
- `at_version` fixe la version publiée courante. Toute nouvelle publication exige un rafraîchissement et retourne 409 pour l’ancienne fenêtre. Ce contrat ne sert pas de snapshot historique.
- `visibility` est une empreinte des identifiants actuellement visibles, liée à l’identité et à la version. Une continuation `after` ou `before` exige `at_version` et `visibility`. Une visibilité modifiée retourne 409. Les autorisations sont néanmoins relues à chaque requête ; l’empreinte n’accorde jamais un droit.
- `domain_totals` et `scope_totals` donnent des stocks autorisés exacts pour cette lecture. Les relations comptées sont dirigées et sortantes du périmètre, y compris vers des concepts autorisés hors périmètre. Les couples de directions opposées et les types structurel/associatif restent distincts.
- `edges` contient au plus 120 relations entre les concepts de la page, triées par origine, cible et type. `internal_relations` indique leur total avant limitation ; `edges_truncated` signale les relations omises. `boundary_outgoing_relations` compte séparément les liens sortant de la page. Ne pas confondre limite de rendu et absence de relation.
- Un voisinage sortant fournit ses `scope_ids` complets (101 maximum avec le plafond actuel de 100 liens par concept). Ils permettent de compter les événements du périmètre indépendamment de la page de carte. Les autres lectures renvoient `null` pour ce champ.

Le contrat conserve `concepts.list` et `concepts.read`. Les schémas et descriptions sont maintenus dans `services/rust-core/contracts/extensions.json`, puis générés. Le générateur conserve désormais les rôles explicitement déclarés d’une extension ; les extensions antérieures gardent leur règle owner.

## Limites et intégration à poursuivre

Cette tranche borne le transport. `GraphService::published_concepts` charge et filtre encore le snapshot entier et clone ses concepts. La préparation d’un snapshot est actuellement plafonnée à 4 000 000 octets encodés ; ni cette limite, ni le coût serveur, ni les index de permissions ne sont corrigés par cette route. Aucun test de fonction sur 100 000 concepts ne prouve que le moteur peut publier ou servir ce volume.

La réponse ne contient pas de macro-territoires, de communautés sémantiques ni d’événements d’apprentissage. Les regrouper nécessite une politique dédiée, des identités stables entre versions et une agrégation après filtrage des droits. Ne pas présenter une partition technique d’UUID comme un domaine de connaissance.

L’adaptateur BrainMap utilise désormais `graph.window`, les stocks de `scope_totals`, puis `concepts.read` lors d’une sélection. Version et visibilité sont vérifiées de nouveau après les lectures. La recherche consulte le domaine autorisé et `locate` positionne un concept ou une relation sélectionnée depuis la Chronique. Les curseurs spatiaux et la sélection sont conservés dans l’URL ; l’authentification reste en mémoire. Deux paginations restent visibles : la fenêtre serveur et les éléments dessinés à l’écran. Aucun fallback silencieux vers des données fictives.

Le journal conserve ses requêtes séparées de [différences compactes](0004-compact-publication-differences.md), sans corps mais avec les relations des concepts modifiés. La migration de la carte ne borne donc pas à elle seule le transfert total de la console. Les regroupements serveur, la pagination des événements denses et la couverture temporelle complète restent ouverts. Un voisin hors page ne doit jamais être présenté comme une disparition historique ; une trace sélectionnée et autorisée est distinguée du savoir courant.

## Validation

- Sept tests Rust dédiés : parcours sans perte/duplication, retour/positionnement, centre conservé, recherche Unicode, cohérence des compteurs et du voisinage, version/visibilité, ordre déterministe, densité et bornes, entrées invalides. Les charges de 1 000/10 000/100 000 concepts vérifient uniquement la fonction de projection et la taille bornée de sa sortie.
- `scripts/verify_graph_window.py --synthetic-only --output .runtime/brain/graph-window-http-report.json` : 30 concepts/870 relations réellement publiés via sources, propositions, revues, approbation et publication. PostgreSQL et TerminusDB locaux isolés. Validation JSON Schema de chaque fenêtre, pagination, droits owner/viewer, isolation tenant, focus privé, MCP, nouvelle publication et révocation effective de source.
- La recette actualisée produit un transfert de 98 281 octets pour `concepts.list` et 21 438 octets pour la première fenêtre (24 résumés/120 relations). Ce sont des tailles d’un scénario synthétique précis, pas des mesures de latence ou de capacité.
- Tests frontend : validation des réponses, événements hors page, détail à la demande, pagination aller/retour, recherche hors page, centre conservé, absence de faux nœuds historiques et masquage sur changement de visibilité. La recette navigateur utilise un autre domaine réel de 30 concepts/29 relations ; les résultats précis sont consignés dans le journal de livraison.

Voir le [journal de livraison](../../product/brain-delivery-status.fr.md) pour les commandes, résultats et limitations actualisés.

## Amendement — 3 octobre, 21:27 UTC

[ADR 0007](0007-paged-snapshot-transport.md) remplace le plafond global historique de 4 Mo par des échanges moteur bornés et paginés, avec une garde canonique globale distincte. Le snapshot entier reste chargé et filtré côté serveur ; les limites de coût, de mémoire globale et d’agrégation décrites ici restent ouvertes.
