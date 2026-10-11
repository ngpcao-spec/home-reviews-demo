# Pipeline expérimental JEV + Sol V1 — préparation gratuite

Version `jev-hybrid-evidence-report-v1`. La génération reste désactivée dans le frontend, les endpoints, le worker et les RPC SQL. **Aucune autorisation de dépense, aucun job payant, aucun verdict Sol ni nouveau rapport n'a été créé.**

## Architecture

Le snapshot Artisan existant et immuable `f9c8876b-1b5a-4d10-9538-758881b61b6b` est vérifié avec `verifyPilotSnapshot`. `auditPilotCache` contrôle organisation, établissement, texte anglais, SHA256 des instructions/seuils, configuration complète `v12_economy_1pass_v1`, résultat complet et modèle réellement servi. Les 422 analyses sont réutilisées ; les variantes compactes et les entrées incompatibles sont écartées.

`pilotStatistics`, la taxonomie de 25 thèmes, `pilotNarrativeContext` et le croisement Google existant sont réutilisés sans modification. Le catalogue historique `reputation-themes` a été audité : sa taxonomie et son writer n'offrent pas le contrat de vérification requis ; le nouveau contrat reprend la forme Responses/JSON Schema, mais ne rappelle pas l'ancien extracteur ou writer. Le worker pilote a également été audité ; ses autorisations historiques ne sont jamais réutilisées pour ce pipeline.

Les nouveaux modules sont :

- `jev-hybrid-evidence.ts` : agrégation, sélection, fenêtres de contexte, citations/SHA256, dossier, prompt, schéma, tokenisation et estimation.
- `jev-hybrid-validation.ts` : contrôle strict Zod, chiffres serveur, identité des preuves, citations, thème/polarité/axe, verdicts, liens des recommandations et catalogue fermé d'actions.
- `jev-hybrid-worker.ts` : entrée réelle fermée, simulation explicite des garanties d'un seul appel combiné et des erreurs de facturation.
- `jev-hybrid-api.ts` : consultation des préparations, sans lancement ni autorisation.

Un futur appel unique à `gpt-6.1-sol`, reasoning `low`, comprendrait les verdicts supported/unsupported/uncertain pour toutes les citations et la rédaction A–H. Sol pourrait contester JEV sans modifier ses résultats historiques. Le rapport final reprendrait exclusivement les statistiques du serveur. Une preuve incertaine, absente ou incompatible masque l'item ou la recommandation concernée. Les textes des actions sont choisis dans un catalogue contrôlé ; l'attente ne devient pas une recommandation de formation, et la distance ne devient pas un problème d'indications d'accès.

Ce contrôle déterministe assure le schéma, les chiffres, les SHA256, les citations et les liens structurés ; il ne prouve pas à lui seul la vérité sémantique d'une prose libre. La vérification et la rédaction dans le même appel Sol ne constituent **pas une validation indépendante**, ni une validation humaine.

## Source réelle Artisan

| Périmètre du snapshot figé | Nombre |
|---|---:|
| Avis annoncés sur Google Maps | 1 615 |
| Avis stockés | 523 |
| Avis avec texte | 424 |
| Textes anglais prêts et analyses JEV réutilisables | 422 |
| Avis sans texte, jamais envoyés à JEV | 99 |
| Avis avec texte sans anglais prêt | 2 |
| Nouveaux appels JEV | 0 |

Les 422 avis représentent 26,13 % du nombre annoncé Google, et 99,53 % des avis stockés avec texte. Ils ne couvrent pas les 1 615 avis Google. Les étoiles sont conservées pour toutes les lignes du snapshot, y compris sans texte. Les mentions par thème/polarité, les avis distincts par thème et les avis distincts par axe sont séparés. Les thèmes `both` peuvent appartenir aux deux polarités sans être deux avis différents.

La RPC de préparation et un trigger indépendant vérifient les comptages des 25 choix persistés dans SQL, les étoiles et les quatre axes. Les sous-notes Google restent descriptives ; aucune note ne crée de thème et aucun Price rating n'est inventé.

## Preuves et diversité

Les 1 580 associations sont réparties dans la nouvelle présélection : **515 confirmées par règle, 947 candidates pour Sol, 118 explicitement contestées**. Ces états ne sont pas des labels humains. Les contestations V3 et les appréciations IA historiques sont conservées avec leur provenance, pas utilisées comme nouveau benchmark indépendant. Les associations contestées sont affichées séparément et exclues du dossier automatique.

Les indécisions V3 sont conservées comme candidates. La sélection favorise les axes/polarités non couverts, les thèmes variés, les différents niveaux d'étoiles, les avis mixtes et les critiques malgré des notes élevées. Les citations sont des segments contigus d'un seul avis ; aucune fusion ou citation inventée. Une fenêtre contextuelle indique explicitement sa troncature. La similarité de mots limite les citations redondantes, sans prétendre détecter toute paraphrase sémantique.

Le dossier courant contient **23 citations de 19 avis**, couvrant 23 couples thème/polarité : **12 confirmées par règle et 11 candidates Sol**. Les 23 citations proviennent d'avis où JEV détecte les deux polarités ; 17 sont des critiques malgré une note globale élevée. La distribution des citations est 2★ : 2 ; 3★ : 2 ; 4★ : 6 ; 5★ : 13. Il s'agit d'une sélection de preuves, pas d'une estimation de fréquence des problèmes.

| Axe | Citations positives | Citations négatives |
|---|---:|---:|
| Service | 1 | 5 |
| Qualité | 2 | 7 |
| Prix | 1 | 2 |
| Ambiance | 2 | 3 |

Le budget d'entrée plafonne la sélection sous 20 000 tokens estimés, avec une cible de 16 à 32 citations. Il n'impose pas un passage lexical V3 à tous les thèmes. Les thèmes non représentés dans les citations restent comptés dans les statistiques JEV, mais ne deviennent pas automatiquement des affirmations narratives vérifiées.

## Estimation avant tout lancement

Tarifs persistés dans le snapshot : **2 USD / million de tokens Sol d'entrée**, **10 USD / million de sortie**. Le coût historique Sol de l'ancien rapport et ses tokens observés ne servent pas à estimer le nouveau dossier.

| Préparation | Taille JSON du dossier | Entrée estimée | Sortie estimée | Coût Sol estimé | Borne indicative avec 9 500 tokens de sortie |
|---|---:|---:|---:|---:|---:|
| Français | 56 017 octets | 19 862 | 4 779 | 0,087514 USD | 0,134724 USD |
| Vietnamien | 56 310 octets | 19 994 | 4 779 | 0,087778 USD | 0,134988 USD |

Les tokens d'entrée incluent le prompt, le dossier et le schéma. `js-tiktoken@1.0.21`, encoding `o200k_base`, compte localement avec marge de 12 % et 256 tokens de cadrage. C'est une approximation pour l'alias de modèle, pas une mesure de facturation. La sortie est une prévision incluant verdicts, citations et prose ; les tokens réellement consommés et la version servie seront enregistrés après une future réponse. Aucun prix de traduction ou d'import n'est inventé ; ces étapes ne sont pas planifiées et leurs tarifs restent indisponibles.

Coût JEV nouveau : **0**. Coût supplémentaire du cache : **0**. Coût réel Sol actuel : **aucune exécution, donc aucun coût fournisseur supplémentaire**. Les bornes sont indicatives et ne valent jamais autorisation de dépense.

Préparations immuables :

- FR : `d54fa6d7-aa1c-4e09-bc76-8c65decd9db5`, SHA256 `953d7cc55b5692acc003b1440bda3697c9bb3d693567239fe713bf5b5de551d7`.
- VI : `1f311a85-2912-447a-bcf5-544dfdc15bee`, SHA256 `d62fa5aef1330610347ca28a0ebd75db105fbcf1f3ea10abcd08b6d9f6221865`.

Les dossiers exacts et les requêtes JSON sont accessibles dans l'écran et exportables pour inspection ; aucune réponse Sol simulée n'y apparaît.

## Stockage, sécurité et futur worker

Six nouvelles tables organisationnelles : `analysis_jev_hybrid_plans`, `analysis_jev_hybrid_authorizations`, `analysis_jev_hybrid_jobs`, `analysis_jev_hybrid_verdicts`, `analysis_jev_hybrid_events`, `analysis_jev_hybrid_controls`.

RLS owner/admin/manager de la même organisation, aucune lecture anonyme ni écriture directe authentifiée, secrets serveur uniquement. Les références organisation/plan/autorisation/job sont liées par des FK composites. Les plans, contrôles, événements et verdicts sont immuables. Les emplois terminés sont immuables et non supprimables. Une seule exécution active et une seule utilisation par autorisation sont possibles ; compteur maximum un, jamais réinitialisable. Après dispatch, requeue, reprise par un autre worker et retry d'un état billing_uncertain sont interdits.

`start_hybrid_report`, `claim_hybrid_job`, le worker Edge et `processHybridJob` restent fermés. Aucune clé API ou variable d'environnement ne les active. Les tables de jobs et d'autorisations restent vides ; les seuls scénarios d'exécution sont des mocks explicitement nommés dans les tests et des transactions SQL annulées.

Pour une future livraison autorisée, le connecteur réel, l'approbation spécifique et l'ouverture du worker nécessiteront une décision explicite, un coût confirmé dans l'application, le snapshot/dossier/prompt/schéma figés, et au maximum un appel facturable. Aucun cron ou scheduler payant n'est installé. L'architecture et les garanties de tentative sont préparées et testées ; l'exécution réelle reste volontairement inaccessible.

## Autre contrôle réservé

Contrôle `4942bc5e-5790-4087-b382-ca4644d71f47`, SHA256 `d1d47e0c178d7ee0189cecabeda98249a951a63b271feccea6c04f55ccec895a`.

40 avis anglais distincts, hors Artisan et Shabu, sur **11 restaurants de la même organisation** : Cilantro Restaurant 2, Xóm Mới Garden, Nhà hàng Nha Trang xưa, Green Home Restaurant, Green Home Dining, The Home Pizza Phu Quoc, Luong Son Cang Restaurant, Mai Hương Restaurant - Nha Trang, Làng Ngon Corner - Vietnamese Cuisine, The Home Pizza Nha Trang et K.HOUSE Restaurant.

Les identifiants des jeux expérimentaux, tâches historiques JEV, Gold et audits précédents sont exclus. Parmi 506 avis anglais éligibles, la sélection par SHA256 et répartition entre établissements conserve trois avis 1–3★ et 37 avis 5★ ; aucun 4★ anglais inutilisé n'est disponible. **Zéro résultat JEV réutilisable libre** est disponible sur ce nouveau lot. Les 40 textes sont figés avant toute annotation GPT-6 future, avec originaux et empreintes conservés, zéro référence créée et zéro appel payant. Aucun import ou traduction n'a été lancé. La faible couverture négative empêche de le présenter comme une validation robuste des critiques.

Les 40 cas Artisan déjà évalués sont utilisés seulement comme diagnostic connu, jamais comme nouvelle validation indépendante après correction. La référence future restera IA, pas Gold humain.

## Accès mobile et vérification

**Plus / Thêm → Test Jev → Rapport hybride JEV + Sol**. Prévisualisation gratuite FR/VI, citations et contexte, cas contestés, statistiques, coûts et dossier exact. Le bouton **Générer le rapport hybride** est désactivé. Le rechargement et le retour iPhone/iPad relisent la préparation serveur ; ils ne déclenchent ni génération ni nouvelle analyse.

Les tests utilisent uniquement des mocks explicites : diversité, exactitude des citations, cache et empreintes, cas mixtes, frontières de thèmes, statistiques autoritaires, schéma invalide, identifiants inventés, preuves incertaines, recommandations sans justification, double appel, perte de connexion, facturation incertaine, zéro retry, rôles et RLS. Les modules V3, configurations V11/V12/V13, anciens rapports, traductions et références GPT-6 ne sont pas modifiés.

Contrat API préparé selon [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) et le modèle demandé [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Ces pages ont été consultées pour le format ; les tarifs du calcul viennent du snapshot Supabase.

Vérifications : **1 367 tests Vitest sur 145 fichiers**, dont 23 nouveaux tests ; deux tests Deno avec réseau interdit ; lint et contrôle de types Deno ; lint et build frontend ; tests SQL/RLS avec rollback et contrôles SQL indépendants des statistiques. Quatre tests Playwright passent en FR/VI sur 360/390/430 px et iPad 768 px, avec génération désactivée, rechargement et zéro trafic fournisseur. Les empreintes des **83 tables historiques** contrôlées sont inchangées ; seuls les six nouveaux espaces de stockage sont ajoutés. Les données des nouveaux plans indiquent deux préparations, zéro autorisation, zéro job et zéro verdict.
