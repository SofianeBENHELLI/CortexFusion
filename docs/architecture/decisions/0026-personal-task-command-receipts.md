# Reçus personnels de commandes de travail

16 octobre 2026 — reprise en lecture, sans migration.

`task_receipts.list/read` expose les reçus immuables déjà enregistrés par `cf_task_commands`, strictement pour l’acteur authentifié dans le domaine. Owner, corpus manager et contributeur courants peuvent consulter leurs propres reçus ; être owner ne donne pas accès à ceux d’un autre acteur. Une identité sortie du domaine ou devenue viewer/agent ne les consulte plus. L’identifiant de commande ne vaut jamais autorisation.

Le reçu conserve action, résultat au moment de la commande, révision et date. La tâche peut avoir changé depuis : titre, révision et statut courants sont joints uniquement si elle est encore accessible (coordination ou affectation courante). Après refus d’affectation, le contributeur retrouve son propre reçu sans retrouver le titre ou le contenu de la tâche. Les consignes, motifs, extraits, résultats textuels et hash de demande restent absents. Cette lecture minimale reprend la faculté de récupération personnelle prévue par les reçus de tâches ; elle ne permet pas de réexécuter une commande devenue interdite.

Liste récente d’abord, pagination opaque15min liée au sujet, domaine, taille de page et versions travail/droits. Compte exact personnel. Un changement invalide le parcours au lieu de le faire dériver. La lecture peut écrire un curseur, jamais une transition ou une notification lue. Les reçus ne sont pas purgés automatiquement ; rétention globale et index de volumétrie restent à qualifier.

En cas de résultat inconnu dans la page ouverte, la console propose une vérification GET du même identifiant. Elle valide identité, action, cible, révision et résultat avant d’annoncer l’enregistrement. Aucun POST n’est envoyé par cette vérification. Un404, un refus, une erreur ou une réponse incompatible conserve l’incertitude : absence de reçu n’est pas preuve d’échec, l’appel initial pourrait encore aboutir. Le réessai exact existant reste disponible, volontaire et avec même charge/clé tant que la préparation est en mémoire.

Après rechargement, la liste permet de retrouver les actions enregistrées. **Elle ne reconstitue pas une préparation non enregistrée et ne persiste pas une commande encore inconnue.** Aucun corps de commande n’est stocké dans le navigateur ; la durabilité d’une intention en attente reste une tranche distincte. Une absence dans la liste ne doit jamais déclencher une nouvelle commande automatique.

UI et phrases guidées ouvrent la même lecture. Les identifiants techniques sont repliés sous « Références de cette action ». Les anciennes lignes sont masquées pendant relecture ou erreur. API/MCP/BFF bornés, pas de proxy générique. Recette de panne Chrome : réponse synthétique perdue après commit, puis GET seul et vérification du nombre de POST. Détails et limites dans lot17 du journal autonome.
