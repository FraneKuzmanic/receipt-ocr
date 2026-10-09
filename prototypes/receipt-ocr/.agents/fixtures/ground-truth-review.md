# Ground truth review — scalar fields (iteration 26, Task 1)

**Status: VERIFIED by the product owner, 2026-10-09**, and written into
`.agents/fixtures/expected/*.json` (plan Task 20). The two sections below are kept as the record of
what was uncertain; the table is the answer. Items and VAT rows are a second pass and are not in it.

Resolved: C is `bank_transfer`. D stays open for the second pass (the expected file still says no
VAT). `receipt123`'s ZKI is too blurred to read and is left unscored. `screenshot-…`'s ZKI is
recorded in capitals, as printed. The Konzum row has no expected file until its receipt is recorded.

Conventions: `—` means "not printed, must be empty". Seller is the **legal entity and its registered
seat** (D5). Payment method is the category, with the printed wording in brackets. Dates are
`yyyy-mm-dd`; a time keeps the seconds only when they are printed.

## Cells I am unsure of

1. **`receipt123` seller name and address.** The third printed line reads like `DEMAGOGIJA d.o.o.`
   and the fourth like `Domovinskog rata 26, 21000 Split`; the second line (the venue) reads like
   `Poljana Hrv. narodnog preporoda 6, Split`. The photo is 335 px wide and I cannot read either with
   confidence. Please read them from the paper or a larger copy.
2. **`receipt123` ZKI.** Unreadable to me at this size; left as `?`. The JIR is taken from the QR
   code (`b19e5e13-…`), not from the print.
3. **`ina-racun-sladoled` JIR and ZKI.** 328 px wide; `a`/`e`/`8` are not distinguishable. My best
   reading is in the table, marked `?`.
4. **`22559270` JIR and ZKI.** Read from a 447 px wide photo; `0`/`8`/`9` are easy to confuse.
5. **`22559270` seller address.** Printed wrapped as `M.Tita 10` / `9, Opatija`; taken as
   `M. Tita 109, Opatija`.
6. **`0f089468…` (Konzum).** The photo ends above the receipt number, date, ZKI and JIR, so those
   are `—`. The total is taken as `13.40 EUR` (the receipt is dual-priced; `100,98` is the kuna
   amount). It prints both `Kartica ***********4385` (looks like a loyalty card) and
   `PLAĆENO: Gotovina`; taken as cash. No issue date is visible, so nothing says which currency is
   the legal one — is EUR right?
7. **`images` (Trader Joe's) document number.** The existing expected file says `037200`
   (`Ref/Seq # 037200`). Kept. Issue time is printed twice (`19:32`, `07:32PM`); taken as `19:32`.
8. **`screenshot-20190705-1907152` payment method.** Printed only inside the total's label,
   `UKUPNO KN (NOVcANICE)`. Taken as cash. (The extraction rules deliberately do not read an
   unlabelled tender line, so this cell will score as a miss.)
9. **`26515835` payment method.** Printed only as the tender line `GOTOVINA 2,00`. Taken as cash;
   same remark as 8.
10. **`inareceipt`.** No payment method is printed; `—`.
11. **`primjer1-hr-nopdv` issue time.** The only time is the footer `Datum i vrijeme: 2025-01-22
    18:23:39`. Taken as `18:23:39`; say if it should be `—`.

## Known disputes to decide

- **A. Seller = legal entity and registered seat (D5).** This changes two existing expected names:
  `lira_trogir` from `Lira Trogir` to `Obrt Lira vl. Lidija Radevenjić` (seat Četvrt Ž. Dražojevića
  bb, Omiš), and `receipt123` from `caffe bar ANTIQUE` to the company on line three (see 1).
  `22559270` stays `Milenij hoteli d.o.o.`, with the seat `M. Tita 109, Opatija`.
- **B. `receipt123` second tax row is PNP** (porez na potrošnju, 3,00 / 2,81 / 0,08) and no longer
  belongs in `vatBreakdown` (D8). Its expected file will keep one VAT row: 25 / 18.97 / 4.74.
- **C. `primjer1-hr-nopdv` prints "Načini plaćanja: Bankovni prijenos, Kripto Test".**
  `bank_transfer` or `other`? The table says `other`: two methods are named, and the Pravilnik
  reports several methods as Ostalo. (The rules as planned will read `bank_transfer`, because
  "Kripto Test" is not a known method word — so this answer decides whether that is a miss.)
- **D. `primjer1-hr-nopdv` zero-rate recap:** one VAT row `{0, 100.00, 0.00}` or no VAT? (Second
  pass, but it has been open since iteration 23.)
- **E. Receipts with no buyer** get `—` for all three buyer fields and are scored as "must be
  empty". `26515835` therefore expects no buyer (the app currently reads the store branch as one).
- **F. `primjer-pdf-racuna` seller OIB** is `12345678902`, which fails the check digit; under D7 it
  is now the expected value (shown with a warning). Likewise `primjer1-hr-nopdv` buyer OIB
  `12345678901`.

## Table

| Receipt | sellerName | sellerAddress | sellerOib | buyerName | buyerAddress | buyerOib | documentNumber | issueDate | issueTime | total | currency | paymentMethod | jir | zki |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0f089468f365211452db4ccf6e8da466` | KONZUM plus d.o.o. | Zagreb, Ulica Marijana Čavića 1A | 62226620908 | — | — | — | — (not in photo) | — (not in photo) | — (not in photo) | 13.40 | EUR | cash ` (PLAĆENO: Gotovina)` | — (not in photo) | — (not in photo) |
| `22559270` | Milenij hoteli d.o.o. | M. Tita 109, Opatija | 78796880101 | — | — | — | 38302/013/101 | 2022-06-26 | 09:58:57 | 517.00 | HRK | cash (`Novčanice`) | c8403f99-e432-47fe-9a43-3685a48aec89 | d731f731e41e19b0c32856505415e584 |
| `26515835` | Eurospin Hrvatska d.o.o. | Jelačićev trg 7, 51000 Rijeka | 62357811032 | — | — | — | 10752/310012/2 | 2024-01-23 | 15:12 | 1.99 | EUR | cash (`GOTOVINA 2,00`) | 1193a137-a1f5-4085-9e1b-3a0919701a4f | 602b3d9defd5587af4de4b7f848a52c5 |
| `gradanin-gotovina-pos` | AMPER, obrt za elektroinstalacijske radove | Ulica Svjetla 7, 10000 Zagreb | 90000000002 | — | — | — | 1/1/1 | 2026-08-17 | 10:30 | 375.00 | EUR | cash (`Gotovina`) | 00000000-0000-0000-0000-000000000000 | 00000000000000000000000000000000 |
| `images` | TRADER JOE'S | 5269 Prospect, San Jose CA 95129 | — | — | — | — | 037200 | 2017-02-24 | 19:32 | 54.52 | USD | card (`VISA`) | — | — |
| `ina-racun-sladoled` | INA - INDUSTRIJA NAFTE, d.d. | Zagreb, Av. V. Holjevca 10 | 27759560625 | — | — | — | 160142-S006-1 | 2023-07-16 | 14:19:14 | 18.14 | EUR | card (`kartica-MasterCard`) | b044e5f9-727c-47a0-ae57-ec4580d9406a | ad29e09be271e25fe4dbfc88fad71c30 |
| `inareceipt` | INA - INDUSTRIJA NAFTE d.d. | Zagreb, Av. V. Holjevca 10 | 27759560625 | — | — | — | 23024347-SU279WC1-503446097 | 2023-05-05 | 20:40 | 0.50 | EUR | — | 4a32003f-8e49-4fe1-8df1-1dbd9f5a2405 | 90ac2207a287a2668511b8bf24670240 |
| `lira_trogir` | Obrt Lira vl. Lidija Radevenjić | Četvrt Ž. Dražojevića bb, Omiš | 73710835843 | — | — | — | 19211-03-50070 | 2026-06-01 | 12:17 | 33.10 | EUR | cash (`Novčanice`) | 58d14366-9037-4fd1-b6ee-ec4580d96136 | 8481a9c8879b2ca3d51555e24db9f772 |
| `primjer-pdf-racuna` | Ana Horvat | Ulica primjera 5, 21000 Split | 12345678902 (fails check digit) | John Smith | Ulica primjera 10, 10000 Zagreb | — | 1/1/1 | 2026-07-29 | — | 630.00 | EUR | bank_transfer (`Transakcijski račun`) | — | — |
| `primjer1-hr-nopdv` | Lime Apps d.o.o. | Šišićeva ulica 18, 10000 Zagreb, Hrvatska | 95393674629 | Primjer inozemnog klijenta LTD. | Street 1, London, UK | 12345678901 (fails check digit) | 121/1/1 | 2025-01-22 | 18:23:39  | 100.00 | EUR | bank_transfer (`Bankovni prijenos, Kripto Test`) | — | — |
| `racuntaksi1` | S.A.L.N. SYSTEMS j.d.o.o. | Ivana Ančića 3, 10373 Ivanja Reka | 85092357159 | — | — | — | 224/STP/3 | 2025-03-31 | 23:59:47 | 132.72 | EUR | cash (`Gotovina`) | 18916f95-5787-4e7f-a190-3a091970cfa2 | cf706ac762a61389c6c46af0ec90c5c5 |
| `receipt123` | DEMAGOGIJA d.o.o. | Domovinskog rata 26, 21000 Split | 90789920471 | — | — | — | 49781/001/1 | 2025-07-30 | 14:17 | 23.80 | EUR | cash (`NOVČANICE`) | b19e5e13-0388-4284-9be9-3a0919701be5 (from the QR) | — (too blury to read) |
| `receiptEuroMistake` | Semovcanka Nova j.d.o.o. | Semovci, S.Radica 127 A, 48350 Djurdjevac | 79435261200 | — | — | — | 22-1-1 | 2020-02-21 | 14:26:38 | 103.69 | HRK | cash (`NOVCANICE I KOVANICE`) | ac12e053-3300-496a-8ad4-1bd2c10b0ec6 | 08a78e71e4e01080e6755ffe3bfdb1e6 |
| `receiptWithTaxMistake` | REBECA d.o.o. | Prolaz sestara Baković 1, Zagreb | 16029174381 | — | — | — | 326/U02/1 | 2020-09-25 | 17:13 | 13.00 | HRK | cash (`Gotovina`) | 7b6e8de5-9122-427a-a0e2-1bd2c10b7308 | 043bb05ab8d54535eddca9eb43fc71f1 |
| `screenshot-20190705-1907152` | ZATON VELIKI JDOO | PINJI 29, 20235 DUBROVNIK | 31918917420 | — | — | — | 52-POSL2-1 | 2019-06-27 | 03:04:11 | 202.00 | HRK | cash (`UKUPNO KN (NOVcANICE)`) | — (label printed, no value) | 328bc110fca2f47431c4f098fa36f844 |

`31231822` and `racun-mobilna-trgovina` have expected files and recorded fixtures but no source file
here; they are the same receipts as `receiptWithTaxMistake` and `receiptEuroMistake` and take the
same values.
