# iTrainer

Analiza danych zdrowotnych i treningowych z Apple Watch, z docelowym planem
treningowym adaptowanym do bieżących danych.

**Bez kroku budowania.** Zwykły HTML, CSS i moduły JavaScript. Nie ma `npm install`,
nie ma `node_modules`, nie ma Vite. Commit = wdrożenie.

## Skąd biorą się dane

Eksport z aplikacji **Vital2AI** (iOS): `HealthData.csv` i `Workouts.csv`.
Pliki wgrywasz w przeglądarce — nigdzie nie są wysyłane. Baza żyje w IndexedDB
na Twoim urządzeniu.

## Publikacja na GitHub Pages

1. Wrzuć zawartość tego katalogu do repozytorium `iTrainer`
2. Settings → Pages → Source: **Deploy from a branch**, branch `main`, katalog `/ (root)`
3. Po minucie strona jest pod `https://<twoja-nazwa>.github.io/iTrainer/`

Wszystkie ścieżki w kodzie są względne, więc nie trzeba niczego konfigurować.

## Praca bez instalowania czegokolwiek

- **Drobna zmiana:** w repozytorium naciśnij `.` — otworzy się edytor w przeglądarce
- **Praca z podglądem:** Code → Codespaces → Create codespace. W terminalu:
  `python3 -m http.server 8000`, potem otwórz przekierowany port

Otwarcie `index.html` bezpośrednio z dysku **nie zadziała** — moduły JavaScript
wymagają serwera HTTP. Wystarczy dowolny, np. powyższy jednolinijkowiec.

## Struktura

```
index.html          struktura i style
app.js              stan, zdarzenia, renderowanie
docs.js             treści objaśnień pod przyciskami „i”
lib/csv.js          parser CSV
lib/db.js           opakowanie IndexedDB, eksport i import kopii
lib/chart.js        wykresy jako czysty SVG
compute/metrics.js    warstwa obliczeniowa — czyste funkcje
```

`compute/metrics.js` jest sercem projektu: nie dotyka DOM ani bazy, więc da się
go testować i przenosić niezależnie od reszty.

## Zasady projektowe

**Zero zależności zewnętrznych.** Parser CSV, wykresy i obsługa bazy napisane
na miejscu. Aplikacja działa offline i nie zepsuje się, gdy zmieni się cudze API.

**TRIMP nie korzysta ze stref z zegarka.** Apple przelicza granice stref
pierwszego dnia każdego miesiąca, więc minuty w strefie 4 sprzed roku to inna
wielkość niż dziś. Obciążenie liczone jest wzorem Banistera, zależnym wyłącznie
od HR max i spoczynkowego zapisanych w bazie.

**Dane wątpliwe są odfiltrowywane, nie ukrywane.** Kolumny wypełnione samymi
zerami wyglądają na obecne, a nie niosą informacji. Rejestr metryk pokazuje
status każdej kolumny.

**Kopia zapasowa to funkcja podstawowa.** IndexedDB znika przy czyszczeniu
danych witryny, a na iOS bywa usuwane po tygodniu nieużywania, jeśli strona nie
jest dodana do ekranu głównego.

## Prywatność

W repozytorium nie ma i nie może być żadnych danych osobowych — `.gitignore`
blokuje pliki CSV i JSON z kopiami. Dane zostają w przeglądarce.

Gdy dojdzie warstwa AI, klucz API będzie wpisywany w interfejsie i zapisywany
w `localStorage`. **Nigdy w kodzie** — repozytorium jest publiczne, a klucze
wrzucone na GitHuba są wykrywane przez boty w ciągu minut.

## Stan i plan

Gotowe: import obu formatów, deduplikacja po `import_hash`, wykrywanie aktywnych
metryk, raport jakości, kalibracja HR max, TRIMP i ACWR, wartości bazowe,
rozkład intensywności, tempo przy zadanym tętnie, kopia zapasowa.

Następne: cele i plan treningowy z porównaniem zamierzenia z wykonaniem, potem
warstwa AI z pamięcią o stałym rozmiarze kontekstu.
