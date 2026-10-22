# ADR 0012 — Plans SQL adaptés au périmètre de lecture

Date : 4 octobre 2026. Statut : accepté, qualification 10 000 encore ouverte.

## Constat

Une même requête préparée de fenêtre sert un domaine entier, une recherche ou un voisinage. Un plan PostgreSQL générique peut estimer les CTE de visibilité comme contenant une seule ligne et choisir des boucles imbriquées qui reparcourent ces ensembles pour chaque relation. Le problème ne se réduit donc pas à la quantité de JSON renvoyée au navigateur.

Sur le jeu synthétique conservé de 1 000 concepts/2 019 relations/v20, `EXPLAIN (ANALYZE, BUFFERS)` sous le rôle `cortex_app` et le contexte du tenant : plan adapté aux paramètres, **5,755 ms** ; plan générique forcé pour le diagnostic, **269,058 ms**, dont deux jointures éliminent chacune 2 016 981 paires. Ce sont des observations SQL unitaires, pas des latences HTTP ni une mesure à 10 000. La première tentative sur ce jeu n'avait pas de projection construite et retournait zéro ligne ; sa durée de 0,378 ms est exclue. La projection a ensuite été construite par l'API native avant ces mesures.

## Décision

`read_projection_transaction` applique `SET LOCAL plan_cache_mode='force_custom_plan'`. Le paramétrage est limité à cette transaction de lecture : le plan utilise les paramètres effectifs de tenant, version, recherche et focus. Les bornes `statement_timeout=5000ms` et `lock_timeout=2000ms`, les verrous du domaine, des sources et de l'appartenance, ainsi que RLS et les filtres de preuves, restent identiques. Aucune visibilité ni autorisation n'est mise en cache.

Le coût de planification est payé à chaque lecture ; le diagnostic ci-dessus mesure environ 1,1 ms de planification. Il doit rester inclus dans les mesures de concurrence et des quatre profils 10 000. Aucun plafond de taille ni délai d'exécution n'est augmenté.

## Vérification et limites

- Même fenêtre native de 24 résumés/v20, cinq échauffements puis cinquante observations avant/après : p50 **115,021 → 8,752 ms**, p95 au rang le plus proche **124,187 → 11,053 ms**. Réponses JSON strictement identiques. Signature avant le chronomètre, corps HTTP inclus ; import synthétique S20 concurrent dans les deux séries, donc diagnostic local et non qualification isolée.
- 55 tests Rust réussis ; deux tests moteur opt-in restent ignorés dans cette commande. Recettes natives séparées : six concepts/deux versions et droits statiques, panne/reprise/verrous/RLS ; dix-sept concepts de recherche avec rang, curseurs avant/arrière, source cachée et statuts 422/409/404. Elles passent après la correction.
- Rapports ignorés : `.runtime/brain/window-{before-explain,generic-before-explain,http-before,http-after}.json`, logs `window-plan-{rust-tests,rust-build,permissions,search}.log`.
- La correction ne qualifie ni 10 000 concepts, ni un retrait d'accès en cours de lecture, ni la mémoire, ni le rendu navigateur. La recette navigateur complémentaire est décrite dans la matrice frontend.
