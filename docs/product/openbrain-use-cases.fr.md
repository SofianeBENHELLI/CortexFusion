# Open Br**AI**n — cas d’usage et contrats d’expérience

Version de travail du 16 octobre 2026, fondée sur la demande directe de Sofiane.

**Statut : cadrage produit, avant refonte de l’interface.** Ce document fixe les besoins exprimés et propose une répartition opérationnelle. Il ne déclare aucune nouvelle capacité livrée. Il remplace, pour le prochain travail UX, l’hypothèse d’un accueil universel centré sur BrainMap. Les preuves et limites techniques antérieures restent valides. L’UI/UX reste ouverte ; les Représentations différées ne sont pas traitées ici.

## 1. Objectif et décisions de cadrage

Open Br**AI**n sert une connaissance collective sourcée et organise son amélioration. Son interface de gestion doit répondre immédiatement à quatre questions : dans quel périmètre suis-je, qu’attend-on de moi, qu’est-ce qui bloque, quelle action puis-je entreprendre ?

Décisions exprimées par Sofiane :

- Conserver les rôles existants : administrateur global/technique, owner de domaine, corpus manager, contributeur, viewer, agent. Ne pas ajouter de rôle « reviewer » : la revue est une mission attribuée.
- Permettre de cumuler des rôles. À l’entrée dans la plateforme, choisir le rôle et le périmètre de travail autorisés.
- Le viewer utilise son propre chatbot, avec son propre LLM, connecté en MCP. Il ne doit pas avoir besoin de la console pour consulter, comprendre ses preuves ou donner un feedback.
- MCP est le protocole d’intégration retenu ; aucun chantier A2A.
- Le contributeur utilise à la fois son chatbot et la plateforme. Contributeur, corpus manager et owner ont chacun un accueil orienté responsabilités, tâches et actions.
- Organiser l’expertise, la délégation, les signaux, les contrôles de qualité, les questions de référence, l’historique et la supervision.
- Définir les cas d’usage avant de dessiner ou modifier les écrans.

Interprétations proposées pour rendre cette cible cohérente :

1. Le **corpus manager pilote l’exécution quotidienne** : documents, signalements partagés, affectation aux experts, contrôles et préparation des décisions.
2. L’**owner porte la responsabilité du domaine** : objectifs de couverture, priorités, arbitrages, autorisations, décisions finales et publication. Il supervise un ou plusieurs domaines pour lesquels il est owner, sans droit implicite sur les autres.
3. L’**administrateur global pilote le service** et ses intégrations. Son statut ne lui attribue pas automatiquement l’approbation métier de tous les domaines.
4. Un contributeur assigné comme reviewer **rend un avis d’expert**. Cet avis ne devient pas une approbation ou publication owner. La possibilité de lui déléguer ultérieurement une décision finale nécessiterait une politique séparée ; elle n’est pas présumée ici.

La formulation orale croise parfois supervision documentaire et responsabilité de domaine. La séparation ci-dessus est une proposition explicite, pas une modification silencieuse des droits existants.

## 2. Entrer et choisir son contexte

Après identification — ou restauration de l’accès personnel local — l’utilisateur voit les rôles et domaines auxquels il a effectivement accès, avec leur description et les actions correspondantes. Il choisit son espace de travail ; ce choix ne crée ni rôle ni permission.

| Situation | Comportement cible |
|---|---|
| Plusieurs rôles/domaines | Choisir une responsabilité et un périmètre ; conserver un sélecteur visible pour en changer. |
| Un seul rôle/périmètre | Présenter clairement ce contexte ; permettre une entrée directe mémorisée, sans formulaire technique. |
| Rôles cumulés | Une vue principale par responsabilité, avec accès aux autres espaces autorisés ; une tâche commune garde un seul identifiant et un seul état. |
| Retour régulier | Retrouver le dernier contexte autorisé et les tâches en cours ; le contexte reste visible. |
| Lien direct vers une tâche | Ouvrir la tâche dans son contexte après vérification ; proposer le bon espace sans perdre le lien. |
| Droits retirés | Masquer immédiatement les contenus concernés et expliquer l’indisponibilité ; proposer un autre périmètre autorisé. |
| Aucun accès | Expliquer comment demander un accès, sans afficher les noms ou compteurs des domaines interdits. |
| Viewer arrivant sur le site | Orienter vers la connexion MCP et l’aide ; aucune obligation d’utiliser un tableau de bord de gestion. |

L’affichage d’un rôle sélectionné ne remplace pas l’autorisation serveur. Les actions sensibles affichent l’identité, le domaine et l’effet avant confirmation. Pas de choix d’identité agent dans le sélecteur d’un humain : les agents ont des identités de service propres.

**Écart actuel :** l’identité expose un champ `role` par membership et des capacités conditionnelles. Le cumul explicite sur un même domaine et l’administration globale nécessitent un contrat d’autorisation et une migration étudiés ; ils ne se résument pas à ajouter un menu. Les hiérarchies de capacités déjà présentes ne prouvent pas un modèle multi-rôle complet.

## 3. Responsabilités, canaux et accueils

| Acteur | Question à laquelle son accueil doit répondre | Canal principal | Actions prioritaires |
|---|---|---|---|
| Viewer | « Quelle réponse fiable puis-je utiliser ? » | Son chatbot → MCP | Questionner, préciser, consulter les preuves, contester, suivre son signalement. |
| Contributeur / expert | « Que dois-je examiner ou améliorer ? » | Console + chatbot/MCP | Ouvrir mes tâches, donner un avis, proposer une correction, répondre à une demande de modification. |
| Corpus manager | « Où le travail sur mon corpus est-il bloqué ? » | Console ; mêmes opérations métier accessibles en MCP à terme | Qualifier et affecter, gérer les documents, lancer des contrôles, suivre les retards, préparer une décision. |
| Owner de domaine | « Puis-je faire confiance à mon domaine et que dois-je décider ? » | Console ; MCP selon droits et confirmation | Arbitrer, déléguer, valider, publier, suivre qualité, risques, couverture et historique. |
| Agent / assistant IA | « Quelle mission autorisée puis-je exécuter ? » | MCP, sans écran humain à parcourir | Lire une mission, analyser dans son périmètre, produire des preuves et propositions, signaler une limite. |
| Administrateur global/technique | « Le service et les intégrations fonctionnent-ils correctement ? » | Console d’administration | Identités, connexions MCP, configuration, incidents, exploitation et audit technique. |

La carte et la Chronique deviennent des moyens de comprendre une tâche, un changement ou une zone du savoir. Elles restent accessibles pour explorer, mais ne sont plus le passage obligé pour savoir quoi faire. Cette décision ne supprime ni la caméra continue ni les travaux existants.

## 4. Catalogue des cas d’usage

Chaque ligne décrit une cible. Les références d’opérations dans la section 10 décrivent seulement les fondations existantes.

### Viewer — tout le parcours dans son chatbot

| ID | Déclencheur et intention | Interaction et résultat attendu | Cas à traiter |
|---|---|---|---|
| V01 | « Je veux utiliser la base de mon équipe. » | Connecter le serveur MCP avec son identité ; découvrir les domaines et usages autorisés ; choisir un domaine par nom. | Session expirée, client incompatible, domaine absent ; aucune saisie d’UUID métier à chaque question. |
| V02 | « Quelle procédure s’applique à ma situation ? » | Poser la question naturellement ; obtenir une réponse structurée avec sources, passages, version servie, limites et éventuelle demande de précision. | Savoir absent, ambiguïté, contradiction, budget insuffisant ou service indisponible sont des résultats distincts. |
| V03 | « Pourquoi cette réponse ? Montre-moi la preuve. » | Demander les références, le passage exact, le contexte autorisé et les éventuelles divergences ; rester dans le chatbot. | Preuve révoquée ou historique non accessible : ne pas montrer un cache périmé comme accessible. |
| V04 | « C’est utile » / « Cette règle est fausse depuis juin. » | Le client transmet un feedback explicite relié à la réponse réellement affichée ; Open Br**AI**n rend un reçu et, selon qualification, un signalement à suivre. | Un commentaire ambigu n’est pas transformé arbitrairement en vote négatif ; une retransmission n’ajoute pas un doublon. |
| V05 | Reformulations, correction, abandon ou autres interactions autorisées | Un client instrumenté transmet des observations autorisées. Une analyse peut proposer une hypothèse et un élément à qualifier. | Consentement absent, signal indisponible ou estimation incertaine : aucune invention de comportement ou de satisfaction. |
| V06 | « Qu’est devenu mon signalement ? » | Lire son état et la réponse de l’équipe ; obtenir la correction publiée et ses preuves lorsqu’elle existe. | Ne pas exposer les notes internes, les autres utilisateurs ou les documents auxquels le viewer n’a pas accès. |

Le LLM du chatbot peut reformuler les résultats. Il faut distinguer la preuve retournée par Open Br**AI**n et la réponse effectivement montrée au lecteur. Un feedback sur une synthèse erronée ne prouve pas que le corpus est faux. Les reçus de réponse servent à conserver cette distinction lorsque le client les prend en charge.

### Contributeur — produire une amélioration ou un avis

| ID | Déclencheur et intention | Interaction et résultat attendu | Cas à traiter |
|---|---|---|---|
| C01 | Une tâche m’est affectée ou je reprends mon travail | Consulter « Mes tâches » : motif, demandeur, priorité, ancienneté, échéance, objets et preuves ; accepter, refuser avec motif ou demander une précision. | Absence de droits sur une preuve, mauvaise expertise, indisponibilité ; pas d’affectation silencieuse impossible à réaliser. |
| C02 | « Je sais comment corriger ce point. » | Depuis une tâche ou spontanément, comparer l’existant, citer une source, proposer un changement et son impact ; soumettre puis suivre. | Conflit de révision, travail concurrent, manque de source ; conserver le brouillon sans publier automatiquement. |
| C03 | « On me demande une revue d’expert. » | Lire le changement et ses preuves, comparer aux questions de référence, rendre un avis argumenté ou demander une modification. | Avis favorable ≠ publication ; désaccords visibles ; l’auteur et le reviewer restent identifiés. |
| C04 | « Mon avis ou ma proposition a reçu une réponse. » | Retrouver la demande précise, réviser, resoumettre et suivre jusqu’à publication, rejet ou report. | Une nouvelle révision ne conserve pas une approbation devenue périmée ; reprise après interruption sans doublon. |

Le contributeur peut effectuer ces actions depuis le chatbot ou ouvrir un lien direct vers le dossier dans la console. Il n’a pas à retrouver le concept dans une carte pour commencer. Le dépôt de nouveaux documents reste une responsabilité de corpus manager/owner dans le contrat actuel ; le contributeur peut demander cet ajout.

### Corpus manager — organiser le travail et la qualité opérationnelle

| ID | Déclencheur et intention | Interaction et résultat attendu | Cas à traiter |
|---|---|---|---|
| M01 | Un signal partagé arrive ou une file vieillit | Trier les signaux, rapprocher les doublons sans perdre les événements, qualifier l’impact, demander du contexte et transformer en tâche. | Signal personnel non partagé, données restreintes, cause liée au chatbot plutôt qu’au corpus. |
| M02 | « Il faut que l’expert examine ce problème. » | Choisir un expert autorisé, préciser mission/échéance/critères de sortie, affecter ; suivre acceptation, blocage et retard ; réaffecter avec motif. | L’affectation ne donne pas accès aux sources ; un problème de droits passe par l’owner. |
| M03 | « Une source a changé ou un import a échoué. » | Ajouter/mettre à jour un document dans sa collection, voir progression et erreurs, relancer les éléments nécessaires ; examiner l’impact avant proposition. | Fichier en doublon, version remplacée, traitement partiel, annulation ; conserver source et provenance. |
| M04 | « Est-ce que les réponses restent correctes ? » | Préparer une banque de questions et critères, lancer les contrôles autorisés, lire les écarts et créer des tâches de diagnostic. | Une réponse attendue doit être approuvée/versionnée ; une évaluation générée ne devient pas arbitrairement la vérité. |
| M05 | « Que faut-il faire avancer aujourd’hui ? » | Consulter non-affectés, tâches bloquées, délais, imports en erreur, contrôles échoués et propositions prêtes pour l’owner ; agir depuis chaque résultat. | Un compteur mène aux éléments qui le composent ; absence de mesures affichée comme inconnue. |

La délégation et la qualification partagée proposées ici sont de nouvelles capacités métier à définir pour ce rôle. Elles n’étendent pas sa capacité actuelle à approuver ou publier.

### Owner — superviser, arbitrer et engager le domaine

| ID | Déclencheur et intention | Interaction et résultat attendu | Cas à traiter |
|---|---|---|---|
| O01 | « Où en est mon domaine ? » | Voir les décisions en attente, risques, couverture, contrôles, évolution des sujets, charge et anciens signaux non traités ; descendre jusqu’aux preuves. | Plusieurs domaines : agrégation limitée aux droits, dénominateurs explicites, aucune lecture des conversations privées. |
| O02 | « Cette correction peut-elle être publiée ? » | Examiner différence, sources, avis d’expert, contrôles et conflits ; approuver, refuser, demander modification ou différer ; publier avec confirmation. | Révision/version modifiée, preuves retirées, résultat de publication incertain : relire l’état durable avant toute reprise. |
| O03 | « Ce domaine doit être revu avant une échéance. » | Définir objectif et priorité, déléguer le pilotage au corpus manager ou une expertise à un contributeur, suivre l’avancement et arbitrer les blocages. | Délégation de travail ≠ délégation implicite du pouvoir de publier. |
| O04 | « Que doit-on savoir et comment le vérifier ? » | Définir les thèmes attendus, faire valider les questions/réponses de référence et critères ; comparer les résultats par version et exiger un diagnostic des régressions. | Un thème stable n’est pas nécessairement abandonné ; un thème actif n’est pas nécessairement fiable. |
| O05 | « Qui a changé quoi et pourquoi ? » | Relier signal, tâche, proposition, avis, décision et publication ; identifier auteur et dates ; préparer une correction compensatrice si nécessaire. | Consulter l’historique ne permet pas de réécrire le passé ; un brouillon en cours n’est pas un changement publié. |
| O06 | « Qui intervient sur ce domaine ? » | Gérer les responsabilités et accès selon politique ; vérifier que les tâches restent réalisables après changement de droits. | Traiter les tâches orphelines et retirer les résultats devenus interdits ; pas de comptes privés exposés par agrégation. |

### Agent et administrateur

| ID | Acteur et intention | Interaction et résultat attendu | Limite |
|---|---|---|---|
| A01 | Agent : traiter une mission bornée | Récupérer une tâche autorisée, annoncer prise en charge, analyser, produire preuves/rapport/proposition et restituer état/coût/limites. | Pas d’auto-attribution de privilèges, de faux avis humain ni de publication autonome présumée. |
| A02 | Agent : exécuter une surveillance ou un contrôle programmé | Selon mandat, détecter doublons/contradictions candidates, écarts de sources ou tests échoués ; déposer les résultats à qualifier. | Hypothèse ≠ fait ; exécution traçable, budget et arrêt/reprise définis ; fournisseur autorisé seulement. |
| T01 | Admin : connecter un chatbot ou un système | Configurer MCP, identité, périmètres et capacités ; tester la connexion avec données synthétiques et rendre un diagnostic lisible. | Compatibilité validée par client ; pas de promesse « tous les chatbots » sans adaptation ni test. |
| T02 | Admin : exploiter et diagnostiquer | Suivre disponibilité, erreurs, files techniques, traitements, sauvegardes et restaurations ; agir sur incidents. | Les journaux techniques ne doivent pas devenir un dépôt de conversations ou de sources privées. |
| T03 | Admin : administrer le service | Gérer configuration globale, identités de service, intégrations et politiques techniques ; auditer les opérations. | Le périmètre exact global/tenant doit être contractualisé avant implémentation ; pas de super-owner métier implicite. |

## 5. La boucle de travail commune

```text
Question dans le chatbot → réponse et preuves → feedback/observation
  → qualification du signal partagé → tâche et affectation
  → expertise → proposition sourcée → avis → décision owner
  → publication → recontrôle → retour au déclarant autorisé
```

Cette boucle n’est pas obligatoire pour chaque événement. Un signal peut concerner la synthèse du chatbot, les droits, un manque de contexte ou un incident technique. La qualification peut demander une précision, rapprocher un doublon, réorienter ou conclure sans modification du savoir. La clôture garde sa raison.

Objets à distinguer :

| Objet | Rôle |
|---|---|
| Signal | Observation ou avis avec origine, cible et provenance ; n’attribue pas de travail à lui seul. |
| Dossier partagé | Vue de traitement autorisée d’un ou plusieurs signaux, séparée des échanges personnels. |
| Tâche | Travail attendu, responsable, état, échéance et critère de sortie ; peut exister sans feedback initial. |
| Proposition | Changement concret versionné à instruire ; une tâche peut n’en produire aucune ou plusieurs. |
| Avis d’expert | Appréciation argumentée sur une révision précise ; ne vaut pas approbation finale. |
| Décision/publication | Autorisation et résultat durable du changement ; deux étapes distinctes. |
| Contrôle | Question/critère, version testée, résultat, preuves et limites de l’évaluation. |

Une tâche possède au minimum : identifiant, domaine/corpus, type, origine, objet concerné, demandeur, assigné, priorité motivée, dates de création/affectation/prise en charge, échéance éventuelle, dernière activité, blocage, preuves accessibles, résultat attendu et liens aux propositions/contrôles. Les timestamps sont des événements conservés, pas des champs réinitialisés à chaque réaffectation.

Cycle proposé : **à qualifier → à affecter → proposée à un responsable → en cours → en attente de revue → terminée**. Les états **bloquée, annulée** et la **réouverture motivée** sont explicites. La raison de clôture distingue notamment correction vérifiée, doublon, non-reproductible, hors périmètre et absence de changement nécessaire. Les états d’une proposition et d’une publication restent séparés de ceux de la tâche.

Chaque transition a un acteur autorisé, une révision attendue et un événement durable. Deux personnes ne peuvent pas s’attribuer silencieusement la même tâche. Une action répétée après perte de réponse retrouve son résultat ; un conflit conduit à relire. Une affectation refusée revient dans la file de pilotage.

## 6. MCP : une boucle complète, avec un client participant

« Bidirectionnel » signifie ici deux besoins distincts : le client demande du savoir et renvoie du feedback ; Open Br**AI**n peut aussi rendre l’évolution d’un dossier accessible au client. Le premier fonctionne avec des appels d’outils dans les deux usages. Le second demande une lecture de suivi et, si les capacités négociées le permettent, des notifications. Ne pas conditionner le parcours minimal à un canal push universel.

La spécification MCP distingue hôte, client et serveur ; l’historique complet reste côté hôte et les fonctions sont négociées. Le serveur ne voit donc pas automatiquement les scrolls, messages ou abandons dans une autre application. Le client doit observer et transmettre les événements autorisés. Source : [architecture MCP, version 2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/architecture), version correspondant au serveur local actuellement documenté. Cela n’impose pas une migration vers un autre protocole pour ce cadrage.

Contrat produit à couvrir :

| Famille | Ce que le client doit pouvoir faire |
|---|---|
| Découvrir | Lire identité, périmètres, capacités et instructions d’utilisation, avec des noms compréhensibles. |
| Consulter | Questionner, préciser, lire les preuves et distinguer réponse/abstention/limite technique. |
| Relier | Garder l’identifiant d’épisode, la version et, si conservé, le reçu de la réponse du chatbot. |
| Remonter | Envoyer vote/commentaire, observation autorisée ou estimation séparément ; recevoir un accusé durable. |
| Suivre | Lire ses dossiers, leur résolution et les nouvelles preuves autorisées ; recevoir une notification si disponible. |
| Contribuer et gérer | Pour les autres rôles : tâches, avis, propositions, imports, contrôles et décisions selon capacités ; mêmes règles que dans la console. |

Les **skills d’usage** demandés sont une cible de documentation et d’intégration : « Consulter et citer », « Signaler une erreur », « Traiter ma tâche », « Proposer une correction », « Examiner un domaine ». Chaque guide devra préciser intention, prérequis, enchaînement d’outils, données minimales, effets, confirmation éventuelle, reprise et exemples synthétiques. Ce lot ne crée pas encore ces skills.

Les descriptions d’outils portent les règles indispensables ; les ressources et prompts MCP peuvent exposer les guides. Les prompts sont des modèles d’interaction découvrables, pas une garantie que chaque chatbot charge automatiquement un fichier `SKILL.md`. Un paquet adapté au client peut compléter ce socle. Sources : [prompts MCP](https://modelcontextprotocol.io/specification/2025-03-26/server/prompts), [ressources MCP](https://modelcontextprotocol.io/specification/2025-03-26/server/resources).

Niveaux de compatibilité à publier par client : **Q** question/preuve ; **F** feedback explicite ; **S** suivi des signalements ; **O** observations optionnelles ; **N** notifications ; **G** gestion selon rôle. Un client Q ne doit pas être présenté comme couvrant toute la boucle viewer. Le client conforme minimal vise Q+F+S ; O/N restent négociés. Les opérations sensibles gardent une confirmation humaine authentifiée, jamais une simple instruction au LLM de « confirmer ».

## 7. Feedback implicite et travail collectif

Trois catégories restent séparées :

- **Explicite** : l’utilisateur vote ou exprime intentionnellement son avis, y compris dans une phrase.
- **Observé** : le client rapporte une interaction effectivement observée et autorisée, par exemple une reformulation.
- **Inféré** : une analyse estime un problème ou une satisfaction ; elle conserve méthode, version, explication et incertitude.

Un scroll n’est pas une preuve d’accord ou de désaccord. Le silence ne vaut pas validation. Les types observés actuels ne comprennent pas le scroll : l’ajouter demanderait une définition, une instrumentation et une recette spécifiques. Ne pas transformer toutes les interactions en tickets.

La cible de triage regroupe les signaux pertinents et propose une priorité explicable par gravité, récurrence, ancienneté, usage et criticité du sujet. Les observations/inférences seules peuvent générer une **candidature à examiner**, pas une modification ou dégradation automatique du savoir. Les votes positifs restent utiles pour comprendre l’usage sans démontrer la vérité d’un concept.

**Frontière à construire :** aujourd’hui les signaux et issues sont personnels. Le backend interdit même à l’owner de lire ceux des autres. La nouvelle file d’équipe doit recevoir un dossier partageable, avec sa politique de visibilité, des extraits minimaux autorisés et les liens de preuve accessibles. On ne donne pas accès aux conversations privées pour alimenter un dashboard. La collecte automatique reste optionnelle et révocable ; le partage collectif a un contrat explicite distinct, une politique de conservation et une traçabilité des destinataires.

Le retour au déclarant est filtré dans l’autre sens : état et conclusion partageables, jamais l’intégralité du dossier interne. Le choix d’un LLM externe par un utilisateur ne constitue pas une autorisation générale d’y envoyer le corpus privé OKF ; aucun raccord réel ou transfert n’est exécuté dans ce lot.

## 8. Contrôles, indicateurs et décisions

Le contrôle du corpus sépare : intégrité documentaire (imports/sources), cohérence du savoir (contradictions candidates), qualité des réponses (questions de référence), couverture des besoins et qualité du traitement humain. Les tests techniques du backend ne prouvent pas la qualité métier.

Une banque de questions associe domaine/thème, question, réponse ou critères attendus, preuves, auteur, approbation, date et version. Un contrôle enregistre version du corpus, configuration du retrieval, client/modèle si évalué, méthode d’évaluation et résultat détaillé. Une comparaison n’est valable qu’à conditions identifiées. La correspondance textuelle exacte n’est pas le seul critère d’une réponse correcte ; un juge IA donne une estimation à qualifier, pas un verdict officiel automatique.

| Question du responsable | Mesure utile | Garde-fou d’interprétation |
|---|---|---|
| Que dois-je traiter ? | Tâches assignées, non affectées, en retard ou bloquées | Échéance et ancienneté sont distinctes ; chaque nombre ouvre sa liste filtrée. |
| Depuis quand attend-on ? | Temps depuis premier signal, qualification, affectation et dernière activité | Une fusion/réaffectation ne rajeunit pas artificiellement le problème. |
| Est-ce que cela fonctionne mieux ? | Réussites/régressions sur une banque versionnée | Afficher exécutées/attendues, ignorées, erreurs, méthode et résultats par question. |
| Couvrons-nous les besoins ? | Questions/thèmes attendus couverts et vérifiés | Dénominateur défini par l’owner ; nombre de concepts ≠ pourcentage de couverture. |
| Quels sujets bougent ? | Changements publiés, demandes et consultations autorisées par période | Séparer activité documentaire, travail en cours et savoir effectivement publié. |
| Quels sujets doivent être revus ? | Échéances de revue, sources modifiées, tests échoués, absence de preuve récente | Stabilité ≠ obsolescence ; aucune alerte de stagnation basée uniquement sur l’inactivité. |
| Qui travaille sur quoi ? | Affectations et états déclarés | Pas de prétendue présence en temps réel sans mécanisme dédié. |

Chaque indicateur indique périmètre, période, version pertinente, date de calcul, dénominateur et complétude. Les agrégats respectent les mêmes droits que leurs détails. Pas de score général de santé, de mémoire, d’archivage ou de sommeil tant que le mécanisme et la mesure n’existent pas.

## 9. Parcours de recette avant maquettes définitives

1. **Viewer, correction en langage naturel.** Question → preuve → « cette règle a changé » → reçu → dossier partagé autorisé → état visible dans le même chatbot. Vérifier aussi la cible réponse du chatbot versus passage Open Br**AI**n.
2. **Expert affecté.** Ouvrir sa tâche → comprendre le motif et l’échéance → lire les preuves → rendre un avis ou soumettre une proposition → retrouver la décision. Cas sans droits : blocage explicite, aucune fuite.
3. **Corpus manager, triage.** Deux signaux partageables liés au même problème → dossier commun conservant les deux événements → assignation → refus → réaffectation → suivi de l’âge initial.
4. **Owner, correction contrôlée.** Revue d’expert et test en échec → proposition → confirmation → publication → recontrôle → retour au viewer. Vérifier le conflit de version et la perte de réponse après publication.
5. **Contrôle de qualité.** Banque approuvée → exécution sur deux versions → amélioration et régression visibles séparément → tâche dédiée pour la régression ; aucune clôture par simple taux global.
6. **Multi-rôle.** Changer de responsabilité ou de domaine → tâches pertinentes et actions autorisées ; une tâche commune n’est pas dupliquée et un lien direct conserve son contexte.
7. **Agent.** Mission autorisée → résultat sourcé → tâche en attente humaine ; tentative d’auto-approbation refusée, interruption reprise sans double exécution.
8. **Intégration.** Un client sans télémétrie ni notifications réalise Q+F+S ; un autre client compatible transmet les seules observations autorisées. Refus de collecte respecté, relecture de suivi possible sans push.

Avant validation UX, faire expliquer à un utilisateur de chaque rôle sa prochaine action sans formation. Objectif proposé : identifier rôle/périmètre et action utile en dix secondes ; ce seuil reste à tester, il n’est pas un résultat observé. Ensuite vérifier desktop/mobile, clair/sombre monochrome, clavier, état vide, chargement, erreur, droits perdus et reprise sur données synthétiques. Zéro scénario exécuté dans ce lot de conception.

## 10. Fondations existantes et écarts

| Besoin | Fondation constatée | Travail restant |
|---|---|---|
| Identité et rôles | `/v1/me`, membership avec un rôle, capacités configurées | Cumul explicite, choix d’espace, contrat admin global et migration sans élévation implicite. |
| Consultation MCP et preuves | `knowledge.query`, épisodes, sources, façade MCP, compagnon de référence | Parcours client tiers qualifié, découverte compréhensible et skills adaptés ; qualité des réponses à qualifier. |
| Feedback explicite/observé/inféré | Contrats d’origine, préférences, reçus idempotents et résumés personnels | Instrumentation des clients, éventuels nouveaux événements, qualification et retour collectif. |
| Signalement | Issues personnelles ; vote négatif explicite crée un `disputed_answer` | Dossiers partagés, regroupement, routage et visibilité par rôle. |
| Contribution et revue | Propositions/diffs/révisions ; revue/approbation/publication owner | Tâches assignées, avis d’expert distinct, délégation, confirmation et cycle frontend complet. |
| Gestion documentaire | Collections, fichiers, imports/retry ; console de suivi partiel | Parcours opérationnel complet et lien documentaire → tâches → propositions. |
| Supervision | Versions et journal de publication ; lectures cartographiques | Projections métier de files, délais, couverture et contrôles respectant les droits. |
| Évaluation | Tests et évaluations synthétiques présents | Banque métier gouvernée, exécutions comparables et boucle de résolution produit. |

Références vérifiées : [interactions](../interaction-reference.md), [feedback](../feedback-loop.md), [reçus de réponses](../companion-responses.md), [compagnon](../reference-companion.md), [identité Rust](../../services/rust-core/src/server.rs), [contrats de membership](../../services/core/src/cortex_core/contracts.py), [audit](code-audit-2026-10-05.fr.md). Il s’agit d’une lecture ciblée, pas d’un nouvel audit exhaustif ni d’une recette.

## 11. Plan de refonte par dépendances

| Lot | Livrable | Condition de sortie et lien au plan existant |
|---|---|---|
| UX-01 — cadrage, présent document | Cas d’usage, responsabilités, canaux, objets et limites | Répartition corpus manager/owner et distinction avis/décision clairement examinables ; aucune maquette présentée comme validée. |
| UX-02 — contrats structurants | Identité multi-rôle, périmètres, dossier partagé, tâches, avis et banque de questions | Transitions/droits/provenance, idempotence, concurrence, consentement et reprises spécifiés ; complète AUD-01/05/17. |
| UX-03 — parcours viewer MCP | Q+F+S, guides d’usage et matrice de compatibilité ; O/N optionnels | Un client réellement testé de bout en bout sur données synthétiques ; complète AUD-25 et les travaux de qualité. |
| UX-04 — parcours contributeur | Mes tâches → dossier → avis/proposition → suivi | Un problème réel synthétique traité sans chercher son chemin dans BrainMap ; dépend UX-02 et AUD-05. |
| UX-05 — corpus manager et owner | Triage/affectation, pilotage, contrôles, décision/publication | Boucle complète avec revue d’expert, recontrôle et retour déclarant ; responsabilités distinctes, dépend UX-02/04 et AUD-17. |
| UX-06 — agents et exploitation | Missions bornées, exécutions observables, intégration et administration | Aucun pouvoir implicite de publication ; coûts/échecs/reprises explicites et recettes d’intégration. |

Le [dossier UX/UI détaillé](openbrain-ux-ui-spec.fr.md) capitalise désormais cette analyse, les26 écrans et les besoins UX-02, avec une maquette navigable. La prochaine étape est d’examiner les arbitrages et de tester la compréhension des parcours avant de recoder l’interface. L’administration et les évaluations ne sont pas oubliées, mais ne doivent pas retarder la définition de la boucle minimale consultation → signal → tâche → amélioration.

Les chantiers de fiabilité, droits, provenance, qualité de retrieval et performances restent nécessaires et ne sont pas annulés. Les lots AUD/BRN existants gardent leurs preuves ; l’ordre UX de la roadmap doit désormais partir de ces usages. Aucun écran applicatif, schéma, droit ou service n’est modifié par ce document.


## 12. Capitalisation du 16 octobre 2026

L’[analyse interactive des rôles et UC](mockups/openbrain-users-use-cases.html) et sa source sont conservées dans le dépôt. L’état reçu de l’atelier indiquait le contributeur/C01, sans choix d’arbitrage ; il ne constitue aucune approbation. Le [dossier détaillé](openbrain-ux-ui-spec.fr.md) fait la distinction entre exigences directes, propositions et capacités existantes. Il précise que la qualification appartient au dossier partagé, puis qu’une tâche est créée/affectée : la phase visuelle « à qualifier » du cadrage initial ne doit pas devenir un second état contradictoire de tâche.
