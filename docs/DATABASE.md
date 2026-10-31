# Database — ek hi SQL file

Repo me **sirf ek** SQL file hai:

```
database/education_platform.sql        ← poora schema (53 tables) + reference data
```

Ismein kya hai:

| Hissa | Kya |
| --- | --- |
| Schema | 53 tables — courses, modules, lessons, quizzes, proctoring, coding, certificates, settings, sab |
| Reference data | `roles`, `permissions`, `settings` (96 switches), `plans`, `categories`, `site_pages`, `certificate_templates`, `coding_languages`, `landing_page_builder`, `app_meta` |
| **Nahi** hai | koi demo course / lesson / quiz / user — ye jaan-boojh kar nahi hai |

## Fresh install

```bash
cd backend
npm ci
npm run migrate         # idempotent — missing columns/settings khud add karta hai
npm run dev
```

Database banane ke liye (ek hi baar):

```bash
mysql --default-character-set=utf8mb4 -u root -p < database/education_platform.sql
```

`--default-character-set=utf8mb4` chhodna mat — warna `—` (em dash) wale titles corrupt dikhte hain.

> ⚠️ Ye file **DROP TABLE IF EXISTS** karti hai. Sirf fresh/empty database par chalayein.
> Jis DB me learner data hai, wahan `npm run migrate` chalayein — wo kuch delete nahi karta.

## Upgrades (patch files khatam)

Pehle `database/patch-*.sql` files hoti thi. Ab zaroorat nahi:

```bash
cd backend
npm run migrate
```

Ye har boot par chalta hai aur **idempotent** hai — jo missing hai wahi add karta hai
(columns, indexes, settings rows, tables). Admin ki settings values kabhi overwrite nahi hoti.

## TiDB / managed MySQL

Ek hi file hai aur usme `CREATE DATABASE` + `USE` hai. Managed providers (TiDB Cloud,
PlanetScale) me pehle database select karein, phir file ke shuru ke ye do statements hata dein —
baaki file waise hi chal jaati hai.
