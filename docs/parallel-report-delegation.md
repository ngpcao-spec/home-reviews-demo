# Délégation du rapport expérimental parallèle

`start_parallel_report_delegated` permet un lancement administratif autorisé
sans prétendre que l'utilisateur a cliqué dans l'application. Le consentement
porte `user_directive_codex_delegation`, la directive et son SHA256, le périmètre
d'organisation/établissement, le rapport de référence, les empreintes du corpus,
de la configuration et du manifeste JEV, ainsi qu'une expiration.

Le RPC existant du bouton conserve sa signature et son consentement
`user_in_app_button`. Les deux entrées utilisent désormais la même fonction
interne : mêmes vérifications du corpus, contrôle d'appartenance, verrou
transactionnel, cache exact, file de tâches, publication et protection contre
les doubles lancements. Aucun moteur, écran ou transport supplémentaire.
Les nouvelles fonctions sont réservées au rôle serveur ; aucune politique
RLS n'est modifiée. Une préparation ou un déploiement ne crée aucune exécution.

Le worker compact existant traite JEV → sélection automatique → un appel Sol,
sans Luna ni Apify. Le prompt court, les six choix natifs, le sélecteur, les
consignes compactes, `gpt-6.1-sol` et son raisonnement `low` restent inchangés.
Les réservations et reçus existants empêchent le renvoi d'une tentative
incertaine ; aucun retry fournisseur n'est ajouté.

Qualification : `tests/supabase/parallel-delegated.sql` vérifie les refus de
consentement absent/expiré, de mauvais périmètre ou d'empreintes modifiées,
la compatibilité du bouton, les réservations, reçus et sauvegarde finale.
Chaque test SQL utilise des réponses explicitement simulées et annule toutes
ses écritures. Sur les sources réelles de 80s Bistro : 100 avis, 68 textes,
32 sans texte, 36 assertions, 68 reçus JEV simulés et une réservation Sol
simulée. Les probes du worker déployé restent séparées des appels réels.

Ces vérifications portent sur le raccordement technique, pas sur la qualité
réelle des classifications ou de la rédaction des modèles.
