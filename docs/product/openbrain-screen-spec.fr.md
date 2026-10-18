# Open Br**AI**n — catalogue détaillé des écrans

**Actualisation du 16 octobre :** le [layout à conversation centrale](openbrain-chat-central.fr.md) définit désormais la composition et la parité des actions chat/UI. Les contenus et garanties ci-dessous restent applicables.

16 octobre 2026. Cible de conception ; lire les [règles communes](openbrain-ux-ui-spec.fr.md), les [contrats](openbrain-experience-contracts.fr.md) et la [recette](openbrain-ux-validation.fr.md). La maquette couvre les écrans E01–E26 ; plusieurs UC partagent un écran. Tous héritent des états chargement, vide, erreur, accès/session, partiel et reprise de la spécification. Les paragraphes ci-dessous précisent les différences métier.

Les noms, compteurs et identifiants courts illustratifs (« Procédures », SIG-42, T-104, P-18, v12→v13) appartiennent exclusivement à une fixture fictive. La navigation d’atelier permet d’ouvrir des écrans d’autres rôles pour les examiner ; ce n’est pas un sélecteur de permissions réel.

## E01 — Entrer dans mon espace

**Intention :** choisir une responsabilité et un périmètre compréhensibles. UC V01, C01, M05, O01, T03. Contrat B01.

**Composition :** marque et identité vérifiée ; organisation ; domaines autorisés nommés ; pour chaque rôle disponible, description d’une phrase et prochaine activité ; préférence « Revenir directement dans cet espace ». L’accès personnel local est identifié comme tel, sans afficher de secret. Le viewer voit « Utiliser dans mon chatbot » et une aide MCP.

**Actions :** choisir contexte puis « Ouvrir mon espace ». Un contexte unique peut être restauré. Changement de contexte depuis l’en-tête ; le rôle courant demeure affiché. Seules les combinaisons serveur sont proposées, sans choix d’identité agent.

**États :** aucune autorisation → explication et contact administrateur configuré ; session expirée → identification et reprise de la route ; domaine supprimé/inaccessible → masquer son nom si nécessaire et choisir une autre entrée. Un lien direct n’est pas écrasé par la préférence d’accueil. Mobile : choix verticaux, descriptions toujours visibles. **Sortie :** espace autorisé ouvert, identité et périmètre lisibles.

## E02 — Mon travail de contributeur

**Intention :** savoir quoi faire maintenant. UC C01/C04. B02/B09.

**Composition :** titre « Mon travail », tâche la plus urgente selon échéance/priorité explicable, trois filtres (« À prendre en charge », « En cours », « Réponse attendue »), liste complète paginée. Colonnes : titre/type, état, domaine, échéance/âge, dernière demande. Les tâches sans échéance ne sont pas classées arbitrairement en retard. Une vue alternative « Étapes » regroupe par état ; elle ne permet pas une transition par simple glissement.

**Actions :** ouvrir tâche ; nouvelle proposition spontanée ; consulter mes propositions. Le compteur d’un filtre ouvre exactement les objets comptés. **États :** zéro affectation explique le fonctionnement ; zéro après filtre propose effacer ; source manquante indique blocage sur la ligne. Mobile : titre, état et prochaine action avant métadonnées. **Sortie :** l’expert identifie une action et ouvre le bon dossier.

## E03 — Tâche et prise en charge

**Intention :** comprendre mission, preuves, responsabilité et fin attendue. UC C01/C04, M02/O03. B02/B03.

**Composition :** retour à la liste ; T-104, titre, état ; « Résultat attendu » ; demandeur et raison d’affectation ; priorité et justification ; échéance, âge depuis signal initial et âge de tâche ; preuves autorisées ; liens signal/proposition/contrôle ; fil d’événements. Les commentaires internes indiquent leur visibilité.

**Actions conditionnelles :** proposée → accepter, refuser, demander précision ; en cours → préparer correction/rendre avis selon type, déclarer blocage ; bloquée → expliquer attente, solliciter responsable ; en attente revue → voir progression, répondre ; terminée → conclusion et éventuelle demande de réouverture. Refus/blocage/réouverture exigent un motif (texte non vide, limites serveur annoncées). Pas d’échéance silencieusement réinitialisée.

**Erreurs :** attribution concurrente → relire ; source retirée → masque et demande d’accès ; annulation de mission → brouillon conservé seulement selon droits. Mobile : panneau de preuves devient page E16. **Sortie :** événement de prise en charge ou reçu d’action, jamais simple changement local de statut.

## E04 — Préparer une proposition

**Intention :** produire un changement vérifiable. UC C02/C04. B04/B06.

**Composition :** objet et version de départ ; contenu publié à gauche, proposition à droite ; motif ; sources (référence, révision, passage) ; portée ; questions potentiellement touchées ; statut du brouillon. Modes « Comparer » et « Lire le proposé » accessibles. Sans connaissance de l’impact, « Impact non évalué », pas zéro.

**Champs :** titre, cible, changement, motif, preuve(s) obligatoire(s) selon politique ; objets liés ajoutés par sélection autorisée. Limites de taille présentées avant saisie ; aucune troncature silencieuse. Changement hors périmètre interdit. Nouveau document → demande au manager, pas élévation de droit.

**Actions :** enregistrer brouillon si mécanisme présent ; prévisualiser ; soumettre à la revue. Validation en place + résumé. Soumettre requiert version attendue, source accessible et droits. Conflit ouvre comparaison sans écraser le brouillon. Nouvelle révision indique les avis invalidés. Mobile : publié/proposé en blocs successifs, pas deux colonnes comprimées. **Sortie :** reçu de proposition, révision et prochaine responsabilité.

## E05 — Rendre un avis d’expert

**Intention :** évaluer une révision précise. UC C03/C04. B04.

**Composition :** P-18/r3, différence, preuve, résultats de contrôle ; auteur et mission de revue ; checklist de lecture non confondue avec verdict ; avis précédents identifiés. **Champs :** favorable / modification demandée / réserve, justification, sources éventuelles. Une case « J’ai lu » n’est pas une confirmation owner.

**Actions :** « Enregistrer mon avis », consulter preuve, revenir à la tâche. Si la proposition change pendant la revue : avis non envoyé, nouvelle comparaison proposée. Un avis déjà déposé reste daté et lié à sa révision ; un second envoi identique retrouve le reçu. Autorevue marquée et soumise à politique D03. **Sortie :** avis enregistré, tâche de revue terminable, décision owner toujours distincte.

## E06 — Pilotage quotidien du corpus

**Intention :** faire avancer les files et débloquer. UC M05/M02/M03/M04. B09.

**Composition :** période et fraîcheur ; quatre entrées maximum « À qualifier », « Sans responsable », « Bloquées », « Imports en erreur » ; liste priorisée d’actions avec cause et ancienneté ; propositions prêtes pour décision ; contrôles à diagnostiquer. Les totaux correspondent aux filtres accessibles.

**Actions :** ouvrir une file, affecter, importer, examiner contrôle. Aucune publication directe. Agrégats partiels portent `partiel` et dénominateur connu ; indisponibles portent `Non calculé`. Pas de score composite. Mobile : les files sont des lignes lisibles puis les blocages ; les graphiques secondaires sont omis, jamais l’action.

## E07 — Qualifier les signaux partagés

**Intention :** décider ce qui mérite du travail collectif. UC M01/V04. B03.

**Composition :** file avec origine (explicite/observée/inférée), cible, ancienneté, nombre d’événements autorisés, criticité motivée ; détail SIG-42 avec extrait minimal partagé, preuve/cible, conditions du partage, historique ; signalements proches candidats. Une probabilité d’inférence n’est pas un verdict de qualité.

**Actions :** demander complément, créer tâche E08, lier comme doublon après comparaison, orienter vers incident, clore sans changement avec motif. Rapprocher conserve tous les identifiants et dates ; pas d’effacement des témoignages. Un formulaire de partage indique destinataires et texte ; toute conversation non partagée est absente. **États :** retrait de consentement → extrait retiré selon politique, trace minimale ; erreur de classifier → correction manuelle tracée ; accès source absent → blocage explicite. **Sortie :** qualification persistée et prochain responsable/raison de clôture.

## E08 — Affecter et déléguer une mission

**Intention :** formuler une demande réalisable. UC M02/O03/A01. B02/B10.

**Composition :** origine, résultat attendu, type correction/revue/diagnostic ; expert ou manager autorisé ; preuves accessibles ; priorité justifiée ; échéance et fuseau ; vérification des droits aux objets requis. L’expertise suggérée est expliquée et ne révèle pas des données personnelles interdites.

**Actions :** préparer → récapituler → proposer la mission. Un agent se choisit comme service autorisé avec mandat, pas dans un menu d’identité humaine. Affectation humaine attend acceptation. Réaffecter conserve âge et motif ; demandes anciennes visibles. Champ requis manquant → erreur locale ; responsabilité devenue inéligible → refus serveur et rechoix. **Sortie :** tâche proposée, notification à délivrer, aucun droit ajouté.

## E09 — Sources et collections

**Intention :** trouver l’origine documentaire et gérer son cycle. UC M03/V03. B06.

**Composition :** collections autorisées ; sources avec titre, version, type, dernière importation, droit/état ; filtre en erreur/à examiner ; accès au texte intégral autorisé et à ses propositions liées. Les références documentaires sont explicitement distinctes des relations de connaissance validées.

**Actions :** importer E10 (manager/owner), consulter E16, voir import E11, préparer mise à jour. Mise à jour sélectionne l’identité existante pour éviter le doublon. Pas de bouton suppression définitive dans ce périmètre de conception. Mobile : cartes de source avec dernière version et action.

## E10 — Importer ou mettre à jour

**Intention :** fournir une source sans publier arbitrairement. UC M03. B06.

**Étapes :** 1 collection et portée ; 2 fichier/texte et métadonnées ; 3 contrôle des formats/tailles/doublons/droits et récapitulatif ; 4 lancer puis suivre. Le récapitulatif indique ce qui sera conservé, traité, exclu, et les limites réelles du parseur. Un format non pris en charge ne s’affiche jamais comme sélectionnable avec succès fictif.

**Champs :** titre, collection, source/fichier ou contenu, référence externe si autorisée, mise à jour de version existante. Remplacement de contenu publié exige une proposition gouvernée. **Erreurs :** fichier trop grand (limite indiquée), doublon exact (retrouver existant), source différente sous même identité (examiner), lecture impossible (motif sans exposer contenu). **Sortie :** reçu d’import et E11 ; aucune annonce « savoir publié ».

## E11 — Suivre un import

**Intention :** comprendre progression et échecs récupérables. UC M03. B06/B11.

**Composition :** état global + volume connu, étape, dernier événement, lignes par fichier : attente/en cours/réussi/échoué/annulé ; source/proposition produite ; détail d’erreur et possibilité réelle de reprise. Si total inconnu, étape et activité sans pourcentage. Fin partielle ne devient pas succès global.

**Actions :** ouvrir source, ouvrir proposition, relancer les éléments échoués avec résumé, demander arrêt des éléments non commencés. Stop n’efface pas les réussites. Retry exact après perte de réponse retrouve opération. **Sortie :** bilan par élément, provenance et prochaines actions visibles.

## E12 — Banque de questions et contrôles

**Intention :** définir et vérifier les attentes métier. UC M04/O04. B07.

**Composition :** banque/révision, thèmes, question, critères/réponse attendue, preuves, auteur, état brouillon/approuvé, dernier résultat pertinent ; sélection de campagne ; budget et méthode. Les résultats anciens portent version et date. **Actions :** préparer référence, demander/accorder approbation selon rôle, lancer une campagne sur références approuvées, consulter E13. Modification d’une référence approuvée crée une nouvelle révision.

**Erreurs :** banque vide → créer référence ; référence sans preuve → ne pas approuver ; configuration incompatible → expliquer ; budget indisponible → ne pas lancer. Mobile : question puis attendu/statut, résultats en détail. **Sortie :** banque gouvernée ou exécution identifiée.

## E13 — Résultats et régressions

**Intention :** décider quels écarts traiter. UC M04/O04/O02. B07/B09.

**Composition :** versions corpus/banque/méthode, exécutées/attendues ; réussites, échecs métier, erreurs techniques, ignorées et non exécutées séparés ; détail par question : attendu, obtenu, preuves, évaluation, incertitude, historique. Comparaison interdit l’agrégation aveugle de configurations incompatibles.

**Actions :** ouvrir preuve, créer tâche liée à la régression, demander analyse, relancer éléments éligibles, comparer exécutions compatibles. « 8/10 réussies » n’est pas « 100 % » parce que deux sont non exécutées. **Sortie :** diagnostic ou tâche avec trace, pas de modification automatique du corpus.

## E14 — Supervision du domaine

**Intention :** savoir ce qui exige une décision owner. UC O01/O03/O04. B09.

**Composition :** contexte/période ; décisions prêtes ; blocages à arbitrer ; couverture définie ; contrôles et évolutions ; revues échues. Une synthèse éventuelle cite les faits/objets utilisés. Aucun statut « sain » sans critères.

**Actions :** décider E15, déléguer E08, couvrir E20, contrôler E12, vérifier historique E18. Plusieurs domaines : seulement ceux autorisés, détail de la composition de l’agrégat et données manquantes. L’inactivité seule ne déclenche pas alerte d’obsolescence. **Sortie :** arbitrage ou mission explicite.

## E15 — Décider et publier

**Intention :** engager une révision exacte. UC O02/O05. B04/B05.

**Composition :** P-18/r3 et version de départ ; différence, sources et retraits d’accès, avis et conflits, contrôles, portée du changement ; prérequis bloquants. **Actions :** demander modification, refuser, différer (motif), approuver puis publier séparément. Seul le rôle/capacité actuel autorisé expose la commande. L’action inconnue pour ce runtime porte « Indisponible » et sa cause, sans fausse réussite.

**Récapitulatif de confirmation :** acteur, organisation/domaine, action, révision, empreinte raccourcie vérifiable en détail, effet et motif. Retour depuis hôte de confirmation, reçu de décision, puis étape de publication. Annuler ferme sans mutation. Conflit/reçu expiré → nouvelle revue ; timeout → E17 résultat incertain. Mobile : lecture intégrale, récapitulatif en page complète si dialogue ne tient pas. **Sortie :** résultat durable et version servie, ou état d’incertitude clairement suivi.

## E16 — Preuve et lecture intégrale

**Intention :** vérifier un fait sans perdre sa tâche. UC V03/C02/C03/O02. B06/B08.

**Composition :** titre source, révision/date, passage exact, position du passage et contexte intégral consultable ; citation, objets qui l’emploient, avertissement si historique. Une fiche de concept indique ce qui est publié/proposé et la provenance, pas un score de vérité inventé.

**Actions :** lire intégralement, rejoindre concept/carte, revenir au dossier ; copier une citation autorisée avec référence (pas toute la source sans action). Relecture de droits avant détails ; absence de preuve distinguée de refus. Texte long paginé/chargé progressivement avec chemin jusqu’au contenu complet, sans coupure silencieuse. Mobile : page dédiée, retour exact.

## E17 — Publication, vérification et retour au déclarant

**Intention :** établir la résolution réellement obtenue. UC O02/V06/M01. B03/B05/B07.

**Composition :** reçu durable, version publiée, tâche d’origine, contrôle à réaliser/résultat, conclusion partageable distincte des notes internes. Parcours : résultat à vérifier → publication confirmée → recontrôle → clôture motivée → retour disponible au déclarant. Chaque étape a sa date et son responsable.

**Actions :** vérifier reçu, lancer/consulter recontrôle, préparer conclusion publique au déclarant, clore si politique D05 et prérequis respectés. Recontrôle échoué → tâche ouverte/bloquée, aucune étiquette « corrigé et vérifié ». Réouverture conserve historique. **Sortie :** statut exact consultable en MCP, aucune fuite des notes internes.

## E18 — Activité et audit métier

**Intention :** expliquer qui a fait quoi et pourquoi. UC O05/C04/M05. B09.

**Composition :** filtres type/date/objet/acteur autorisé ; événements signal/tâche/avis/décision/publication ; liens de causalité ; distinction date d’événement/date de réception ; versions. Les conversations privées ne figurent pas par héritage des droits owner.

**Actions :** ouvrir objet ou comparaison, rejoindre carte pour un événement publié, préparer correction compensatrice si autorisé. Aucune réécriture historique. Pagination stable par événement ou publication ; notification « nouvel événement disponible » sans déplacer la lecture. Mobile : chronologie verticale ; labels d’acteur/effet toujours visibles.

## E19 — Explorer le savoir et sa carte

**Intention :** comprendre le contexte d’une tâche. UC V03/C02/O05. B08.

**Composition :** recherche, version/période, mode synthèse/changements, carte avec niveaux de détail et positions stables ; liste équivalente ; Chronique liée ; fiche de sélection. Légende distingue relations validées et références documentaires. Le mock représente un petit schéma synthétique ; ce n’est pas une implémentation ni qualification du moteur spatial.

**Actions :** sélectionner, lire preuve, trouver voisinage, zoomer/déplacer, filtrer le journal et retour à la tâche. Navigation continue et progressive du cahier BrainMap conservée comme cible. Aucun détour obligatoire par la carte pour agir sur une tâche. Mobile : voisinage puis détail, liste accessible ; pas de mise à l’échelle de tout le bureau.

## E20 — Objectifs, couverture et revues

**Intention :** définir ce qui doit être connu, pas compter simplement les concepts. UC O04/O03. B07/B09.

**Composition :** thèmes attendus, responsable de revue, prochaine échéance, questions attendues, questions vérifiées, résultats/versions ; thèmes sans définition distincts ; activité publiée sur période séparée. **Actions :** préparer objectif, modifier par révision, confier revue, ouvrir les questions manquantes. Pas de pourcentage de couverture quand dénominateur absent. Mobile : un thème par bloc et listes de questions en détail. **Sortie :** objectif gouverné, prochaine action et propriétaire de suivi.

## E21 — Équipe et accès

**Intention :** gérer responsabilités sans créer d’accès implicite. UC O06/T03. B01/B02.

**Composition :** memberships autorisés, rôles cumulés, périmètre, état ; détails d’un changement avec tâches qui deviendraient orphelines. Pas de liste de personnes hors tenant ou de sources interdites. **Actions :** préparer ajout/changement, prévisualiser effet, confirmer suivant politique ; refus clair en cas de dernier owner ou invariants de séparation. Le réglage global reste réservé à l’admin ; le domaine reste sous responsabilité owner. La maquette n’exécute aucun changement. **Sortie :** reçu audité et file des tâches à réaffecter.

## E22 — Mission et exécution d’agent

**Intention :** suivre une délégation limitée. UC A01/A02/M02/O03. B10.

**Composition :** mandat, périmètre, outils autorisés, fournisseur autorisé ou « Aucun », budget plafond/consommé mesuré, critères, état, dernier événement, rapport/preuves. Les hypothèses sont identifiées. **Actions humaines :** préparer mandat, lancer selon droit, demander arrêt, reprendre après vérification, examiner rapport. **Actions agent MCP :** réclamer le bail, renouveler, joindre résultats, rendre la main. Publication/avis humain indisponibles à l’agent. **Sortie :** rapport ou limite ; aucune décision simulée comme humaine.

## E23 — Connexions MCP et parcours viewer

**Intention :** établir et tester le parcours Q+F+S, sans forcer l’usage de la console. UC V01–V06/T01. B08.

**Deux lectures liées :** l’admin voit configuration nommée, client/version/transport, identité, capacités demandées/accordées et test synthétique ; le viewer voit aide courte et parcours exemple question → citation → feedback → reçu → suivi. L’exemple de chatbot n’est pas une nouvelle surface de conversation produit.

**Actions :** tester compatibilité, lire guide « Consulter et citer », « Signaler », « Suivre » ; régler observations facultatives séparées du partage. Les champs d’intégration techniques restent dans l’administration, jamais dans la conversation quotidienne. Client sans push → suivi par lecture ; sans feedback/suivi → compatibilité partielle, pas certification complète. Une erreur de connexion explique identité, transport ou capacité, sans afficher le secret. **Sortie :** diagnostic et capacités réellement testées, pas « tous les chatbots supportés ».

## E24 — Exploitation, incidents et configuration

**Intention :** rétablir le service sans disposer automatiquement du corpus. UC T02/T03. B11/B12.

**Composition :** fraîcheur des sondes, disponibilité des composants, incidents, traitements échoués, sauvegarde/restauration et preuves de dernier exercice ; configuration non secrète ; identités de service et mandat. Un état non mesuré est « Inconnu ». Pas de contenu documentaire dans les logs visibles.

**Actions :** diagnostiquer incident, consulter corrélation et code d’erreur, préparer reprise ciblée, tester configuration, confirmer une modification avec effet attendu. Restauration est un runbook contrôlé avec contrôle de cohérence ; ne pas exposer un bouton magique. Les détails techniques se déplient pour éviter d’occuper tous les accueils. Mobile : diagnostic et lecture, confirmations complètes si nécessaires. **Sortie :** incident suivi, reçu technique et prochain contrôle.

## E25 — Recherche contextuelle

**Intention :** retrouver un objet sans parcourir une carte. UC C01/C02/V03/O05. B01/B08/B09. Champ nommé, périmètre et mode de recherche déclarés ; résultats regroupés par type, titre, état, version et raison de correspondance lorsqu’elle existe. Entrée déclenche la recherche ; chargement annulable ; filtres et retour conservés. Aucun résultat interdit ni suggestion qui révèle son existence. Zéro résultat propose reformulation/effacement, sans créer automatiquement une lacune. Mobile : un résultat par bloc, label de type toujours visible. **Sortie :** objet autorisé dans son contexte d’origine.

## E26 — Boîte de réception personnelle

**Intention :** distinguer ce qui est nouveau de ce qui exige une action. UC C01/C04/M05/V06. B02/B03/B09. Notifications dédupliquées d’affectation, demande de revue, précision, décision et résolution ; date, objet, attente et lien direct. Lu/non lu est un état de lecture, séparé de l’état de tâche. Marquer lu ne vaut ni acceptation, ni approbation, ni clôture. Les droits sont relus à chaque affichage ; contenu retiré masqué. Les viewers retrouvent ces informations via MCP sans obligation de console. Mobile : mêmes actions, aucune information essentielle uniquement dans un badge numérique. **Sortie :** dossier ouvert ou lecture marquée, événement métier inchangé.

## Comportements partagés à ne pas oublier

Les formulaires de brouillon, mission, feedback, avis, référence et configuration conservent leurs erreurs et valeurs lors d’un réessai autorisé. Toute validation de champ est également réalisée côté serveur. Les erreurs de droit ne servent jamais à deviner l’existence d’un objet interdit. Toute navigation déclenchée dans un panneau comporte un retour nommé et conserve l’origine. Les alternatives de disposition dans la maquette ne constituent pas des variantes de droits.
