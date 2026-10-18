# Chill Thái — reprise ciblée V2.1, préparation sans dépense

## Périmètre et identité

- Protocole : `fc8f1bc8-cbde-400a-9df2-d33b7c15f8e6`.
- Version : `jls-chill-targeted-v2.1-delegated-vi-v1`.
- SHA256 : `e1a39cddb69995f04b47f79b60e9720c7e81a69174acd96305ec6544285314ad`.
- Table : `public.analysis_jls_contract_v2_protocols`.
- Établissement : `a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8`.
- Organisation : `93228bbb-6397-41e3-b8be-21ee7060eda7`.
- Rapport historique : `39556285-21ee-4962-9892-da3b4f0e8ca3`.
- Run source, définitivement conservé : `3294262e-8946-41c0-b9c4-463a4fe27e74`.
- Archive V2.1 : `analysis_jls_snapshot_preparations`,
  `ff28e270-f330-453c-85ea-a1860425bbe5`, SHA256
  `a340c8e6651edba4e588e6c8a4df31729886f3a7079498e1129da3b0a5141830`.
- Compilation : `4ac13bb8733ceea122dc15f8f2aa32d835e7f691`.
- Garde SQL corrigée : `5d6504880917e1b0f4a1f618009974b2919718dc`.

Le snapshot contient exactement les 100 mêmes identifiants : 80 avis avec
texte anglais figé, 20 sans texte réservés aux statistiques. Le dénominateur
thématique reste 80, le dénominateur global du snapshot 100 ; ce périmètre
ne couvre pas tous les avis annoncés par Google.

Les 80 résultats JEV complets sont réutilisables :
`v12_economy_1pass_v1`, instructions complètes V12,
`themes_v12_semantic_boundaries_v1`, modèle servi `jev-1.13.0`.
Aucun changement de seuil, texte, traduction, résultat JEV ou verdict historique.

## Réutilisation Luna et seule question nouvelle

L'artefact source `analysis_jls_sol_ready_artifacts`,
`0dc74aac-d45d-4ff7-9eb8-dcade288b723`, conserve son SHA256
`b346e465efde8115346aace06cbbd3bba3ce2c6110b0b5b08e827210345469a4`.

31 décisions natives sont reprises exactement : 25 ACCEPTED et 6 UNCERTAIN.
Les groupes de questions historiques restent identiques octet pour octet,
y compris les groupes contenant plusieurs questions. Aucun de ces groupes
historiques ne peut être envoyé par ce nouveau protocole.

La configuration Luna historique et ses seuils restent inchangés :
`1880f1c1f12b4ad2922f7fa187926630cefd7906defe2ade82ee2a0e50496412`.
Le nouveau prompt Sol V2.1 ne rend pas ces décisions incompatibles : leur
texte, citation, thème, polarité, question et configuration restent identiques.
Leur manifeste réutilisé a pour SHA256
`87f112671910416ad7074fa7649673759e36d6825f9ea87560f972819f2f0de7`.

Seule la preuve `drinks:negative`
`7f9809ab307f386b177babd74a39a547dbaf1fecc46354808da6a36755d811e8`
est retirée du nouveau dossier, sans être modifiée ni supprimée de l'historique.

Sa remplaçante candidate est
`ea98b7c1ce48de265026fb9d94ab82e8aff3653f32b2dc3478f7e4687a0ff97e`,
sur l'avis `4b5dae79-7eea-479a-b616-51904c71d939`,
`wait_time:negative`, axe Service. La phrase mentionne explicitement que les
plats et les boissons mettent longtemps à arriver ; son contexte préserve
les compliments sur les plats et le personnel.

- Texte et contexte : `5d471a0121c6278f30b982ae2780e206ad15ff03a40f7a8b251f7424d2001a2e`.
- Citation : `dbd775432bed99a9abfad0bd6bcf6da769f3b0dfda4e3320eb636aded8c8a607`.
- Bornes de citation : 151–342, indices UTF-16 dans le texte anglais figé.
- Nouvelle requête Luna : `ab3ff6eee301f3345bebbef5eb0fe1b1f1025125f22e412e61b7d264e86c871c`.
- Questions : `f670318ab647ac69947c384e69281566bf2a18be0882cebcbb65ab6801d95a27`.

Le verdict drinks n'est jamais transféré. La candidate reste non vérifiée.
Une seule requête Decisions, une seule question, est préparée. Aucune note
Google, référence GPT-6 ou donnée personnelle inutile n'est dans son payload.

## Trois branches conditionnelles, aucune prédiction fabriquée

Les trois dossiers Sol préparés ne sont pas des résultats Luna :

| Hypothèse technique | Preuves admissibles à Sol | Octets de requête | Entrée locale estimée | Entrée avec marge |
| --- | ---: | ---: | ---: | ---: |
| ACCEPTED | 26 | 71 701 | 19 084 | 21 631 |
| REJECTED | 25 | 69 724 | 18 509 | 20 987 |
| UNCERTAIN | 25 | 69 724 | 18 509 | 20 987 |

L'entrée reste plafonnée à 32 768 tokens, avec 9 500 réservés à la sortie.
Le comptage local utilise o200k_base, +12 % et 256 tokens de cadrage ; il ne
constitue pas une mesure de tokens facturés. Aucune estimation monétaire.
Les citations et contextes complets sont conservés. Les certificats de tokens
sont figés après la mesure de la requête finale ; aucune tokenisation au réveil.

Les trois branches passent les contrôles de suffisance : quatre axes, au moins
huit preuves acceptées, présence des critiques et des avis peu étoilés lorsque
disponibles. Le rejet ou l'incertitude exclut entièrement la nouvelle preuve
du dossier Sol. La recommandation sur l'attente des boissons ne doit pas être
forcée et aucun nombre minimal de recommandations n'est imposé.

Prompt Sol V2.1 :
`e1f45fc531b8d820b03c195fa8c8c6b683e897a139c89c9c74a58776df4d53f0`.
Schéma : `fdc76cc245c66dc7156715a6ad583cd5e998089628ff36fd514d1911e21b5c2f`.
Configuration rédaction/validation :
`6633ed5a8a24d957bc3a6e27c9eff22918f86853758bd089e7e48fa3fbf291da`.
La configuration du protocole est distincte :
`e08c9c17a16a2e338f4ec1b08cb528e4b649228031fc596f4635d400f1b4fb06`.

## Protections, mesures et tests

Le moteur durable existant est réutilisé, avec une sélection versionnée du
compilateur et du validateur V2.1. Les autres protocoles, notamment Garden,
conservent leurs instructions et leurs contrôles. Une clé étrangère séparée
relie l'archive snapshot ; la clé étrangère des archives Garden reste en place.
Les lectures passent par l'organisation et les rôles owner/admin/manager ;
les écritures et RPC d'exécution restent réservées au serveur.

Les premières sondes explicitement simulées ont révélé deux expirations SQL
dans la réservation, sans appel fournisseur. Elles sont conservées comme
échecs techniques, sans réactiver leurs opérations. La vérification SQL
répétait les hashes canoniques de 80 caches et des artefacts natifs scellés.

La vérification complète reste obligatoire à la compilation/enregistrement.
Au réveil, le worker vérifie les hashes complets du protocole, de la source,
des requêtes et des certificats. La garde SQL atomique vérifie les manifestes
de lignes immuables, leurs appartenances et leurs états, les textes du snapshot,
les configurations et modèles JEV et les requêtes Luna terminales. Elle se
ferme si les triggers d'immutabilité requis sont désactivés. Son argument est
lié par égalité JSONB à l'artefact scellé exact. Le rapport historique demeure
contrôlé en direct. Aucune protection RLS, de consentement ou de réservation
n'est retirée. Temps SQL isolé mesuré : 2 185 ms avant, 346 ms après.

Résultats effectivement obtenus : 113 tests unitaires pertinents ; 10 tests
Deno sans réseau ; SQL/RLS et idempotence dans BEGIN/ROLLBACK ; lint et build ;
16 tests mobiles FR/VI (360/390/430 et iPad), puis quatre contrôles mobiles
supplémentaires après le dernier ajustement d'affichage. Le CI GitHub complet
et le déploiement Pages du commit `4ac13bb` ont réussi.

Le replay du dossier réel sans réseau couvre les trois branches et 18 erreurs
ou interruptions : source, permission, contexte modifié même après recalcul de
l'enveloppe, configuration, groupe, cache, concurrence, timeouts, modèle
incorrect, HTTP 429, usage absent, résultat invalide, décision altérée,
réponse perdue et confiance insuffisante. Aucun deuxième envoi n'est permis.

Les trois sondes finales dans Edge Runtime 1.77.0 / Deno 2.1.4 sont terminées,
quatre étapes durables chacune, et stockées en mode mock uniquement :

- ACCEPTED : `ecca7a9c-ea40-442c-bb12-f444d082ab02`.
- REJECTED : `5c1c8761-b15f-4fca-804b-119b059eb531`.
- UNCERTAIN : `ea5c8a3b-e2bd-4776-9b48-7389390f8711`.

Leurs réponses et usages sont des mocks techniques, pas des rapports réels,
des références d'annotation ou des consommations fournisseur.

Deux tests supplémentaires de réception volumineuse ont été conservés :

- `33851d2a-1eed-4a7e-988e-03a07608f210`, réception simulée de 369 664 octets :
  `invalid_output`, `JLS_INVENTED_EVIDENCE`. Le mock référençait l'ancienne
  preuve drinks retirée ; son rejet est attendu et aucun validateur n'est élargi.
- `9f5f064a-e2b7-49f0-8bab-113bb0d1b530`, réception simulée de 373 646 octets,
  cinq recommandations : sauvegarde `needs_review`, trois propositions visibles
  et deux duplications explicitement synthétiques masquées. Les axes de base
  sont ceux du mock courant ; les trois propositions de test viennent d'une
  copie du contenu sauvegardé, sans modifier l'original. Le remplissage de
  stress est isolé dans une sortie reasoning synthétique. Ce n'est pas une
  nouvelle génération Sol.

Ces deux réceptions ont été préparées par les RPC de test serveur, en mode
mock, après réservation atomique et avec le résultat Luna technique du mock
ACCEPTED du même protocole. La validation et la sauvegarde ont ensuite parcouru
le worker Edge déployé. Durées : 1 876 et 1 911 ms. Leurs trois étapes amont
ne sont pas présentées comme des appels fournisseur ni comme trois nouvelles
mesures Edge. Les trois sondes normales ci-dessus couvrent séparément les
quatre étapes réelles du worker, avec transport simulé.

La qualification immuable est `d497a135-08fe-448d-b8fa-704063f6016e`, dans
`analysis_jls_contract_v2_checks`, SHA256
`fae24f9735bfabe8e31eab688611c65378d88a003a31c0da754c45d4e35b40ed`.
Les 14 traces natives Shutdown sont reliées aux execution_id des mesures :

| Étape | CPU ACCEPTED | CPU REJECTED | CPU UNCERTAIN |
| --- | ---: | ---: | ---: |
| Envoi Luna simulé | 272 ms | 300 ms | 277 ms |
| Validation Luna | 299 ms | 310 ms | 428 ms |
| Envoi Sol simulé | 342 ms | 333 ms | 333 ms |
| Validation et sauvegarde | 350 ms | 338 ms | 341 ms |

Les deux validations volumineuses utilisent respectivement 355 et 377 ms CPU.
Les durées totales des étapes normales vont de 3 993 à 7 493 ms, avec les
lectures Auth/SQL ; elles ne sont pas du temps CPU. Mémoire native à l'arrêt :
28 196 391 à 28 878 815 octets. L'observation heap + externe durant les sondes
reste sous 74 Mo ; ce n'est pas une garantie de pic mémoire.

Le compteur process.cpuUsage est indisponible dans cet Edge Runtime : sa
valeur reste null dans les métriques JS, sans faux zéro. Les CPU viennent
des événements natifs Shutdown, région ap-southeast-1, raison EarlyDrop.
Le maximum observé laisse 1 572 ms sous la limite CPU de 2 000 ms
([limites Supabase vérifiées](https://supabase.com/docs/guides/functions/limits)).
Le critère interne de qualification, plus prudent, reste 1 500 ms et 256 Mio.
Ces mesures ne garantissent pas toute sortie arbitraire d'un futur fournisseur.

La qualification conserve les métriques, tests, réceptions de stress et la
provenance des gardes SQL. Hash garde d'intégrité + réservation :
`81f8b72ff8e0ca6befc28ecade25f507d983a7fe8d90db78cc37aac6a848ab8c`.
La première série technique interrompue n'est pas réactivée ; l'unique mock
encore en attente a été arrêté par la RPC dédiée, sans effacer ses réceptions.

## Déploiement et consultation

- `process-jls-restaurant`, version 12, ACTIVE,
  bundle `c7a722863dacb3f2d4ba2dd032dee073a8dd5260b501724fd3c557fce23180e5`.
- `jls-restaurant`, version 13, ACTIVE,
  bundle `5be12586dc0896953749ecbed257677dbadc04c2e7d11e96c14a104058c10a5d`.
- Authentification propre au serveur conservée ; le GET anonyme renvoie 401.
- Migrations 20261018063151, 20261018064738 et 20261018064845 appliquées.
- Aucun nouveau consentement, opération payante, appel fournisseur ou
  changement de pipeline commercial.
- Le CI complet et le déploiement Pages `39105651086` ont également réussi
  sur le commit SQL `5d65048` ; celui de `4ac13bb` est `39105040647`.

La dernière lecture confirme : protocole et qualification SHA256 conformes,
sources compatibles, zéro consentement, zéro opération payante et zéro
opération encore active pour ce protocole. Le hash du run historique reste
`fc380ece01d5c05ceff591f7044ee76953f07716e2cd4402c7721066d3ad1f41` ;
sa réception Sol demeure
`8e7addb2e4fc20a535269d3c4875a4eb0e3677b30633ddb972a7b65e27cfa557`.
Les trois archives historiques et les 80 caches restent inchangés.

Accès : Plus / Thêm → Test Jev → Rapport hybride JEV + Luna + Sol → Chill Thái.
L'écran affiche la préparation V2.1, puis l'historique. Après un futur GO,
le résultat distinct sera lu depuis `analysis_jls_contract_v2_operations`,
sans être masqué par le run source bloqué. Les états et preuves sont conservés
pour l'audit comparatif. Le rechargement ne déclenche aucune écriture.

## GO ultérieur, une seule exécution

> GO — J'autorise Codex à exécuter une seule fois le rapport vietnamien
> Chill Thái selon le protocole fc8f1bc8-cbde-400a-9df2-d33b7c15f8e6.
> Réutiliser les 80 analyses JEV et les 31 décisions Luna compatibles.
> Maximum une nouvelle requête gpt-6-luna pour la citation wait_time:negative,
> puis un appel gpt-6.1-sol avec le contrat V2.1 si les preuves sont suffisantes.
> Aucun appel JEV ou Apify. Aucune relance payante automatique.
> Si Luna rejette la preuve ou reste incertaine, ne pas forcer la recommandation.
> Conserver les rapports et résultats historiques inchangés.

Ce texte est une instruction proposée, pas un consentement déjà donné.
Après réception effective du GO seulement, l'opérateur authentifié vérifie
les opérations existantes et la qualification, puis utilise le mécanisme
`authorize_jls_contract_v2` avec un consentement spécifique à ce protocole,
son SHA256 et sa configuration, frais de moins de cinq minutes et valable
au plus 24 heures. Source : `user_directive_codex_delegation`, identité
`codex_admin` / `supabase_mcp`. Aucun ancien consentement n'est réutilisé.
Le réveil passe par `wake_jls_contract_v2`, jamais par un GET. Un appel déjà
réservé, perdu ou potentiellement facturé n'est pas renvoyé. Le nouvel état
est conservé séparément dans `analysis_jls_contract_v2_operations`.

Une conformité technique ne garantit ni une vérité sémantique ni une validation
humaine indépendante. Aucun résultat qualitatif du futur rapport n'est préjugé.
