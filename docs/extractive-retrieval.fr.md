# Recherche extractive : portée et abstention

Le moteur Rust renvoie des extraits du savoir publié, contrôlés par les droits du sujet et accompagnés de citations. Il ne génère pas de réponse et n’appelle pas de fournisseur IA. `evidence_found` signifie que des passages ont été retrouvés, pas que toutes les prémisses de la question ont été démontrées.

## Filtre lexical conservateur

Les mots utiles de la question sont normalisés par le casefold Unicode existant. Les mots courts et un ensemble limité de mots de liaison/interrogation français et anglais sont exclus. Les négations `pas` et `not` restent significatives.

Pour qu’un concept soit candidat, **tous les termes utiles** doivent apparaître dans son titre ou son corps sourcé. Une correspondance sur le seul nom d’un produit ne suffit donc plus lorsqu’une question demande aussi une garantie ou une propriété absente. Les correspondances dans le titre sont pondérées deux fois, celles dans le corps une fois. Les égalités sont départagées par l’identifiant stable du concept. Les limites de nombre d’extraits et de caractères, ainsi que les vérifications d’accès, sont inchangées.

Ce filtre remplace, dans le moteur Rust, l’ancien seuil « au moins un terme en commun ». Il peut augmenter les abstentions : aucune traduction, synonymie, lemmatisation ou inférence implicite n’est réalisée. Une question française peut ne pas retrouver un concept anglais malgré un sens proche. Des formulations par mots-clés explicites permettent de vérifier le périmètre documentaire. Une question sans terme utile, sans concept couvrant les termes ou sans extrait tenant dans le budget produit `knowledge_gap`.

## Limites

La présence de tous les mots n’établit ni une relation logique entre eux, ni une garantie, ni l’actualité commerciale d’une affirmation. Les titres doivent être relus autant que les corps. La recherche conserve les extraits d’origine et n’inverse pas une négation. Les noms de rôle, versions et droits ne remplacent pas les preuves.

L’interface affiche « Extraits sourcés retrouvés » et demande d’en vérifier la portée. Les résultats historiques conservent leur contenu et leur version ; une reprise avec la même clé d’idempotence renvoie l’ancien épisode, même après une évolution du classement. Pour évaluer une nouvelle politique, utiliser une nouvelle intention/clé et conserver les anciens résultats comme référence.

Les contrats HTTP/MCP et les statuts restent identiques. La référence Python historique utilise encore son ancien classement ; cette évolution du moteur Rust est intentionnelle et ne doit pas être présentée comme une parité de classement avec cette référence.

## Vérification

Des tests synthétiques couvrent un nom de produit avec propriété absente, la conservation des négations, les mots interrogatifs français, une recherche simple positive et l’absence de traduction implicite. Les jeux de recette privés ne doivent pas être copiés dans les fixtures publiques.
