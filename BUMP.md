# Przy każdej zmianie kodu podbij wersję

Bez tego przeglądarka poda starą kopię z cache i zobaczysz błędy,
których w repozytorium już nie ma.

**Trzy miejsca, zawsze ten sam numer:**

1. `app.js` — stała `export const VERSION = "7"`
2. `app.js` — wszystkie importy `?v=7`
3. `index.html` — `src="./app.js?v=7"`

W Codespaces jednym poleceniem (przykład: z 7 na 8):

```
sed -i 's/?v=7/?v=7/g; s/VERSION = "7"/VERSION = "7"/' app.js index.html
```

Kontrola: `sh test/run.sh` — test `static` sprawdza spójność wszystkich trzech miejsc.

Numer wersji widać w stopce nagłówka strony. Jeśli nie zgadza się z tym,
co wgrałeś, patrzysz na cache — nie na błąd w kodzie.
