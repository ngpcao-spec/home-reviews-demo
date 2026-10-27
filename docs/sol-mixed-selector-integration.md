# Intégration du complément de source mixte — préparation uniquement

Aucun déploiement, changement du réglage actif, appel fournisseur ou rapport
régénéré dans cette livraison. Les raccordements expérimentaux restent désarmés.

## Version exacte et empreintes

| Élément | Valeur |
| --- | --- |
| Version du candidat testé | `sol-evidence-started-source-mixed-completion-proposal-v1` |
| Commit testé | `f1627c4e7e86314e61af9e103a52016cca8dfc5d` |
| SHA-256 du fichier testé, fins de ligne LF | `95e7b9ff4ca650a254303154db51961679fb670aab76a741dd0608d807bbda2c` |
| Expérience Sol isolée | `b5709377-d629-4bec-8a36-7555299c34cc` |
| Version de production préparée | `sol-evidence-started-source-mixed-completion-v1` |
| Empreinte du descripteur version/configuration, persistée sur la demande | `ed41510685e7897f0f0252fee2a9323140dc49e630d7524a51e706b35d09f1b5` |
| SHA-256 du corps de fonction, identique candidat/production | `e995f023d1e6d9d2b1537a1df1d3ae7a83a75afc56941662f112ba9a005ac44f` |
| SHA-256 du fichier de production normalisé LF | `48cb0891b6c2a24d186da098a10f76b40fa94db2de15b03c8e8e02733e11cfb9` |

L'empreinte du fichier testé et celle du descripteur ne sont pas interchangeables.
Le registre calcule le descripteur à partir de la politique de production, du
sélecteur de couverture de base et des références du commit/fichier testés.
La migration contient exactement la même valeur, vérifiée en PostgreSQL local.

`supabase/functions/_shared/jev-mixed-priority-evidence-selection.ts` reprend
le corps de fonction du candidat octet pour octet après normalisation LF.
Seuls le chemin des imports, l'en-tête et le libellé de version de la politique
changent. Aucun classement de candidat, départage, quota, paire, dédoublonnage
ou règle métier ne change. Le champ hérité `production_enabled: false` reste
une trace de provenance ; seul le réglage serveur choisit les versions.
Le nom expérimental reste refusé par le registre de production.

Les deux versions antérieures restent disponibles avec leurs empreintes
inchangées, notamment le réglage actuellement actif pour le retour arrière :

| Version conservée | Empreinte |
| --- | --- |
| `sol-evidence-single-negative-source-completion-proposal-v1` | `3ca3d6002e5cb3a1d29221f6b392bed79514b18af5c29eae7861ab90ed2ce973` |
| `jls-direct4-negative-mixed-coverage-v1` | `17ea400f28bdc39c7218e2d62c9d9452d137b8e0b4e4891acfacfa8e0237de5e` |

## Fixation de la demande et reprise

1. La migration ajoute `report_generation_requests.evidence_selector_sha256`.
   Le trigger de création prend le réglage sous verrou partagé et fige
   **version et empreinte** ensemble. Les valeurs fournies par un client sont
   remplacées par ce choix serveur. Une bascule du réglage prend le verrou
   exclusif sur la même ligne ; elle concerne les créations suivantes.
2. Les demandes existantes reçoivent seulement leur empreinte correspondant
   à leur version déjà figée. Aucun nom de version, périmètre, `comparison_id`,
   tentative, reçu ou rapport n'est réécrit.
3. Le worker lit les deux champs. Une version inconnue, une mauvaise empreinte
   ou une empreinte absente pour la nouvelle version est refusée avant toute
   préparation susceptible d'ouvrir un appel fournisseur. La compatibilité
   des anciens workers et versions reste limitée aux deux noms antérieurs.
4. Le protocole, la configuration du manifeste, le template du lot, le draft,
   l'enveloppe et les contrôles du résultat conservent le descripteur. Le
   dossier est construit par le registre normal, sans importer de raccordement
   expérimental. Le parcours individuel conservé accepte le même descripteur.
5. Une reprise utilise ses artefacts figés, jamais le réglage global courant.
   Les contrôles SQL confrontent aussi le descripteur à l'empreinte persistée
   de la demande. Un changement de version dans un draft même recalculé est
   refusé avant Sol. Un descripteur de template incorrect est désormais refusé
   avant la réservation du premier lot JEV.

Les protections de conservation, d'obsolescence, d'accès, de réservation unique,
de reçu et de résultat inconnu restent en place. Aucun fallback individuel ni
retry n'est ajouté. Les 150 avis, les statistiques, les langues, modèles,
prompts et Sol compact restent inchangés ; les critiques 5★ restent éligibles.

## Migration préparée, non appliquée

**Seule nouvelle migration à appliquer ultérieurement :**
`20261026161509_pin_mixed_source_evidence_selector.sql`.
Elle dépend de `20261026132413_pin_report_evidence_selector.sql`, déjà vérifiée
présente en production par SELECT le 26/10/2026. Ne pas appliquer aveuglément
les migrations locales expérimentales ou de remise à zéro.

La migration est transactionnelle et conserve le réglage actif et son horodatage.
Elle verrouille les deux tables de métadonnées en `ACCESS EXCLUSIVE NOWAIT` :
si elles sont occupées, elle échoue et doit être réexécutée comme une migration
entière après résolution de la contention. Cela ne reprend aucune génération.
Pendant le seul backfill, le trigger `report_request_immutable` est suspendu
sous ce verrou, puis immédiatement rétabli. Les autres triggers restent actifs.
Une erreur, y compris un changement des points d'insertion SQL attendus, annule
toute la transaction. Aucun import, wake, claim ou appel réseau n'est exécuté.

## Rejeux hors ligne et contrôles

Les six dossiers réels sauvegardés passent par **`batchSolDraft` puis
`measureBatchSolDraft`**, le chemin normal de préparation du dossier Sol.
On ne compare pas seulement deux appels directs au sélecteur.

| Dossier | Associations | Avis retenus | Associations ordonnées / requête Sol / références |
| --- | --- | --- | --- |
| K.HOUSE historique | 32 | 18 | Identiques au candidat |
| K.HOUSE nouveau | 32 | 18 | Identiques au candidat |
| Bottega historique | 32 | 16 | Identiques au candidat |
| Bottega nouveau | 32 | 18 | Identiques au candidat |
| OPTIMIST historique | 32 | 18 | Identiques au candidat |
| OPTIMIST nouveau | 32 | 18 | Identiques au candidat |

Les requêtes Sol sont identiques octet par octet, et les empreintes de références
compacts sont identiques. Pour Bottega nouveau, la requête est aussi exactement
celle consommée par l'expérience `b5709377…` :
`3d43a87a36bd5750507e846e88c5e1d619ad4c6a60822f254e25f4e256f910a3`.
Le thon conserve sa paire qualité `e5` positive / `e15` négative. Chaque paire
mixte reste complète, le plafond est 32 et chaque rubrique disponible garde une
illustration positive. Les classements, probabilités, reçus JEV et statistiques
sont identiques aux sources ; aucun appel fournisseur dans le rejeu.

Résultats sans textes clients :
[`verification/sol-mixed-selector-replay-20261026.json`](verification/sol-mixed-selector-replay-20261026.json).
Les textes et reçus natifs restent dans les dossiers locaux historiques.

```powershell
$env:HOME_REVIEWS_MIXED_REPLAY_ROOT='D:/Codex/GoogleMaps Avis/output/sol-mixed-priority-audit-20261026'
npm run test:mixed-selector-replay -- --maxWorkers=1
npm test
npm run lint
npm run build
deno check --no-config --no-lock --no-remote --node-modules-dir=manual supabase/functions/process-historical-report-jobs/index.ts supabase/functions/jev-batch-experiment/index.ts supabase/functions/process-jls-restaurant/index.ts
```

Le rejeu réel est séparé de la CI et échoue si les sources locales manquent,
sans téléchargement de secours. La CI vérifie le corps figé, les trois
descripteurs, la fixation en base, l'immuabilité de l'empreinte, le retour
arrière pour les demandes suivantes, la reprise, les résultats inconnus et
les refus avant réservation/appel. Les réponses simulées vérifient le
raccordement ; elles ne prouvent pas la qualité d'un futur rapport Sol.

## Ordre du futur déploiement — non exécuté

1. Vérifier la migration précédente et le réglage actif ; appliquer uniquement
   la nouvelle migration, dans sa transaction complète.
2. Déployer les trois fonctions depuis le commit de la PR intégrée :
   `process-historical-report-jobs`, `jev-batch-experiment`, `process-jls-restaurant`.
   La migration doit précéder les binaires, car le worker lit la nouvelle colonne.
3. Vérifier en lecture seule les trois versions déployées, leurs capacités
   `selectors_supported`, le réglage resté identique et les demandes existantes.
   Aucun test ne doit créer de demande ou réveiller un worker de génération.
4. Lors d'une décision d'activation distincte, exécuter la transaction ci-dessous.

## Activation exacte — nouvelles demandes seulement

```sql
begin;
set local role service_role;
select public.set_current_report_evidence_selector(
 'sol-evidence-started-source-mixed-completion-v1',
 'Activate the exact f1627c4 mixed-source selector for future requests only'
);
commit;

select engine,jev_transport,evidence_selector_version,
 public.report_evidence_selector_sha(evidence_selector_version) as evidence_selector_sha256,
 updated_at
from public.report_pipeline_settings where id;
```

Attendus : `jev_sol_v2`, `batch_initial_v1`, version
`sol-evidence-started-source-mixed-completion-v1`, empreinte `ed415106…09f1b5`.
Cette commande ne modifie pas les demandes existantes et ne lance aucun rapport.

## Retour arrière exact — nouvelles demandes seulement

```sql
begin;
set local role service_role;
select public.set_current_report_evidence_selector(
 'sol-evidence-single-negative-source-completion-proposal-v1',
 'Restore the previous active selector for future requests only'
);
commit;

select engine,jev_transport,evidence_selector_version,
 public.report_evidence_selector_sha(evidence_selector_version) as evidence_selector_sha256,
 updated_at
from public.report_pipeline_settings where id;
```

Attendu : ancien sélecteur actif, empreinte `3ca3d600…ce973`.
Conserver les trois implémentations, la nouvelle colonne et les binaires
compatibles tant qu'il existe des demandes liées à la nouvelle version.
Ne pas rétrograder les binaires, changer les artefacts figés ou remettre à zéro
les tentatives/reçus pour modifier le réglage des futures demandes.

## Limites conservées

Le candidat privilégie aussi le complément mixte d'un avis 1–4★ déjà retenu.
Il peut donc concentrer le dossier sur moins d'avis distincts. Le budget reste
32 associations ; une paire mixte coûte deux places. Les pertes du rejeu,
notamment la petite focaccia pourtant jugée avantageuse chez Bottega, restent
des arbitrages réels, pas une couverture exhaustive.

Le test Sol isolé a repris le thon sec en qualité et dans les points négatifs.
Il a aussi omis le manque de sauce sur une pizza malgré une preuve toujours
disponible. La réserve sur la formulation de la recommandation prix demeure :
aucun changement du prompt Sol dans cette intégration. JEV, la traduction,
la sélection et la synthèse gardent leurs limites respectives. Un passage
exploratoire ne prouve pas une supériorité générale ou un gain de vitesse.
