# ADR 0006 — Lecture étendue et bornée de la Chronique

Date : 2 octobre 2026. Statut : implémenté ; agrégation serveur et qualification de charge ouvertes.

## Problème

Une page de vingt publications peut cacher le début d’une période courte. La frise doit alors rester partielle, même lorsqu’un petit historique complet pourrait être lu. Accumuler des pages déjà mises en cache mélangerait leurs observations de droits et de versions. Augmenter la profondeur sans budget aggraverait aussi le coût des différences denses.

## Décision

La console propose vingt publications par défaut, ou une lecture étendue à cinq pages serveur de vingt publications au maximum. `history_pages=5` conserve ce choix dans l’URL. La pagination existante continue après cette fenêtre ; une nouvelle fenêtre ne réutilise pas les différences de la précédente. Aucun nouveau contrat ou mécanisme métier n’est introduit.

- Une seule version publiée et une seule fenêtre de dates sont utilisées pour toutes les pages. Les continuations doivent décroître strictement. Le scan s’arrête à cinq pages, même lorsque des pages sont vides à cause des droits. Le serveur borne déjà chaque scan à cent entrées ; la profondeur choisie n’autorise pas un parcours illimité.
- Quatre différences compactes au maximum sont lues simultanément. Le transport lit le flux UTF-8 avec une limite de **1 000 000 octets par réponse** et un budget partagé de **8 000 000 octets** pour les pages du journal, leurs différences et leurs relectures de contrôle. Il compte les octets effectivement lus, même sans `Content-Length` fiable, et refuse un document tronqué. Le dépassement annule les requêtes restantes et masque toute l’observation.
- Le modèle admet au plus **10 000 événements dérivés**. Depuis le 4 octobre, il s’arrête avant la première publication qui dépasserait ce budget et propose une continuation exclusive `sequence + 1`, sans fractionner ni ignorer cette publication. Ses titres/preuves ne sont pas ajoutés à la page courante. Une publication dépassant seule la limite reste refusée. Une annulation est demandée à **45 secondes** pour toute l’observation, en plus du délai de chaque requête. La navigation annule également la lecture abandonnée.
- Après les différences, chaque page de publications est relue et comparée à ses métadonnées initiales. Cette étape peut détecter un changement d’accès à une preuve historique alors que le graphe courant n’a pas changé. Les vérifications finales de version et de visibilité du graphe restent actives. Il n’existe pas de transaction globale entre ces requêtes ; les droits sont ceux des lectures successives, et les sources sont encore relues sur consultation.
- La couverture devient complète seulement si la lecture commence à la première page, atteint la fin des publications accessibles de la période et ne rencontre aucune publication sans date auditée. Au-delà des bornes, les compteurs restent partiels avec une continuation. Une erreur ou un dépassement ne produit jamais un compteur partiel présenté comme un succès complet.

## Limites et suites

Ces bornes concernent la lecture cliente et les données admises dans son résultat. Un morceau de flux ou une réponse déjà en cours peuvent avoir été reçus avant l’annulation ; elles ne constituent pas un plafond absolu du trafic réseau, du travail serveur ou de la mémoire du navigateur. Les lectures du graphe et du détail ne consomment pas le budget JSON du journal. La préparation du snapshot complet et son coût restent distincts. Le transport paginé du 3 octobre est décrit dans [ADR 0007](0007-paged-snapshot-transport.md) ; ces bornes ne qualifient pas la capacité produit.

La sélection d’un événement peut relire la fenêtre étendue : aucun cache de droits durable n’est introduit. Une publication dont la différence dépasse à elle seule le budget reste indisponible dans cette vue, même en réduisant la profondeur. Il faut poursuivre l’agrégation et la pagination serveur pour dépasser ces limites. Une couverture complète sur vingt-cinq publications ne qualifie ni cent mille concepts ni une tendance comparative entre deux périodes.

## Validation

Tests du transport : UTF-8 coupé entre morceaux, octets réels, dépassements annoncés ou découverts en flux, budget partagé, JSON incomplet et annulation d’un corps bloqué. Tests du modèle : 25 publications complètes, borne à 100 sur un historique de 121, continuation sans doublon, cinq scans vides, refus après changement d’accès historique, absence de date, boucle de curseur, échec d’une différence, limite d’événements et délai global. Le composant conserve le choix dans l’URL et permet de revenir à vingt publications après un dépassement.

Recette CUA sur Rust/PostgreSQL/TerminusDB : vingt publications récentes partielles → mode étendu **25 publications / 27 événements** complètement parcourus ; création ancienne et preuve Unicode **0–92** consultables ; profondeur et sélection restaurées après reconnexion. Écran clair à **320 px** sans débordement de la page. Voir le [journal de livraison](../../product/brain-delivery-status.fr.md).


Amendement du 4 octobre, recette I10 : fixture native distincte de **200 concepts, 20 000 relations, huit publications et 20 200 événements**. Dépassement reproduit au navigateur avant correction ; après correction, trois fenêtres de 2/2/4 publications, 10 000/10 000/200 événements, continuation puis retour, mode étendu, 40 lignes DOM au maximum. Relation → carte → preuve de 600 caractères, clavier, clair 320/390 px et sombre 1280 px. Treize tests du journal passent, dont continuité sans doublon, exclusion des preuves différées, refus après recontrôle des droits et publication isolée trop grande. Suite console **245/30** et builds mock/API réussis. Cette preuve concerne un journal dense, pas 10 000 concepts.
