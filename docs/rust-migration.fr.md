# Migration Rust et TerminusDB — état vérifiable

Cible autorisée : backend Rust utilisant TerminusDB, conservation des contrats HTTP/MCP et du frontend. Un vérificateur indépendant audite les changements et contre-vérifie les correctifs. La migration n’est pas considérée complète tant que des parcours restent exécutés par Python.

## Premier lot : fondations compilées

Le workspace Cargo et services/rust-core utilisent une toolchain1.98.1 et Cargo.lock. Le code comprend une première validation Unicode/DAG, des types de références et relations, un encodage de compatibilité des digests Python et un transport TerminusDB privé borné. Ce n’est pas encore un serveur applicatif migré.

Le contrôle de plages utilise les points de code Unicode, pas les octets UTF-8 ni les unités UTF-16. La détection de cycles est itérative. Les références vides et relations primaires associatives sont rejetées à la désérialisation. Les contraintes de domaine complètes (preuves, cibles et parent primaire unique) restent à porter.

L’encodage des digests reproduit le format historique Python, distinct de RFC8785/JCS. Des vecteurs figés produits par Python couvrent Unicode, exposants, zéro négatif et grands entiers ; cette compatibilité doit rester testée avant toute signature de confirmation Rust. La revue indépendante peut ajouter des contre-exemples.

L’adaptateur TerminusDB refuse HTTP distant, credentials dans l’URL, redirections et proxy implicite. Chaque appel a un timeout ; requêtes et réponses JSON sont bornées. Une mutation suivie d’une erreur5xx, d’une rupture transport ou d’une réponse2xx illisible est incertaine et ne doit pas être relancée aveuglément. Les paramètres documentaires sont explicites. L’adaptateur de snapshot devra encore exiger le commit retourné et maintenir le manifeste publié.

## Inventaire de migration

| Périmètre | État actuel |
|---|---|
| 79 opérations HTTP / 95 outils MCP | Implémentation Python existante ; aucune route native Rust encore servie dans ce premier lot |
| Graphe TerminusDB | Prototype réel indépendant validé, pas encore stockage servi par les parcours applicatifs |
| Unicode, DAG, transport moteur, encodage JSON | Premières fonctions Rust compilées et testées ; parité métier complète non établie |
| PostgreSQL | Reste le backend servi et la référence des contrats pendant la transition |
| Frontend | Inchangé |

## Vérification

Exécuter `cargo test --workspace --locked`, `cargo clippy --workspace --all-targets --locked -- -D warnings` et `cargo fmt --all --check`. Le workflow Rust réalise ces vérifications séparément. Le rapport indépendant est conservé dans les livrables locaux ; il précise ce qui est relu statiquement et ce qui est réellement exécuté.

Les étapes suivantes portent la publication et les lectures derrière un manifeste fixé à un commit TerminusDB, puis étendent progressivement la parité HTTP/MCP. Aucun gain de performance ni remplacement complet du backend n’est revendiqué à ce stade.


### Boucle de revue indépendante du premier lot

Le vérificateur a fait corriger trois points avant intégration : paramètres documentaires du moteur, classement des issues de mutation incertaines, validation obligatoire après désérialisation. Neuf tests Rust passent après ces correctifs. Sa campagne séparée de100018 vecteurs JSON a ensuite trouvé28 divergences dues au départage des représentations décimales ; passage à Ryu, même oracle et même seed : zéro divergence. Les exemples fautifs deviennent des régressions permanentes. Ce résultat ne prouve pas encore la signature de confirmations en bout en bout. Le squelette d’identité RS256 et de transactionSQLest présent mais ne sert encore aucune route native et doit recevoir ses tests de conformité.
