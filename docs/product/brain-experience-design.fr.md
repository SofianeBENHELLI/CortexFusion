# Expérience du cerveau Open Br**AI**n

**Réorientation du 16 octobre 2026 :** le [cadrage par cas d’usage et rôles](openbrain-use-cases.fr.md)
prend priorité pour la prochaine architecture UX. Le viewer consulte via son
chatbot/MCP ; les acteurs de gestion entrent par leurs responsabilités et tâches.
Les choix d’accueil/navigation ci-dessous sont historiques et ne valent plus
validation d’un accueil universel BrainMap. Les exigences d’exploration,
d’accessibilité et de provenance restent utiles. La section 15 reste différée ;
la nouvelle demande ne clôture pas le travail UI/UX.

Proposition de conception UI et UX — 2 octobre 2026. Direction retenue avec Sofiane : BrainMap et Chronique réunis, interface monochrome avec modes clair et sombre, exploration par niveaux de détail et priorité aux changements.

Faire de la vie du savoir la signature d’Open Br**AI**n. L'utilisateur doit comprendre ce que le cerveau sait, comment il évolue et où une décision humaine est nécessaire. La carte, les mouvements de mémoire, la consolidation et les preuves constituent une expérience cohérente. Les nombres de l'esquisse interactive sont fictifs ; le présent document décrit une cible, pas des capacités livrées.

**Spécification suivante :** [UX/UI par responsabilité](openbrain-ux-ui-spec.fr.md), [écrans](openbrain-screen-spec.fr.md) et [maquette](mockups/openbrain-ux.html). La direction graphique ci-dessous est conservée ; l’accueil et les parcours sont précisés dans ce nouveau dossier.

## 1. Intention et critères de réussite

Une expérience d'observatoire : lumineuse, précise, calme, avec une profondeur que l'on découvre progressivement. Le premier écran explique un changement utile. La carte permet de le situer. Une fiche en révèle les preuves. La conversation aide à l'interpréter. Une décision éventuelle reste explicite et traçable.

Trois horizons de lecture, à vérifier en tests utilisateurs : en dix secondes, comprendre l'état et la décision prioritaire ; en une minute, expliquer un changement ; en quelques minutes, instruire une proposition avec ses preuves et son impact. Ce sont des objectifs de conception, pas des performances déjà mesurées.

La beauté vient de la composition, de la typographie, des positions stables, de la hiérarchie et du mouvement porteur de sens. Le volume de concepts, le nombre d'arêtes et l'activité n'indiquent pas à eux seuls la qualité du savoir. La sophistication du produit doit se découvrir sans formation au vocabulaire du graphe.

## 2. Architecture de l'expérience

Navigation principale proposée : Conversation, Cerveau, À examiner, Sources. Administration et historique complet sont secondaires. L'espace Cerveau contient Vue d'ensemble, Cortex, Mémoire, Consolidation, Qualité ; l'activité est une chronologie commune disponible dans ces vues. L'esquisse explore quatre de ces vues, sans prétendre représenter tous les parcours.

Le domaine sélectionné, la période, la version publiée, le filtre courant et la sélection d'objet persistent lors du passage d'une vue à l'autre. Chaque état important possède à terme une URL partageable, sous réserve des droits du destinataire. Le bouton Retour restitue l'échelle, la sélection et la position précédentes.

Trois espaces composent le poste de travail : une navigation compacte ; un canevas principal large ; un panneau contextuel qui apparaît lorsqu'il y a quelque chose à expliquer ou décider. La conversation ne réserve pas en permanence la moitié de l'écran. Elle s'ouvre avec un contexte visible, que l'utilisateur peut retirer.

L'accueil de l'espace Cerveau réunit BrainMap et Chronique : carte dominante à gauche, journal temporel à droite, période et sélection communes. Sur petit écran, les deux surfaces se succèdent et conservent le même contexte. La conversation reste un accès secondaire. Cliquer un événement localise son objet sur la carte ; sélectionner un territoire filtre le journal. Les décisions attendues restent distinctes des changements déjà publiés.

## 3. Direction artistique

Conserver Manrope et la sobriété de la console actuelle. Interface exclusivement noire, blanche et grise : navigation, fonds, panneaux, textes et boutons. La sélection utilise le contraste, le contour et la typographie. Les palettes jade et indigo explorées auparavant sont abandonnées.

Deux apparences complètes, claire et sombre, avec préférence système par défaut et choix explicite. Les surfaces restent opaques et les textes contrastés. Une couche facultative de couleurs sémantiques peut souligner les changements de la carte : vert pour création, bleu pour renforcement, jaune pour baisse de poids autorisée, rouge pour archivage effectif. Cette proposition reprend les exemples de Sofiane et reste à valider ; elle ne colore pas le thème. Les signes +, ↑, ↓ et le libellé Archive permettent la même lecture sans couleur. Le rouge d'archivage n'est pas une alerte ni une suppression.

Sur desktop : navigation compacte, carte dominante et journal de 280 à 340 pixels lorsque l'espace le permet. Les preuves s'ouvrent dans ce même panneau contextuel. Rythme d'espacement sur une base de 8 pixels ; titres courts de 28 à 36 pixels, texte métier de 14 à 16 pixels, chiffres alignés. Rayons modérés, séparateurs discrets, ombres réservées aux éléments superposés.

Une action principale par contexte. Les filtres ne concurrencent pas les titres. Quatre indicateurs au maximum au premier niveau ; leurs tendances et détails s'ouvrent au clic. Les libellés sont métier : « nouvelle connexion », « savoir publié », « à examiner », « réactivé ». La terminologie technique reste dans le diagnostic d'exploitation.

Les transitions accompagnent un changement réel : 180 à 240 ms pour une sélection, 300 à 450 ms pour une transformation du graphe. Pas de mouvement permanent. La lecture temporelle est déclenchée par l'utilisateur, interruptible et désactivée en mouvement réduit.

## 4. Vue d'ensemble et rapporteur

L'ouverture associe une phrase de synthèse, un changement majeur et les décisions attendues. Le rapporteur parle de faits observables et donne accès à leurs preuves. Exemple de structure : « Depuis votre dernière visite, le domaine s'est enrichi. Une nouvelle connexion explique mieux ce sujet. Deux décisions restent nécessaires. » Le récit réel doit être produit à partir des mêmes événements que les compteurs.

Trois registres restent disponibles : savoir solide ; lacunes connues ; angles morts soupçonnés. Ce dernier registre n'apparaît comme mesuré que lorsque les observations autorisées nécessaires existent. L'absence de données est explicitement distincte de l'absence de problème.

Les tendances utilisent une période comparable, un périmètre visible et une unité précise. Chaque chiffre ouvre sa liste d'objets, déjà filtrée. Les décisions sont classées par conséquence et ancienneté, sans classement des personnes.

## 5. Cortex et exploration

La carte s'inspire du changement d'échelle d'une carte de navigation. Au niveau du cerveau entier, seuls les domaines et les grandes connexions sont visibles. Le zoom révèle les groupes thématiques, puis les concepts et leur voisinage, enfin les relations et leurs preuves. Il transforme le niveau d'information ; il ne grossit pas simplement les mêmes nœuds. Les territoires et positions restent stables entre deux dates pour rendre les différences repérables.

Le regroupement dépend de la densité réellement affichable, des collisions de libellés et de la taille des cibles, pas seulement d'un nombre global de concepts. Un budget d'objets visibles est à calibrer sur desktop et mobile. Des seuils différents d'ouverture et de regroupement évitent le clignotement à la frontière d'un niveau. Les agrégats portent un nom, un effectif et des compteurs de changements ; un lien entre deux domaines résume des relations, sans suggérer une relation métier unique. Les détails sont chargés uniquement au niveau utile. Le prototype illustre cette navigation avec quelques données fictives et ne valide pas la performance à grande échelle.

Par défaut, la lecture Changements conserve les territoires comme repères et ne met en avant que les objets et liens modifiés. La vue Synthèse restitue les grandes connexions de contexte. Un territoire sans changement peut rester visible, très atténué, sans déployer ses relations. Les zones affichent plusieurs compteurs lorsque création, renforcement et archivage coexistent ; aucune couleur dominante ne doit effacer les signaux minoritaires. Les compteurs globaux dédupliquent les relations transverses, même si leurs deux territoires les signalent.

Deux lectures principales utilisent le même espace : Synthèse et Changements. Synthèse donne le contexte structurel ; Changements souligne les différences d'une période ou entre deux états publiés, selon un libellé explicite. Une lecture secondaire de l'activité pourra montrer la mobilisation. La maturité se consulte comme un attribut indépendant. La taille d'un nœud ne doit jamais être interprétable tantôt comme la confiance, tantôt comme l'usage sans changement explicite de légende.

Une création apparaît au moment de sa publication. Les candidats de consolidation sont présentés dans un contexte explicitement nommé, distinct de la comparaison des états publiés. Dans la carte des changements publiés, un trait plein indique un lien présent ; une trace pointillée marquée « Archivée » conserve la position d'un ancien lien pour expliquer son retrait. La légende reste spécifique à cette lecture et ne recycle pas ce signe pour un candidat. L'épaisseur peut représenter le poids au niveau détaillé, avec une échelle visible. Une relation structurelle n'a pas de refroidissement fondé sur l'usage. Les relations de gouvernance restent dans une couche séparée.

Cliquer un concept stabilise son voisinage et ouvre son identité, sa maturité, son activité, ses sources et ses changements récents. Cliquer une relation ouvre son sens, sa provenance, son poids avant/après et la raison du changement. La fiche offre « Expliquer cette évolution », puis, pour les personnes autorisées, l'action adaptée.

Recherche, zoom, filtres et journal partagent la même sélection. La période demeure inchangée lors d'un zoom ; changer de période conserve la position et le périmètre. Un clic sur un événement hors champ rejoint le niveau pertinent et garde un chemin de retour. Au niveau macro, les créations et retraits peuvent se compenser dans un solde : montrer séparément les créations et archivages, plutôt qu'un seul delta net. Un changement de politique d'agrégation ou de droits ne doit pas apparaître comme une création de savoir. La 3D reste une piste ultérieure ; elle ne conditionne pas cette expérience.

## 6. Mémoire et rappel

La mémoire durable est représentée comme le socle. Le court terme est une sélection active à l'intérieur du savoir mobilisable, pas une collection de propositions en attente. Les archives constituent un espace distinct de l'usage courant. Les conversations et épisodes demeurent des traces, sans être assimilés aux concepts validés.

Pour chaque présence en court terme, montrer une raison : création récente, modification récente, activation soutenue ou problème ouvert. Une sortie de fenêtre conserve le concept et sa maturité. Un concept ancien peut revenir au premier plan sans être recréé.

L'écran associe les effectifs, les entrées/sorties sur période et une liste explicative. Les mouvements peuvent être rejoués dans le temps ; si les raisons se cumulent, on les montre sans compter plusieurs concepts. Les agrégats de court terme et long terme ne sont pas présentés comme deux stocks disjoints si le modèle est une surcouche.

Parcours archive : recherche explicite → résultat marqué archivé → raison et date → consultation des sources et version → demande de réactivation → revue → publication. Une simple consultation peut être tracée comme un rappel pour observation ; elle ne restaure pas implicitement le statut actif. Cette distinction résout l'ambiguïté entre les anciennes notes de rappel et les règles de gouvernance.

La prévisualisation d'un archivage montre les relations, réponses et questions d'épreuve susceptibles d'être affectées. Une proposition d'archivage ne doit jamais être déduite de la seule absence d'usage. La réactivation conserve la provenance et explique le statut de revue appliqué.

## 7. Sommeil et consolidation

Le titre utilisateur associe la métaphore et le mécanisme : « Sommeil — consolidation du domaine ». Le savoir publié reste disponible. La consolidation profonde est déclenchée par une dette explicable, une fenêtre autorisée et un budget ; les tâches légères quotidiennes sont distinguées.

Une préparation passe par des étapes nommées : analyser les épisodes, rapprocher les signaux, préparer les changements, vérifier les épreuves, présenter le résultat. La progression s'appuie sur des étapes et volumes effectivement mesurés. Si la durée est inconnue, elle reste inconnue.

L'écran avant lancement expose périmètre, raisons, plafond de budget et version de départ. Pendant le travail : étape, dernier événement reçu, éléments traités, éventuel blocage. Après : différences, preuves, changements exclus, tests avant/après, coût observé et décisions nécessaires. « Préparation terminée », « acceptée » et « publiée » sont des états distincts.

La comparaison avant/après conserve positions et identités. L'utilisateur parcourt les modifications une par une : regroupement de doublons, nouvelle relation proposée, réorganisation, archivage proposé. Chaque proposition montre ce qu'elle devrait améliorer et son résultat aux épreuves. Une amélioration globale ne masque pas une régression locale.

Les états de reprise font partie du design : interruption, budget épuisé, droits perdus, données périmées, résultat incertain, échec de publication. Une reprise relit d'abord le résultat durable. Le système ne transforme pas un timeout en nouvelle décision.

## 8. Qualité et métacognition

La solidité combine des dimensions séparées : maturité, preuves, fraîcheur, couverture des questions et résultats d'évaluation. Un score composite éventuel doit exposer sa formule, ses composantes, leur couverture et la politique utilisée. La première version privilégie les dimensions lisibles.

Les lacunes sont regroupées par thème, récurrence et conséquence. Chaque groupe propose une prochaine action concrète : examiner une source disponible, faire préparer une proposition, solliciter un expert lorsque ce mécanisme existera. Une lacune corrigée doit être rejouée en épreuve avant d'être présentée comme démonstration d'amélioration.

Une contestation et une quarantaine temporaire ont des marqueurs distincts. Une quarantaine expose motif, échéance et auteur de prolongation ; elle ne devient pas silencieusement un archivage. Le feedback négatif crée un problème à instruire et ne constitue pas une preuve suffisante pour dégrader automatiquement un concept.

La curiosité, les observations externes, les hypothèses de liens transverses et la réforme de domaines appartiennent à la vision complète. Les fonctionnalités absentes sont annoncées comme telles ; elles ne produisent pas de fausses alertes ou de valeurs de démonstration en mode connecté.

## 9. Mesures et modèle d'événements

| Indicateur | Définition proposée | Détail ouvert au clic |
|---|---|---|
| Nouveaux concepts | Identifiants devenus publiés pour la première fois sur la période | Concept, publication, source, provenance |
| Concepts enrichis | Identifiants existants avec changement de contenu publié | Avant/après et motif |
| Nouvelles relations | Relations identifiées devenues publiées sur la période | Extrémités, type, preuve, publication |
| Relations renforcées | Relations dont le poids a augmenté, en séparant usage et décision humaine | Poids avant/après et événements explicatifs |
| Refroidissement | Évolution négative produite par la politique de demi-vie autorisée | Politique, plancher, dernière activation |
| Mobilisation court terme | Concepts uniques répondant à la politique de fenêtre/activité/problème | Causes d'entrée et de sortie |
| Archives et rappels | Décisions d'archivage, consultations et réactivations comptées séparément | Motif, acteur autorisé, version |
| Dette cognitive | Composantes mesurées : problèmes, changements, résumés périmés, échecs d'épreuve | Liste triée par composante |
| Amélioration | Questions auparavant échouées devenues réussies, avec suivi des régressions | Banque, résultats, versions comparées |
| Publication | Délai de l'acceptation à la disponibilité effective | Dates, tentative, résultat durable |

Les agrégations comptent les effets métier, pas les retries techniques. Elles déclarent fuseau horaire, fenêtre, version, date de calcul, périmètre visible et complétude. Les périodes historiques non instrumentées ne sont pas reconstruites avec des chiffres inventés. Les conversions d'une fusion/scission et les réactivations sont séparées des créations.

Prévoir une projection de lecture à partir d'événements typés. Chaque événement porte un identifiant stable, son type, domaine, objet, horodatage, version et cause ; selon le cas, avant/après, politique, cycle, source, proposition et décision. La chaîne lisible est signal → proposition → décision → publication → effet mesuré. Un changement de tier dérivé conserve la politique et les éléments de calcul nécessaires à son explication.

Les API de lecture agrègent côté serveur. Les noms et formes d'endpoints seront spécifiés pendant la phase de contrat ; rien ici ne prétend ajouter des opérations déjà disponibles. La carte, le brief et les KPI consomment le même périmètre cohérent pour éviter les divergences.

Les droits s'appliquent aussi aux nombres, relations et événements. Les historiques personnels actuels ne deviennent pas des statistiques collectives par simple agrégation dans le navigateur. Un compte propriétaire ne donne pas accès aux conversations des autres. La base collective nécessite un contrat de visibilité dédié et des données autorisées.

## 10. Parcours de référence

1. **Comprendre sa journée.** Ouvrir le brief, repérer le principal changement, voir sa position dans le cortex et retrouver sa preuve. Succès : l'utilisateur explique ce qui a changé et depuis quand.
2. **Comprendre une connexion.** Depuis le graphe ou un KPI, ouvrir une relation, comparer son poids et sa provenance, distinguer proposition et publication. Succès : l'utilisateur distingue activité et vérité.
3. **Revoir un souvenir.** Un concept ancien réapparaît dans la sélection de court terme avec une cause. Succès : l'utilisateur comprend qu'il existait déjà et garde la même maturité.
4. **Consulter une archive.** Lire explicitement une ancienne version puis préparer une réactivation. Succès : l'utilisateur comprend si le concept est actif ou archivé à chaque étape.
5. **Examiner une consolidation.** Comprendre le déclenchement, parcourir les différences, lire les épreuves, accepter ou différer une proposition. Succès : l'utilisateur sait ce qui sera publié et ce qui reste inchangé.
6. **Comprendre un échec.** Retrouver un résultat incertain sans dupliquer l'action. Succès : aucune annonce prématurée de publication et une prochaine étape claire.

## 11. Accessibilité et formats

Toutes les actions sur la carte possèdent un équivalent en liste et au clavier. La couleur n'est jamais l'unique signal. Les cibles tactiles font au moins 44 pixels ; les contrastes et le mouvement réduit font partie des vérifications. Les détails essentiels sont disponibles sans survol.

Sur tablette, la fiche remplace temporairement une partie du canevas. Sur téléphone, le brief et les décisions viennent d'abord ; la carte se concentre sur un voisinage et la fiche s'ouvre en page dédiée. Les filtres pertinents persistent. Aucun zoom miniature d'une interface desktop entière.

Prévoir dès les maquettes les états vide, premier domaine, aucun événement sur la période, jeu partiel, accès restreint, chargement, échec, hors ligne et données périmées. Montrer le dernier état reçu avec son âge lorsqu'il est autorisé, sans l'appeler « en direct ».

## 12. Plan de développement BrainMap et Chronique

La [roadmap de développement](roadmap.md#brain-experience-delivery-plan) porte désormais la séquence de référence, ses dépendances et ses critères de sortie. La direction BrainMap et Chronique est retenue ; les lots d’implémentation sont suivis dans le [journal de livraison](brain-delivery-status.fr.md), avec leur état et leurs preuves. Les esquisses ne constituent ni une intégration dans la console ni une qualification de volumétrie.

| Lot | Livrable | Dépendance | Critère de sortie |
|---|---|---|---|
| BRN-01 | Sémantique partagée, contrats de lecture, identités stables, périodes/versions et fixture cohérente | Direction retenue et contrats existants | Carte, journal et KPI concordent ; modèle mémoire corrigé ; absence de données distincte de zéro |
| BRN-02 | Intégration dans la console React : thèmes monochromes clair/sombre, zoom par niveaux, carte et journal synchronisés, preuves et navigation | BRN-01 | Parcours jouables, clavier/mobile, contexte conservé au retour ; essai borné du moteur de rendu |
| BRN-03 | Première observation connectée aux concepts, relations et publications réels | BRN-01–02 | Une publication sourcée apparaît une fois dans le journal, les KPI et la carte, avec ses droits et versions |
| BRN-04 | Agrégation serveur, détail borné, comparaison historique et qualification du passage à l'échelle | BRN-01–03 | Budgets mesurés ; positions stables ; relations transverses dédupliquées ; aucun téléchargement du graphe complet pour la synthèse |
| BRN-05 | Activations, sélection de court terme et dynamique des relations associatives | BRN-01 et BRN-03 | Entrées/sorties et poids expliqués, maturité indépendante ; aucun refroidissement d'usage des liens structurels |
| BRN-06 | Archivage et réactivation gouvernés, impact, conservation des sources et versions | BRN-01 et BRN-03 | Une consultation ne réactive rien ; restauration et identité traçables ; pas d'effacement historique |
| BRN-07 | Sommeil/consolidation durable, propositions, épreuves, revue et publication | BRN-03 et mécanismes BRN-05–06 utilisés | Savoir publié disponible ; préparation/acceptation/publication séparées ; reprise et régressions visibles |
| BRN-08 | Recette intégrée, accessibilité, droits, mesures et préparation du pilote | BRN-04–07 pour le périmètre complet | Preuves de bout en bout et rapport de performances ; aucune simulation substituée silencieusement au backend |

Le premier incrément suit **BRN-01 → BRN-02 → BRN-03** : publier un concept et une relation sourcés, retrouver le changement dans le journal, le situer sur la carte, zoomer et consulter sa preuve. Les fonctions de sommeil et de dynamique mémoire ne bloquent pas cette première livraison ; en mode connecté, les capacités absentes sont explicites.

La carte 3D, le rêve, la curiosité avancée et le concept général de représentations restent des suites distinctes. Les estimations de durée viennent après les contrats et l'essai de rendu. Décision de Sofiane du 3 octobre : **le bundle doit devenir du savoir Cortex et le Step 1 cible 10 000 concepts**, avec qualification du frontend à ce volume. Le jeu de 1 000 reste une preuve de non-régression ; 100 000 constitue une qualification ultérieure. Les [critères du Step 1](roadmap.md#step-1-decisions--3-october-2026) sont des exigences à vérifier, pas une capacité déjà annoncée.

**Point de clôture du travail UI/UX courant :** rappeler à Sofiane le sujet « Représentations du cerveau » consigné en section 15, pour décider ensemble de sa reprise. La livraison du présent plan et de la première esquisse ne clôture pas à elle seule ce travail. Ne pas engager ce sujet en avance.

## 13. Validation de l'expérience

Tester la compréhension avec des utilisateurs et propriétaires de domaines, séparément. Vérifier notamment qu'ils distinguent « publié », « chaud », « établi », « archivé » et « proposé » ; qu'ils retrouvent la cause d'un changement ; qu'ils savent si une consolidation modifie déjà les réponses. Observer le temps, les hésitations et les erreurs de compréhension, pas seulement l'appréciation esthétique.

La validation technique porte sur les jeux sans données, volumineux et partiels, les changements de droits, la stabilité des positions, les compteurs idempotents, la comparaison de versions et la reprise après perte de réponse. Les performances sont mesurées avec des graphes de référence et un environnement décrit ; un dessin fluide sur une petite fixture ne constitue pas une qualification de volumétrie.

## 14. Ancrage dans l'existant

Le code actuel possède les concepts sourcés, la maturité, des liens structurels/associatifs pondérés, les propositions, versions et événements de publication. Le modèle de présentation du mock réduit les relations à des noms et regroupe les propositions sous des libellés de mémoire. Le moteur de tiers, le renforcement/refroidissement et la consolidation planifiée restent à construire.

Références du dépôt : [guide frontend](../frontend-guide.fr.md), [console](../../apps/console/README.md), [modèle des relations](../../services/rust-core/src/knowledge.rs), [modèle de concept](../../services/rust-core/src/snapshot.rs), [opérations de changement](../../services/rust-core/src/changes.rs).

Le dossier confidentiel local v0.5 a été utilisé pour les principes de mémoire, les huit phases, Éclairer et les deux vitesses d'apprentissage. Il n'est pas recopié ni ajouté au dépôt. Les orientations UI détaillées et l'ordre de livraison de ce document sont des propositions nouvelles.

## 15. Idée à reprendre — Représentations du cerveau

Idée formulée par Sofiane le 2 octobre 2026. Importance stratégique signalée par l'auteur. À conserver et à rappeler à la fin du travail UI/UX en cours ; aucune conception détaillée ni implémentation demandée maintenant.

Le cerveau est un système à un très grand nombre de dimensions : concepts, relations intriquées, domaines, temps, versions, cycles de vie et évolutions. On ne peut pas en montrer toutes les dimensions simultanément. Introduire explicitement la notion de **représentation** : une projection partielle de ce système, selon un point de vue choisi.

Une représentation est calculée dynamiquement à partir de l'état du cerveau. Le résultat consulté constitue une vue statique de ce point de vue. Le calcul dynamique et le caractère statique du résultat sont deux propriétés distinctes. Plusieurs représentations différentes peuvent être produites à partir du même cerveau.

Exemples cités : texte, table, graphiques, mind maps, graphes de concepts et de relations de type « fireworks », carte de zones ou domaines accompagnés de leurs KPI. Les points de vue peuvent porter sur le cycle de vie du cerveau, les concepts appris au cours des dernières semaines ou d'autres dimensions à imaginer.

Le résultat n'est pas directement éditable par défaut. La possibilité de l'éditer, et le sens éventuel de cette édition, restent des pistes ouvertes, sans décision à ce stade. Les modalités de recalcul et le rapport exact à une date ou une version seront également à approfondir lors de la reprise.

**Rappel attendu :** « Nous avons terminé cette partie UI/UX. Reprenons ton idée des représentations : des projections partielles du cerveau, calculées selon un point de vue, puis consultables sous différentes formes. » Ce rappel invite à reprendre la réflexion ; il n'autorise pas à lancer seul la conception ou le développement.
