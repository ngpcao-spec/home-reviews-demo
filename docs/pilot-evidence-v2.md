# Audit des preuves du pilote Artisan — expérience V2

Source : snapshot `f9c8876b-1b5a-4d10-9538-758881b61b6b`, rapport Sol vietnamien
`cfaf1fb1-34d8-4797-9678-65ebce027b44`. L'audit gratuit séparé est
`43125297-4933-4621-bd19-b2b25837c3f4`.

## Défaut constaté

`pilotStatistics` V1 prend les deux premiers IDs associés à chaque thème JEV.
`pilotNarrativeContext` retient le premier exemple des thèmes dominants, puis transmet
le texte complet ou son préfixe. `validatePilotProse` contrôle les clés et les IDs cités,
mais pas le sens de la preuve. Une prédiction JEV était donc utilisée comme justification
de sa propre citation. Le rapport terminé avait huit associations sur six avis.

Les trois cas signalés sont confirmés dans les textes anglais figés et les empreintes :

| Avis | Association existante | Contrôle V2 |
|---|---|---|
| 17bbc7c2-625f-4307-bee4-503acdba416e | attentiveness négatif | La difficulté de compréhension relève d'une preuve communication, pas d'une prise en charge absente. |
| 00e5621d-ba3b-4a96-a58f-f69d726b4d41 | attentiveness positif | « The staff and service are top-notch » n'établit pas une attention particulière. L'ambiance reste explicitement appréciée. |
| 2d6e346e-5859-4745-ac8f-77475a3f228f | location négatif, conseil d'accès | « very unassuming location » ne décrit pas un accès difficile. L'assistance à l'arrivée reste une preuve distincte possible. |

Une quatrième association est mise à examiner : la critique de prix implicite
« Not to mention the price! » n'établit pas explicitement le niveau des prix selon ces
règles conservatrices. Les quatre recommandations existantes comportent au moins une
association citée qui nécessite un réexamen. Elles ne sont ni supprimées ni réécrites.

## Version séparée, sans changement des classifications

Configuration : **pilot-evidence-explicit-v2**.
Vérificateur : **explicit-evidence-rules-v1**.
Empreinte des règles : `8334b14f39be05b8cbaa4a403de198739469b8f1b4fe516168641b37ca95bd99`.

- La sélection utilise exclusivement les résultats économiques V12 complets, dont le
  texte anglais et les identités correspondent au snapshot, disponibles avant le rapport.
- Les empreintes du rapport et des réponses cache sont conservées séparément. Les avis
  évaluables et les clés review/theme/polarité doivent être les mêmes que dans le rapport.
- Le vérificateur reçoit seulement anglais, thème demandé et polarité. Il ne voit pas
  les probabilités, les étoiles, les sous-notes, les autres thèmes ou un label humain/IA.
- Règles explicites couvrant les vingt-cinq thèmes, segments de phrase, négation,
  hypothèses, séparation goût/boissons/cuisson, ambiance/décor/confort, prix/valeur/facture.
- Communication, attention au client, distance, appréciation du lieu et accès possèdent
  des conclusions distinctes. Aucune polarité n'est transférée automatiquement.
- Au maximum huit preuves sont choisies de manière déterministe sur les quatre axes et
  les deux polarités, après contrôle. Chaque citation est un extrait exact, avec bornes
  dans le texte anglais, hash, règle, provenance du texte, cache ID et modèle servi.
- Les comptages JEV restent intacts. Une preuve non reconnue est `review_needed`, jamais
  une suppression de finding ou une nouvelle annotation de référence.

Résultat sur le périmètre existant : **422 avis / 1 580 findings JEV inchangés**.
445 associations sont appuyées par une règle ; 1 135 nécessitent une lecture ou une méthode
de vérification supplémentaire. **Cela mesure la couverture de ces règles, pas la précision
de JEV.** Sur les huit anciennes associations : quatre passent la règle, quatre sont à
examiner. Huit extraits sont proposés par la nouvelle sélection.

Le contrôle est déterministe, séparé du producteur JEV ; il n'est ni une validation humaine
indépendante ni un nouvel audit IA. Les règles lexicales ne comprennent pas toutes les
paraphrases, l'ironie, les fautes ou les dépendances de contexte. Le texte complet reste
accessible pour réexamen. Les symptômes rapportés ne deviennent pas une causalité médicale.

## Garde avant une future rédaction V2

`prepareEvidenceV2Packet` vérifie de nouveau snapshot, règles, audit, citation et SHA256,
puis refait le contrôle texte/thème/polarité. Un booléen d'approbation enregistré ne suffit
pas. Les extraits restent bornés à 1 200 caractères, sans transmettre tous les avis.

`pilot-evidence-sol.ts` prépare un rédacteur futur distinct : Sol peut choisir et ordonner
les IDs des constats et recommandations proposés, mais ne peut pas inventer un conseil
libre. Les textes du catalogue sont reliés à la règle et à l'extrait correspondant.
Ainsi, un commentaire sur la distance ne peut pas produire un conseil d'accès. Les IDs
inconnus, axes incohérents, polarités erronées et champs supplémentaires sont rejetés.

**Ce rédacteur n'est connecté à aucun endpoint payant ou worker actif.** Aucun rapport V2
n'est généré par cette mission. Le pipeline, le prompt et le rapport V1 restent inchangés.

## Stockage et interface

Table nouvelle : `analysis_jev_pilot_evidence_audits`, immuable, idempotente par source /
rapport / version / règles / réponses. RLS owner/admin/manager dans la même organisation ;
aucune lecture anonyme ni écriture par le navigateur. RPC privée `save_pilot_evidence_audit`
avec contrôles des hashes et de la portée. Métadonnées : vérification déterministe,
human_validated=false, ai_verified=false, new_paid_calls=0, production_enabled=false.

Endpoint `jev-pilot-evidence` : GET en lecture seule ; POST `audit_free` uniquement.
Aucun appel fournisseur, cron, job payant ou traitement historique. Rechargement et retour
de PWA restaurent l'audit serveur. Double clic empêché ; génération de rapport désactivée.

Accès : **Plus / Thêm → Test Jev → Rapport pilote — JEV économique → Voir l'audit qualitatif
des preuves**. L'écran affiche ancien/nouveau, motifs, autres associations explicites du
même avis, textes complets, extraits, recommandations liées et provenance. FR et VI.

## Vérifications

Suite complète : **1 225 tests Vitest réussis**, dont 53 tests ajoutés pour cette expérience.
Trois tests Deno hors réseau et quatre scénarios responsive FR/VI réussis.

- Tests des trois textes réels figés et de leurs hashes, cas explicitement pertinents,
  negations, absence de transfert, hypothèses et ambiguïtés ; configurations V11/V12/V13 intactes.
- Tests du scope figé, de la sélection déterministe, des recommandations liées et de la
  seconde vérification avant Sol. Appels fournisseurs remplacés par des simulations.
- Tests SQL/RLS rollback : idempotence, refus update/delete, hashes, portée organisationnelle,
  privilèges, absence de qualification humaine/IA et intégrité des comptages.
- Contrôles Deno et tests sans accès réseau. Lint et build.
- FR/VI 360/390/430/768 px : ancien/nouveau, reprise, boutons, aucun overflow ou appel payant.
- Empreintes des 78 tables existantes avant/après identiques, y compris le rapport terminé,
  le cache, les configurations, benchmarks, références scellées et traductions.
