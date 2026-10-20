# Continuation expérimentale Foursea — préparation sans dépense

Le run source `eea1bdf1-a2b1-4482-be4e-c6518d4cf214` reste arrêté et inchangé.
Le diagnostic du correctif de persistance est
`fdb19482-a9c8-45b7-b4bd-4e3e610d931c` dans
`analysis_jls_snapshot_preparations`. Le mécanisme de reçus déployé en v27
est conservé ; cette adaptation ajoute seulement le rattachement d'un
corpus partiellement disponible au parcours existant.

## Périmètre et résultats

Le snapshot historique reste intégral : **100 avis, 91 textuels et 9 sans
texte**. La configuration reste `jev_categories4_direct_1pass_v1`
(`e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69`),
avec la synthèse `jls-direct4-balanced-synthesis-v1.1`.

- 36 réponses natives JEV sont reprises exactement, avec les identifiants
  des tâches et les SHA des requêtes, textes, réponses et résultats.
- 51 avis dont la tâche source est `pending` avec `request_count=0` sont
  les seuls admissibles à un futur appel JEV.
- 4 tâches réservées (`request_count=1`) sans réponse restent exclues de
  toute nouvelle tentative. Leurs textes originaux et analytiques, notes,
  provenances, identifiants et empreintes sont conservés, avec `result:null`
  et le motif `reserved_outcome_unknown_no_retry`.

Le manifeste versionné `jls-direct4-partial-continuation-v1` fait partie
d'un **nouveau** protocole `jls-direct4-frozen-corpus-v1`. Il conserve
le protocole source reconstructible, les empreintes du run, des tâches et
des artefacts, le lien au diagnostic, les 36 réponses réutilisées, les
quatre exclusions et le partitionnement exact des 91 avis.

Le compteur général reste 100 ; le compteur sans texte reste 9. Les
statistiques de catégories portent sur les résultats réellement reçus
(36 à la préparation, **87 au maximum** après les nouveaux appels). Les
quatre résultats manquants ne sont ni neutres, ni non mentionnés, ni des
réponses incertaines du modèle. Ils n'entrent pas dans le dénominateur des
catégories. Une appréciation mixte contribue toujours aux deux polarités
et reste un seul avis distinct. Les textes exclus sont réservés à l'audit,
jamais utilisés comme preuves du rapport.

## Réutilisation et contrôles

La file `analysis_jls_restaurant_tasks`, ses réservations transactionnelles,
le worker `process-jls-restaurant`, les reçus immuables, le sélecteur équilibré,
le regroupement Luna, la mesure complète des tokens et le worker Sol-ready
sont réutilisés. Aucun nouveau moteur ni écran n'est ajouté.

Les contrôles SQL vérifient les rattachements à l'organisation et à
l'établissement, les sources inchangées, les statuts des tâches sources,
les réponses réutilisées et les empreintes. Une tâche déjà réservée ne
peut pas entrer dans le nouveau manifeste `pending`. Un index unique
interdit deux protocoles de continuation pour le même run source.

La compilation du dossier rassemble les 36 résultats réutilisés et les
51 futurs résultats sans créer de nouvelles tentatives pour les 36. La
liaison SQL du dossier accepte les seules tâches sources explicitement
figées. Les quatre exclusions sont conservées dans le protocole et les
archives, mais ne sont pas envoyées à Sol comme preuves.

Le test SQL monolithique prenait 10,9–11,7 secondes, calcul du SHA de
l'argument compris. Le profilage révèle des hachages imbriqués répétés
en plus de la vérification des sources. Le hachage du dossier et de ses sous-artefacts
est donc séparé de la transaction de liaison : appeler gratuitement
`save_jls_direct4_partial_evidence_certificate(run, dossier, sha)`, puis
`bind_jls_direct4_historical_evidence(run, dossier, sha)`. Le certificat est
une préparation immuable contenant le dossier exact, sous RLS. La liaison
exige l'égalité intégrale avec ce dossier et revérifie les sources et les
rattachements ; elle ne fait pas confiance à un SHA fourni seul. Le writer
générique d'archives ne peut pas créer ce type de certificat. Aucun délai
SQL n'est augmenté, aucun contrôle n'est supprimé.

Le dossier Sol et la note méthodologique vietnamienne indiquent
explicitement la couverture incomplète : 87 textes analysés au maximum,
quatre résultats absents pour raison technique et neuf avis sans texte.
Les consignes sémantiques JEV, les règles Luna et la politique de synthèse
V1.1 ne sont pas modifiées. Les anciens protocoles sans manifeste partiel
conservent leurs contrôles et leur format de périmètre.

## Vérification gratuite

- Rejeu Deno `--deny-net` sur les sources et les 36 réponses réelles.
- Parcours complet avec 51 réponses JEV **simulées**, puis Luna et Sol
  **simulés**, jusqu'au reçu Sol, à la validation et à la sauvegarde en
  mémoire. Les qualifications ne constituent pas des résultats réels.
- Vérification des effectifs, de la partition, des statistiques, de la
  conservation des textes et des refus d'altérations/réattributions.
- Test SQL/RLS de la liaison du dossier, avec les 36 tâches historiques et
  51 résultats techniques simulés dans une transaction intégralement annulée.
  Aucun consentement d'exécution ni run payant n'est commis.
- Qualifications sur le worker déployé pour les étapes JEV, Luna, Sol et
  validation/sauvegarde, par le mode technique existant avant tout accès
  aux secrets fournisseur.

Les nouvelles classifications ne peuvent être connues avant une future
exécution. Le nombre exact de groupes Luna dépendra de la sélection sur
les résultats réellement obtenus. Aucun nombre de groupes obtenu avec
les mocks ne doit être présenté comme celui du futur test réel.

## Autorisation future

Plafonds : **51 nouveaux appels JEV**, **32 requêtes Luna** regroupées par
avis, **un appel Sol** seulement si les preuves suffisent, **zéro Apify**.
Aucun retry fournisseur, aucun renvoi d'une tentative d'issue inconnue.
Seules les écritures identiques en base peuvent être réessayées selon le
correctif de persistance, sans appeler de nouveau un fournisseur.

L'ancien GO est lié au protocole source et a été consommé par son run.
Il ne couvre pas cette continuation distincte, même si son échéance n'est
pas encore atteinte. Un nouveau GO spécifique sera nécessaire. Cette
préparation ne crée aucun consentement, run payant ou déclenchement.
