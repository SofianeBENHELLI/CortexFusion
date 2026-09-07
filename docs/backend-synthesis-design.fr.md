# Synthèse backend durable — contrat de réalisation

État : conception et fondations internes. Les routes décrites ci-dessous ne sont pas encore livrées et ne figurent pas dans le catalogue exécutable. Le frontend utilise actuellement la recherche JSON/SSE et les reçus de compagnon ; le compagnon CLI peut déjà produire une synthèse citée.

## Résultat recherché

Après une question enregistrée, le frontend ou un compagnon MCP demande au backend une synthèse fondée exclusivement sur les citations de cet épisode personnel. La clé OpenRouter reste côté serveur. Le résultat devient un reçu personnel consultable dans la timeline et ciblable par un retour utilisateur. Il ne modifie ni proposition ni connaissance publiée.

L'API doit distinguer une réponse extractive, une synthèse générée et une abstention déterministe. Vérifier les références exactes ne certifie pas l'exactitude sémantique de chaque phrase. Les échecs des évaluations IA antérieures restent valables ; ce chantier ne les efface pas.

## Choix retenus pour le premier incrément

- Activation explicite côté serveur, désactivée par défaut, avec modèle et clé OpenRouter configurés. Ne pas activer la synthèse simplement parce qu'une extraction est configurée.
- Tous les rôles membres peuvent demander une synthèse sur leur propre épisode autorisé ; la lecture des tentatives d'extraction reste réservée aux rôles existants. Le fournisseur reçoit uniquement la question et les extraits nécessaires, sans identité, titres/localisations superflus, historique entier ni outils exécutables.
- La commande indique explicitement `processing_destination=openrouter`. Elle exige une confirmation signée de l'hôte de confiance, selon le mécanisme HTTP/MCP déjà livré. Un nouveau type d'effet doit décrire une génération personnelle payante, sans prétendre créer une proposition.
- Une instance d'adaptateur par tentative conserve son usage et son diagnostic propres. Réutiliser le prompt cité v2 et les contrôles de l'adaptateur existant ; ne pas créer une deuxième implémentation de validation.
- Premier transport synchrone, borné par le délai fournisseur existant. Aucun streaming de tokens et aucune file de réessai automatique. Un client peut consulter le reçu de tentative indépendamment du POST en cours.

## Routes proposées, à vérifier pendant l'implémentation

| Interaction envisagée | Fonction |
|---|---|
| POST `/v1/domains/{domain}/episodes/{episode_id}/syntheses` | Réserver puis effectuer au plus une tentative pour une clé donnée ; retourner l'état durable |
| GET `/v1/domains/{domain}/syntheses/{ident}` | Consulter sa tentative et le lien vers sa réponse, sous droits actuels |
| GET `/v1/domains/{domain}/syntheses` | Retrouver ses tentatives par épisode ou clé après une perte de réponse, avec pagination |

Le corps contient une clé d'idempotence et la destination de traitement. La question, les citations et la version viennent de l'épisode enregistré, pas d'un corps libre envoyé par le client. Le modèle et la version du prompt utilisés sont mémorisés à la réservation. Une reprise doit consulter la tentative existante même si la configuration du modèle a changé depuis ; elle ne lance pas un autre modèle.

## État durable et reprise

1. Authentifier, vérifier l'épisode personnel et ses preuves, valider la destination et le budget d'entrée.
2. Sous verrou du domaine et après relecture de l'appartenance, chercher la clé : un autre contenu donne un conflit ; une clé connue retourne son état sans appel fournisseur.
3. Réserver une tentative dans PostgreSQL et confirmer cette transaction avant l'appel. Le compteur de quota doit additionner extraction et synthèse, sous le même verrou. Il compte les réservations potentiellement payantes, pas des dollars ni des appels effectivement facturés.
4. Recontrôler le jeton et les preuves juste avant l'envoi. L'autorisation porte sur les données préparées à cet instant ; des données déjà envoyées ne peuvent pas être rappelées chez le fournisseur. Ne pas tenir un verrou d'administration pendant toute la requête réseau.
5. Valider la sortie et ses références, puis recontrôler identité et droits avant conservation/livraison. Écrire le reçu de réponse et le résultat terminal dans une même transaction. Le helper interne de reçu doit conserver ses propres contrôles d'épisode et de références.
6. En cas d'échec, ne conserver qu'un code sûr, des diagnostics autorisés et un usage validé, jamais une sortie rejetée ou un raisonnement interne. Une réponse déjà conservée peut être relue sans appel modèle, sous droits actuels.

Sans résultat terminal, l'état `unresolved` indique « en cours ou résultat non établi », pas une autorisation de relancer. Une interruption après l'envoi peut avoir été facturée. Le même identifiant ne doit jamais rejouer cet appel. Une nouvelle tentative nécessite une nouvelle clé et une nouvelle intention confirmée ; le frontend ne doit pas l'automatiser. Un échec de persistance du résultat doit laisser une tentative consultable et empêcher un second appel silencieux.

Sans citation exploitable, produire une abstention déterministe sans fournisseur ni réservation payante. Ce reçu doit indiquer clairement qu'aucun modèle n'a répondu. La commande ne doit pas fabriquer une réponse lorsque le corpus est insuffisant.

## Lecture, confidentialité et cache

Tentatives et réponses restent personnelles même pour le propriétaire du domaine. Toutes les lectures, reprises et créations recontrôlent l'accès actuel à l'épisode. Le retrait d'accès masque les résultats concernés ; ne pas exposer des totaux ou erreurs détaillées permettant d'inférer un contenu privé.

Après succès, le frontend lit le reçu de réponse existant et invalide la timeline et les listes de réponses de l'épisode. Il peut ensuite envoyer un feedback ciblé sur ce reçu. Séparer la clé de la question, celle de la synthèse et celles du feedback. Arrêter le polling sur un état terminal ; une tentative durable non résolue ne doit pas tourner indéfiniment dans une boucle de relance.

## Preuves exigées avant livraison

Tests simulés : zéro appel si désactivé, sans confirmation, sans preuve, sans accès ou sans quota ; exactement un appel pour des requêtes concurrentes de même clé ; conflit si la clé est réutilisée pour un autre épisode ; quota commun extraction/synthèse ; résultat et reçu atomiques ; reprise après perte de réponse sans appel ; tentative incertaine non rejouée ; revalidation du jeton et des preuves ; retrait d'accès pendant le modèle ; diagnostic expurgé ; références rejetées ; compatibilité HTTP/MCP et isolation entre utilisateurs/tenants. Régénérer les contrats TypeScript et descriptions françaises uniquement quand les routes sont réellement présentes.

Aucun test payé n'est nécessaire pour implémenter ces garanties. Les démonstrations réelles ultérieures devront respecter le plafond fournisseur existant et utiliser un corpus synthétique tant qu'aucun corpus d'entreprise n'est désigné.
