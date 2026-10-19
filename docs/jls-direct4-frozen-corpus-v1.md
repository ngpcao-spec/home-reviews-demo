# Raccordement quatre catégories par corpus figé

Version technique : `jls-direct4-frozen-corpus-v1`.

Le worker historique et les RPC de réservation sont réutilisés. Les protocoles
Chill Thái, Bistro V1 et la comparaison Bistro conservent leur version et leurs
archives. La nouvelle branche ne participe pas à la lecture par défaut des
rapports courants ; sa consultation nécessite le protocole explicite.

## Contrat

Un protocole contient le run historique terminé, le rapport publié de référence,
le snapshot ordonné, les identifiants d'organisation et d'établissement, l'identité
autorisée, les textes originaux et analytiques, les notes et données structurées,
les empreintes, les effectifs et les requêtes préparées. SQL vérifie ces éléments
contre les sources enregistrées et l'appartenance à l'organisation. Le worker
vérifie de nouveau le manifeste et chaque requête utilisée.

Les effectifs et la limite JEV viennent du manifeste vérifié, sans restaurant ni
nombre de textes fixé dans la nouvelle branche. La limite Luna demeure 32
requêtes regroupées par avis, et Sol un seul appel soumis au contrôle de suffisance
et à la mesure complète des tokens. Aucun retry, fallback ou appel de vérification
du modèle. Une issue incertaine reste conservée sans nouvel envoi.

Configuration JEV inchangée : `jev_categories4_direct_1pass_v1`, quatre questions,
six choix, SHA256 `e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69`.
Synthèse inchangée : `jls-direct4-balanced-synthesis-v1.1`.
Les politiques et seuils Luna restent ceux du sélecteur existant.

Le texte canonique PostgreSQL du rapport publié est conservé séparément pour
préserver son empreinte, notamment pour les nombres décimaux comme `18.0`.
Cela ne modifie ni les valeurs, ni les rapports historiques.

La préparation refuse les caches non examinés. Ce raccordement n'emprunte aucun
classement à 25 thèmes. Pour Foursea, aucun résultat direct quatre catégories
compatible n'était disponible : zéro analyse réutilisée, 91 requêtes préparées.

## Qualification gratuite

`scripts/prepare-historical-direct4.ts INPUT OUTPUT COMMIT VERSION` permet la
préparation et le rejeu intégral avec transport injecté. Exécuter avec Deno et
`--deny-net`. Le quatrième argument sélectionne explicitement la nouvelle version ;
l'absence de cet argument conserve l'ancien contrat Bistro.

Les fixtures techniques compressées sont stockées séparément dans
`analysis_jls_snapshot_preparations`. Le mode serveur existant
`direct4_historical_probe` rejoue les étapes JEV, Luna, envoi Sol et validation
avec des réponses explicitement simulées. Il ne charge pas de clé fournisseur,
ne crée aucun consentement, run ou tâche payante et n'appelle aucun fournisseur.
Les quatre qualifications déployées sont exigées par l'autorisation future.

Les contrôles simulés démontrent le raccordement technique, jamais la qualité
sémantique future des classifications ou de la rédaction.

## Corpus Foursea

- Établissement : FourSea - Coastal Dining & Coffee,
  `430d15b6-d84a-4074-a175-044703de18b6`.
- Organisation : `93228bbb-6397-41e3-b8be-21ee7060eda7`.
- Run historique : `62f57e00-227a-4903-a05e-755828bff5ee`.
- Rapport publié : `f0545095-3f4d-473f-a6b7-cbb6a408bc7b`.
- Génération : `5500fc01-d46a-4a12-a714-c9dc84b13cf8`.
- 100 avis uniques : 91 textes anglais figés, 9 sans texte pour statistiques.
- Étoiles 1/2/3/4/5 : 9 / 4 / 5 / 3 / 79.
- Source historique : `1fab4e8cf113c1b76dd37d4e0d8671e9e1b9e136114e96ce30a0d151dc925375`.
- Snapshot : `8bd535231aa9111b8a4f2f46507431573c2238386e8c640aa8f5c744868dec86`.
- Plafonds futurs : JEV 91, Luna 32, Sol 1, Apify 0.

La préparation et le déploiement n'autorisent aucune dépense. Une nouvelle
directive GO nommant le protocole et son périmètre est nécessaire avant de créer
un consentement ou une exécution.
