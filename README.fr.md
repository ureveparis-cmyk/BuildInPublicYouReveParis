# You Rêve Paris — Plateforme Engineering & Growth

**Conception, architecture et développement hands-on de toute la plateforme digitale de [You Rêve Paris](https://ureve.paris), un salon de beauté parisien — du tunnel de réservation avec paiement jusqu'à la stack marketing/data.**

🇫🇷 Français · [🇬🇧 English version](README.md)

> ### ℹ️ À propos de ce dépôt
> Ceci est une **vitrine publique sanitisée**, pas le code de production. La vraie plateforme est
> privée : elle traite des paiements Stripe réels et des données personnelles clients — la publier
> reviendrait à fuiter des secrets, exposer des PII clients (RGPD), et livrer la logique de
> réservation et d'anti-fraude du site **live** à quiconque le demande.
>
> À la place, le code dans [`examples/`](examples/) est **écrit pour l'occasion, autonome et sans
> dépendances** — des ré-implémentations propres de problèmes représentatifs que j'ai résolus, **sans
> aucun secret, identifiant ni donnée client**. Chaque exemple est livré avec des tests exécutables.

---

## Le rôle

Je suis CTO de You Rêve Paris. C'est un rôle **end-to-end en pleine responsabilité** sur un site
commercial live : je définis la stratégie technique et data, et j'écris le code. Concrètement :

- **Produit & architecture** — le produit de réservation, le modèle de domaine, le pipeline de déploiement, la posture de sécurité.
- **Développement full-stack** — une application PHP/SQLite trilingue : tunnel de réservation, disponibilités temps réel, agenda staff, ingestion multi-sources.
- **Growth & data engineering** — une stack de tracking hybride navigateur + server-to-server, l'automatisation marketing, et le SEO/GEO pour les moteurs de réponse IA.
- **Stratégie business** — l'économie des canaux (walk-ins vs. marketplaces vs. demande propriétaire), le ROI de l'acquisition payante, et l'analyse d'un 2ᵉ emplacement.

Le fil rouge : **transformer les opérations d'un salon en logiciel, et sa donnée en croissance** —
en tant que fonction engineering d'une seule personne, démultipliée par un workflow de développement
IA autonome.

---

## Ce que fait la plateforme

| Capacité | Ce que ça implique |
|---|---|
| **Tunnel de réservation** | Mobile-first, paiement Stripe, disponibilités temps réel, réservations multi-prestations & multi-invités, source de vérité unique des créneaux. |
| **Agenda intelligent** | Assignation automatique des praticiennes sur les RDV multi-prestations, ré-optimisation du planning du jour sur annulation. |
| **Ingestion multi-sources** | Réconcilie les réservations Treatwell, ClassPass, Planity & Airbnb dans un seul agenda — parsing, déduplication, matching des reprogrammations. |
| **Marketing & data** | Tracking hybride 3 niveaux (Pixel/gtag navigateur + Conversions APIs server-to-server), fidélité & parrainage, synchro d'audiences. |
| **Site trilingue + SEO/GEO** | FR / EN / 中文, calendrier éditorial auto-publié, données structurées, et optimisation pour les moteurs de réponse IA (AI Overviews, ChatGPT, Perplexity). |
| **Déploiement continu** | Mise en production en ~30s via webhook, protégée par un scan de secrets et des garde-fous de diff automatisés. |

---

## L'architecture en un coup d'œil

```text
   Client (mobile-first)
       │  tunnel de réservation · dispo temps réel
       ▼
   Application — PHP 8 / SQLite (WAL)
       •  Moteur de dispo (fuseau-correct)
       •  Staff resolver (assignation multi-prestations)     ┐
       •  Ingestion multi-sources                            ├──►  Agenda
          (Treatwell · ClassPass · Planity)                  ┘   source de vérité unique
       │  paiement
       ▼
   Stripe — Checkout + webhook
       ├──►  webhook post-achat  ──►  Tracking hybride (navigateur + server-to-server)
       └──►  Fidélité · parrainage · réactivation

   Livraison :  git push  ──►  webhook  ──►  Production (~30s)
                                             security gates + health checks
```

**Principes de conception récurrents dans le système :**

- **Une source de vérité pour la disponibilité.** L'agenda — pas une marketplace — fait autorité. Chaque canal y écrit, le tunnel y lit : les doubles réservations deviennent structurellement difficiles.
- **Le serveur fait autorité.** Prix, validation des promos et disponibilité sont décidés côté serveur ; le client est une vue rapide et résiliente qui s'auto-répare si un asset échoue à charger.
- **La justesse aux frontières.** Fuseaux horaires, argent et données tierces mal formées sont les endroits où les systèmes de réservation cassent silencieusement — c'est donc exactement là que la logique est isolée et testée unitairement (ci-dessous).
- **Livrer petit, livrer sûr.** Le déploiement continu n'est sûr que parce que chaque push passe des gates de sécurité automatisées et des health checks post-déploiement.

---

## Deep-dives techniques (exécutables)

Trois problèmes représentatifs, chacun isolé dans du code propre et sans dépendances, avec ses
tests. Aucun framework requis — clone et lance :

### 1. Moteur de disponibilité fuseau-correct → [`examples/availability-engine/`](examples/availability-engine/)

Le bug qui corrompt silencieusement presque tout système de réservation maison : calculer les
créneaux dans le **wall clock** du salon (Europe/Paris, avec DST) tout en stockant les instants en
UTC. Un offset naïf ou un aller-retour via `toISOString()` est faux la moitié de l'année et peut
faire basculer un créneau sur le mauvais jour près de minuit. Ce moteur ne fait jamais d'arithmétique
d'offset à la main — chaque instant est ancré au fuseau du salon et résolu par le runtime, DST inclus.

```bash
php examples/availability-engine/test.php   # 13 checks, dont un jour de transition DST
```

### 2. Assignation staff multi-prestations → [`examples/staff-assignment/`](examples/staff-assignment/)

Un RDV Treatwell regroupe souvent plusieurs prestations à la suite. Le resolver assigne les
praticiennes selon une vraie règle métier, par priorité : (1) garder la cliente avec **une seule**
praticienne pour tout le RDV ; (2) si impossible, **morceler** sur des segments contigus en
**minimisant les hand-offs** ; (3) **jamais** de double-booking. C'est un petit problème de
satisfaction de contraintes, résolu par une recherche en profondeur dont l'ordre des candidats
rend bonne la première solution trouvée (réutiliser le staff en place, puis équilibrer la charge).

```bash
php examples/staff-assignment/test.php      # 15 checks
```

### 3. Ingestion de données multi-sources mal formées → [`examples/booking-ingestion/`](examples/booking-ingestion/)

La donnée marketplace est hostile : Treatwell concatène les prestations sans séparateur
(`Dépose gelBeauté des piedsRemplissage gel`), ClassPass parsème des espaces fines insécables
(U+202F) entre nombres et unités, les prix utilisent la virgule décimale, et certaines sources
n'envoient **aucun identifiant stable**. Ce normaliseur découpe sur les frontières de mots perdues,
neutralise les espaces Unicode exotiques, extrait durée/prix embarqués, et construit une **signature
de contenu déterministe** pour qu'une reprogrammation se réconcilie sur place au lieu de doublonner.

```bash
php examples/booking-ingestion/test.php     # 13 checks
```

### 4. Colorimétrie on-device — capture · analyse · rendu → [`examples/color-matcher/`](examples/color-matcher/)

Un recommandeur de vernis à partir d'un selfie qui tourne **entièrement côté client** — aucune photo
ne quitte le navigateur (privacy by design). Voici son cœur algorithmique headless, en JavaScript :
**capture** (réduire une rafale d'images bruitées en une seule couleur de peau fiable, en rejetant
les images aberrantes), **analyse** (white balance sans carte de référence, puis CIELAB + la métrique
dermatologique **ITA°** et un sous-ton chaud/froid), et **rendu** (classer les teintes du catalogue
par harmonie de sous-ton, distinctivité perceptuelle via **CIEDE2000**, et harmonie de teinte —
chaque reco expliquée, pas une boîte noire). L'implémentation CIEDE2000 est validée contre les
données de référence publiées de l'article Sharma 2005.

```bash
node examples/color-matcher/test.mjs        # 32 checks, dont les données de référence CIEDE2000
```

Tout lancer d'un coup :

```bash
for t in examples/*/test.php; do php "$t"; done   # exemples PHP (1–3)
node examples/color-matcher/test.mjs              # exemple JS (4)
```

---

## Growth & data engineering

La plateforme n'est pas qu'un logiciel opérationnel — c'est un moteur d'acquisition et de rétention.

- **Tracking hybride 3 niveaux.** Pixels navigateur et `gtag` pour les events du tunnel, **plus** des Conversions APIs server-to-server déclenchées depuis le webhook Stripe — avec stitching d'identité first-party pour que les conversions navigateur et serveur matchent. Le server-side est le filet résilient quand les navigateurs bloquent les tags client.
- **Automatisation marketing.** Points de fidélité, programme de parrainage VIP, campagnes de réactivation — pilotés depuis la même base de réservations, avec des garde-fous pour ne jamais recibler à tort un client actif.
- **Synchro d'audiences.** Synchro programmatique des audiences first-party (Customer Match / custom audiences + lookalikes) pour boucler la donnée CRM avec les canaux payants.
- **SEO / GEO.** Un calendrier éditorial trilingue auto-publié, des données structurées Schema.org, `hreflang`, IndexNow, et une optimisation au niveau du passage pour les moteurs de réponse IA — parce que la découverte se fait de plus en plus dans un LLM, pas dans une page de liens bleus.

---

## Engineering augmenté par l'IA

C'est une fonction engineering d'une seule personne opérant à une échelle qui demande normalement
une équipe — rendue possible par un **workflow de développement IA autonome** (Claude Code) que j'ai
conçu autour de garde-fous stricts :

- **Agents autonomes en parallèle**, chacun isolé dans son propre git worktree, pour que plusieurs flux de travail tournent sans s'écraser.
- **Gates de sécurité automatisées avant chaque push** — scan de secrets, détection de noms de fichiers sensibles, garde-fou de taille de diff — pour que la vitesse ne se paie jamais en sécurité.
- **Opérations auto-réparantes** — détection de conflits de déploiement, crons de health check, procédures de debug/rollback disciplinées qui gardent la prod honnête sans babysitting manuel.

L'enjeu n'est pas « l'IA a écrit le code ». C'est que j'ai bâti un **système pour livrer et opérer
une plateforme de production en sécurité et à haute vélocité**, avec l'IA comme démultiplicateur et
une discipline d'ingénierie rigoureuse comme garde-fou.

---

## Résultats sélectionnés

- **Consolidé des canaux de réservation fragmentés** (walk-ins, Treatwell, ClassPass, Planity, direct) en un agenda unique faisant autorité — supprimant la douleur des doubles réservations et de la réconciliation de plusieurs calendriers déconnectés.
- **Réduit la dépendance aux marketplaces à faible marge** en construisant un tunnel de réservation propriétaire et en y orientant la demande.
- **Bâti une boucle d'acquisition data-driven** — tracking de conversion server-side → optimisation des canaux payants → dashboards ROI — en ciblant les segments qui convertissent réellement.
- **Maintenu une haute vélocité de livraison en solo**, via un déploiement continu protégé par des gates de sécurité et des health checks automatisés.

*(Les chiffres commerciaux précis sont volontairement omis d'un dépôt public.)*

---

## Stack technique

**Backend** PHP 8 · SQLite (WAL) · Stripe · POO style PSR · PHPUnit
**Frontend** JS en amélioration progressive · vision on-device (`face-api.js`, colorimétrie CIELAB/CIEDE2000) · assets self-hosted sous CSP stricte · mobile-first
**Data / growth** GA4 · Meta Pixel + Conversions API · Google Ads API · GTM server-side (Cloud Run) · IndexNow
**Infra / livraison** OVH · déploiement continu par git-webhook · gates de sécurité automatisées · crons de monitoring · backups off-site chiffrés
**Pratiques** i18n (FR/EN/中文) · Schema.org / GEO · développement augmenté par l'IA (Claude Code)

---

## Structure du dépôt

```
.
├── README.md                     ← version anglaise
├── README.fr.md                  ← vous êtes ici (français)
└── examples/                     ← vitrines exécutables, sans dépendances
    ├── availability-engine/      ← génération de créneaux fuseau-correcte (PHP)
    ├── staff-assignment/         ← assignation multi-prestations des praticiennes (PHP)
    ├── booking-ingestion/        ← normalisation de données multi-sources (PHP)
    └── color-matcher/            ← colorimétrie on-device : capture · analyse · rendu (JS)
```

Chaque dossier d'exemple a son propre README expliquant le problème, l'approche et les compromis.
Les exemples PHP tournent sur **PHP ≥ 8.1** ; l'exemple de colorimétrie sur **Node ≥ 18** — les deux
sans aucune dépendance tierce.

---

## À propos

**Dimitri** — CTO, You Rêve Paris.
Plateforme live : **[ureve.paris](https://ureve.paris)**

Je construis des logiciels et des systèmes data qui font tourner une vraie entreprise — stratégie et
développement hands-on, de bout en bout.
