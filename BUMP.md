# Przy każdej zmianie kodu podbij wersję

Bez tego przeglądarka poda starą kopię z cache i zobaczysz błędy,
których w repozytorium już nie ma.

**Trzy miejsca, zawsze ten sam numer:**

1. `app.js` — stała `export const VERSION = "8"`
2. `app.js` — wszystkie importy `?v=8`
3. `index.html` — `src="./app.js?v=8"`

W Codespaces jednym poleceniem (przykład: z 8 na 9):

```
sed -i 's/?v=8/?v=8/g; s/VERSION = "8"/VERSION = "7"/' app.js index.html
```

Kontrola: `sh test/run.sh` — test `static` sprawdza spójność wszystkich trzech miejsc.

Numer wersji widać w stopce nagłówka strony. Jeśli nie zgadza się z tym,
co wgrałeś, patrzysz na cache — nie na błąd w kodzie.
