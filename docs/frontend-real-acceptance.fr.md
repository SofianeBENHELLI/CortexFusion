# Guide d’essai du frontend connecté

Le mode API utilise le backend Rust et son savoir publié. Le mode mock reste une démonstration indépendante : un parcours disponible dans le mock n’est pas automatiquement raccordé au backend.

## Démarrage et session

Depuis la racine du dépôt, après configuration du backend local selon `rust-start.fr.md` :

```sh
VITE_DATA_MODE=api CORTEX_API_TARGET=http://127.0.0.1:8011 pnpm --filter @cortexfusion/console dev --port 5174
```

Le port cible doit correspondre à votre instance ; l’origine `http://127.0.0.1:5174` doit être autorisée exactement côté Rust. Utiliser un JWT Cortex émis par l’autorité configurée et l’identifiant de tenant correspondant. Une clé de fournisseur de modèle ne remplace pas ce jeton. Ne placer aucun secret dans une variable `VITE_*`, Git ou un lien URL.

Le jeton reste en mémoire. Déconnexion/rechargement le retire ; une session invalide propose « Se reconnecter ». Le domaine est sélectionné parmi ceux retournés par `/v1/me`. Les versions acceptée et publiée sont affichées séparément. La préparation du frontend ne provisionne ni identité ni droits.

## Parcours disponibles et critères de recette

| Parcours | Actions | Résultat à vérifier |
| --- | --- | --- |
| Interroger | Créer/choisir une conversation, poser une question | Réponse extractive ou abstention ; version servie explicite ; aucune réponse issue d’un brouillon. |
| Consulter une citation | Déplier la source dans la réponse | Extrait, emplacement et positions ; source accessible selon les droits actuels. |
| Donner un retour | Ajouter un commentaire, choisir Utile/À améliorer | Reçu lié au bon épisode ; une reprise réseau conserve la même intention. |
| Retrouver un ticket | Actualiser les tickets et ouvrir un retour négatif | Réponse historique et sa version ; une ancienne réponse n’est pas recalculée silencieusement. |
| Traiter un ticket | Motif puis prise en charge/résolution/classement/réouverture | Révision et statut relus ; conflit demande actualisation. La résolution du suivi ne publie rien. |
| Préparer un ajout | Choisir une citation, titre et motif | Nouvelle proposition prête, preuve verbatim ; vigilance sur les doublons. |
| Corriger un titre | Charger les concepts publiés, choisir le concept, préciser titre/motif | Même identifiant, preuves et relations conservées ; proposition distincte, aucune publication immédiate. |
| Examiner une proposition | Ouvrir, comparer avant/après, lire preuve et décisions | État, base, révision et comparaison explicites ; avertissement si la base a changé. |
| Préparer une décision | Motif puis préparer la commande MCP | JSON exact pour l’hôte de confiance ; aucune signature ni exécution dans le navigateur. |

## Ce qui reste séparé ou incomplet

- La signature et l’exécution des décisions de proposition se font par l’hôte de confiance. Le frontend prépare les commandes de revue, pas un service de signature automatique. Approbation et publication restent deux actions distinctes.
- La correction du corps sourcé et des relations n’est pas éditable dans ces nouveaux formulaires. La référence ticket dans un motif n’est pas une liaison structurée automatique d’historique.
- La recherche actuelle est lexicale. Elle peut s’abstenir sur une formulation française pourtant couverte par une source anglaise. Les expérimentations locales de traduction/sélection ne sont pas activées dans le produit.
- Les imports, l’administration complète, le streaming et la parité visuelle avec le mock ne doivent pas être déduits de ces parcours. L’écran connecté demeure un espace fonctionnel de recette.
- Une intention de reprise est conservée en mémoire seulement : recharger la page la perd. Les reçus et décisions confirmés restent côté serveur.

## Niveau de vérification

Les tests de composants emploient des fixtures synthétiques et contrôlent les routes contre OpenAPI. Les tests Playwright du mock valident la démonstration, pas le corpus réel. Des recettes locales séparées ont exercé réellement Rust/PostgreSQL/TerminusDB à travers le navigateur : question/citation/feedback, consultation de propositions, historique de revue, tickets et correction de titre. Les fichiers de recette du corpus restent privés.

La revue Computer Use a vérifié l’écran de connexion, l’erreur401 et le retour au formulaire. Elle ne constitue pas encore une revue visuelle complète des écrans authentifiés ni de leurs variantes mobiles.

Voir aussi `frontend-issues.fr.md`, `frontend-proposals.fr.md`, `extractive-retrieval.fr.md` et `coordinated-restore.fr.md`.
