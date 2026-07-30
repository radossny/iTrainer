# Przy każdej zmianie kodu podbij wersję

Bez tego przeglądarka poda starą kopię z cache i zobaczysz błędy,
których w repozytorium już nie ma.

**Trzy miejsca, zawsze ten sam numer:**

1. `app.js` — stała `export const VERSION = "9"`
2. `app.js` — wszystkie importy `?v=9`
3. `index.html` — `src="./app.js?v=9"`

W Codespaces jednym poleceniem (przykład: z 9 na 10):

```
sed -i 's/?v=9/?v=9/g; s/VERSION = "9"/VERSION = "7"/' app.js index.html
```

Kontrola: `sh test/run.sh` — test `static` sprawdza spójność wszystkich trzech miejsc.

Numer wersji widać w stopce nagłówka strony. Jeśli nie zgadza się z tym,
co wgrałeś, patrzysz na cache — nie na błąd w kodzie.
