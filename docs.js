// Objaśnienia pod przyciskami „i”. Osobny plik, żeby dało się je poprawiać
// bez dotykania kodu.

export const DOCS = {
  trimp: {
    t: "TRIMP — obciążenie pojedynczej sesji",
    b: [
      "Jedna liczba łącząca czas trwania z intensywnością. Godzina truchtu i dwadzieścia minut mocnego biegu to zupełnie różne obciążenia, choć w kalendarzu obie są „treningiem”.",
      "Wzór Banistera: czas × HRr × 0,64 × e^(1,92 × HRr), gdzie HRr to rezerwa tętna, czyli (HR średnie − HR spoczynkowe) ÷ (HR max − HR spoczynkowe).",
      "Waga rośnie wykładniczo. 60 minut przy tętnie 145 to około 94 punkty. Te same 60 minut przy 170 to około 170 punktów — prawie dwa razy więcej przy identycznym czasie.",
      "Niski TRIMP przez kilka tygodni oznacza utratę formy. Wysoki sam w sobie nie jest zły — problemem jest dopiero nagły skok, co mierzy ACWR.",
      "Ten wzór celowo nie korzysta ze stref tętna z zegarka. Zależy tylko od HR max i spoczynkowego, które ustawiasz w panelu kalibracji.",
    ],
  },
  acwr: {
    t: "ACWR — obciążenie świeże kontra przewlekłe",
    b: [
      "Średni TRIMP z ostatnich 7 dni podzielony przez średnią z 28 dni. Odpowiada na pytanie, czy to, co robisz w tym tygodniu, mieści się w tym, do czego organizm zdążył się przyzwyczaić.",
      "Około 1,0 to utrzymanie. Zakres 0,8–1,3 to bezpieczny rozwój. Powyżej 1,5 to skok obciążenia i podniesione ryzyko kontuzji. Poniżej 0,8 to wyraźne odpuszczenie — pożądane w taperze, niepożądane w środku bloku.",
      "Wysoki ACWR nie jest wyrokiem. Jest sygnałem, żeby sprawdzić tętno spoczynkowe i HRV, zanim zaplanujesz kolejny mocny akcent.",
    ],
  },
  zones: {
    t: "Strefy tętna — kto je ustala i czy im ufać",
    b: [
      "Apple Watch tworzy pięć stref automatycznie metodą rezerwy tętna, a wartości maksymalną i spoczynkową aktualizuje pierwszego dnia każdego miesiąca. Podstawą maksimum jest data urodzenia z aplikacji Zdrowie.",
      "Konsekwencja: granice stref przesuwają się w czasie. Minuty w strefie 4 sprzed roku nie są tą samą wielkością co dziś, więc obciążenie liczone ze stref nie jest porównywalne między sezonami.",
      "Dlatego ta aplikacja liczy TRIMP z wzoru Banistera, a strefy z zegarka służą wyłącznie do kontroli jakości.",
      "Jak sprawdzić swoje: Ustawienia na zegarku → Trening → Strefy tętna. Widać tryb (Auto lub Ręczny) i granice; można nadpisać strefy 2, 3 i 4.",
      "Test zdrowego rozsądku: strefa 5 to wysiłek maksymalny, nie do utrzymania dłużej niż kilkanaście minut. Sesje z godziną w strefie 5 oznaczają, że granice są za nisko.",
    ],
  },
  hrmax: {
    t: "HR max — najważniejsza liczba w całym rachunku",
    b: [
      "Od niej zależą wszystkie strefy i cała skala TRIMP. Zaniżona sprawia, że każdy trening wygląda na cięższy niż był, a łatwe biegi wypadają w statystyce jako mocne.",
      "Najczęstsze źródło błędu to wzór 220 − wiek. Daje jedną liczbę dla wszystkich osób w tym samym wieku, choć rzeczywisty rozrzut sięga ±10–12 uderzeń.",
      "Wskazówka z pomiarów: jeśli w biegu na dłuższym dystansie utrzymujesz przez ponad godzinę tętno bliskie zakładanemu maksimum, to maksimum jest zaniżone.",
      "Trzy propozycje poniżej: najwyższe zarejestrowane tętno (bezpieczny dolny limit), wzór z wieku (zwykle najniższy) oraz oszacowanie z progu — średnie tętno z najdłuższego mocnego biegu podzielone przez 0,88.",
      "Test maksymalnego wysiłku daje najdokładniejszy wynik, ale jest obciążający i przy dolegliwościach aparatu ruchu warto go wcześniej omówić z lekarzem. Do planowania treningu oszacowanie wystarcza.",
      "To pole jest wersjonowane. Zmiana zapisuje się z datą, więc widać, na jakim założeniu były robione starsze obliczenia.",
    ],
  },
  pace: {
    t: "Tempo przy zadanym tętnie",
    b: [
      "Średnie tempo tych biegów, w których tętno mieściło się w wybranym paśmie. Jeśli przy tym samym tętnie biegniesz z tygodnia na tydzień szybciej, wydolność rośnie.",
      "Uwzględnia nachylenie terenu: od tempa surowego odejmowane są 4 sekundy na kilometr za każde 10 metrów przewyższenia na kilometr.",
      "Przykład: bieg w tempie 6:40/km z 250 m przewyższenia na 12 km to 20,8 m/km, czyli korekta o około 8 sekund — tempo skorygowane 6:32/km. Bez niej każde wybieganie w teren wygląda jak spadek formy.",
      "To przybliżenie liniowe. Powyżej mniej więcej 40 m/km zaniża rzeczywisty koszt podbiegów.",
    ],
  },
  baseline: {
    t: "Wartości bazowe i progi alertów",
    b: [
      "Mediana i odchylenie standardowe z ostatnich 60 dni. Próg alertu to mediana plus lub minus 1,5 odchylenia.",
      "Progi liczone z Twoich danych, nie wpisane na sztywno. Osoba z tętnem spoczynkowym 45 i osoba z 60 potrzebują innych granic.",
      "Tętno spoczynkowe powyżej progu przez dwa dni z rzędu albo HRV poniżej progu przez trzy dni to sygnał do zamiany mocnego akcentu na spokojny bieg.",
      "Pojedynczy odczyt poza progiem nie znaczy nic. Liczy się utrzymujące się odchylenie.",
      "Tętno spoczynkowe odniesienia to mediana najniższego kwartyla, a nie pojedyncze minimum — jeden odstający odczyt nie powinien przesuwać całej skali.",
    ],
  },
  coverage: {
    t: "Pokrycie stref i jakość danych",
    b: [
      "Suma minut we wszystkich pięciu strefach podzielona przez czas trwania sesji. Wartość 1,0 oznacza ciągły odczyt tętna przez cały trening.",
      "Wartości poniżej 0,8 to luki w pomiarze, zwykle na starcie treningu albo przy poluzowanym pasku.",
      "Dla TRIMP bez znaczenia, bo wzór korzysta ze średniego tętna. Pokrycie zostaje jako ostrzeżenie przed analizowaniem rozkładu stref w sesjach z dużymi lukami.",
    ],
  },
  backup: {
    t: "Kopia zapasowa",
    b: [
      "Baza żyje w IndexedDB, czyli w tej przeglądarce na tym urządzeniu. Znika przy czyszczeniu danych witryny.",
      "Na iOS Safari potrafi usunąć dane strony nieużywanej przez około tydzień, jeśli nie jest zainstalowana jako ikona na ekranie głównym.",
      "Dlatego eksport do JSON to funkcja podstawowa, nie dodatek. Jest zarazem sposobem przeniesienia danych między telefonem a komputerem.",
      "Kopia nie zawiera klucza API — ten siedzi osobno i nigdy nie trafia do pliku.",
    ],
  },
};
