# MatchIQ – analiza meczów (Android, iPhone, web, desktop)

Aplikacja pokazuje **wszystkie bieżące mecze** (piłka nożna: 40+ lig i pucharów, tenis: ATP + WTA), statystyki na żywo, składy w 3D, formę, tabele, bezpośrednie mecze oraz **prognozę kto wygra z wyjaśnieniem, co za nią stoi**.

> Typ „kto wygra” wynika **wyłącznie z analizy** (forma, tabela, bilans u siebie / na wyjeździe, świeżość, stawka meczu, H2H, sygnały z sieci, przebieg meczu). **Kursy bukmacherskie nie wchodzą do prognozy** – pokazujemy je tylko dla porównania i zaznaczamy, gdy analiza wskazuje inny wynik niż rynek.

## Pobierz

| Platforma | Jak |
|---|---|
| **Android** | [MatchIQ.apk](https://github.com/diketes/matchiq/releases/latest/download/MatchIQ.apk) – pobierz na telefonie, otwórz, zezwól na instalację z tego źródła. Aktualizacja = zainstaluj nowy plik na starym. |
| **iPhone (najprościej)** | Otwórz w Safari **https://diketes.github.io/matchiq/** → Udostępnij → „Do ekranu początkowego”. Działa jak aplikacja (bez sygnałów z sieci – Google News blokuje przeglądarkę). |
| **iPhone (pełna aplikacja)** | [MatchIQ-iOS-unsigned.ipa](https://github.com/diketes/matchiq/releases/latest/download/MatchIQ-iOS-unsigned.ipa) – zainstaluj z komputera przez [Sideloadly](https://sideloadly.io) albo [AltStore](https://altstore.io) (darmowe Apple ID; aplikacja ważna 7 dni, potem odśwież). Wersji z App Store nie ma – wymaga płatnego konta Apple Developer. |
| **Windows / macOS** | `npm install`, `npm start` (otwiera http://localhost:4400) albo `npm run desktop` (okno Electron). |

Każdy push do gałęzi `main` buduje nowy APK i IPA i podpina je pod [Release „latest”](https://github.com/diketes/matchiq/releases/latest) (GitHub Actions).

## Skąd dane

Publiczne endpointy ESPN (scoreboard, summary, standings, teams, rankings, core API dla tenisa) + nagłówki Google News o drużynach. Bez kluczy API. Aplikacja mobilna pobiera dane bezpośrednio z telefonu – nie potrzebuje żadnego serwera. Ekstraklasa nie jest dostępna w tym źródle.

## Jak liczone są szanse

**Piłka nożna** (`server/football.mjs`)
- Siła ataku i obrony = gole strzelone / stracone na mecz względem średniej ligi (sezon + ostatnie 5 meczów z wagą 35%, regularyzacja przy małej liczbie meczów).
- Atut własnego boiska: typowy gospodarz strzela ~10% więcej, gość ~8% mniej, a do tego **bilans konkretnej drużyny u siebie / na wyjeździe** (punkty i gole).
- Forma (5 ostatnich meczów z wagą malejącą), trend (ostatnie mecze vs sezon), **świeżość** (dni od ostatniego meczu, liczba meczów w 14 dni), **stawka meczu** (końcówka sezonu: walka o tytuł/puchary/utrzymanie vs środek tabeli), bezpośrednie mecze (spotkania u gospodarza liczą się mocniej), sygnały z sieci (kontuzje, zawieszenia, zwolnienia trenerów, powroty).
- Z tego wychodzą oczekiwane gole (xG) → rozkład Poissona z korektą Dixona-Colesa → prawdopodobieństwa 1/X/2, powyżej 2,5 gola, BTTS i macierz wyników.
- Na żywo: aktualny wynik, minuta, momentum (strzały celne, strzały, posiadanie), czerwone kartki → szanse na wynik końcowy.
- Werdykt zawiera „Za: …” – najważniejsze czynniki przemawiające za typem – oraz porównanie z kursami (✓ zgodnie / ≠ analiza).

**Tenis** (`server/tennis.mjs`, `server/markov.mjs`)
- Bazowe szanse z rankingu i punktów rankingowych, korekty za formę (10 ostatnich meczów + przebieg turnieju), bilans na nawierzchni i H2H.
- Model Markowa punkt → gem → set (z tie-breakiem) → mecz: dobieramy skuteczność serwisu obu graczy tak, aby model dał szanse przedmeczowe, a potem liczymy szanse z dowolnego stanu meczu.

## Kupony (symulacja bankrollu)

Zakładka **Kupony** prowadzi wirtualny bankroll (domyślnie 30 zł). Domyślny tryb **analiza**: typ = zwycięzca wg modelu (kurs nie ma wpływu na wybór; musi mieć ≥ 45% szans i pewność ≥ 40%). Tryb **value** (w ustawieniach): tylko typy, którym analiza daje wyraźnie większe szanse niż kurs. Codziennie od 9:00 automat składa do 3 kuponów (solo, AKO 2, „bezpieczny” AKO), stawka ¼ Kelly, a po meczach rozlicza je i aktualizuje bankroll, ROI i skuteczność. **Nic nie jest stawiane automatycznie** – kupon kopiujesz przyciskiem i stawiasz ręcznie, jeśli chcesz. Kursy pochodzą z ESPN (DraftKings). Tenis nie ma kursów w źródle, więc kupony obejmują tylko piłkę.

## Struktura

```
server/    silnik analizy (ESPN, Poisson/Dixon-Coles, Markov, kupony) + wspólny router API (api.mjs) + serwer Express (index.mjs)
src/       front (React + TypeScript + Vite), sceny 3D w src/components/three; src/engine – uruchamia silnik lokalnie w aplikacji
android/   projekt Capacitor (Android Studio / gradle)
ios/       projekt Capacitor (Xcode – wymaga macOS)
electron/  okno desktopowe
.github/   workflow: APK + IPA + GitHub Pages przy każdym pushu
```

## Budowanie

```bash
npm install
npm run build              # wersja z serwerem (dist/)
npm run build:mobile       # wersja z silnikiem w aplikacji (Capacitor / PWA)
npm run cap:sync           # build:mobile + kopiowanie do android/ i ios/
npm run android:apk        # APK: android/app/build/outputs/apk/release/app-release.apk
```

Android: wymaga JDK 21 i Android SDK (platforma 35+). Podpis release: plik `android/keystore/matchiq.properties` (lokalnie) albo sekrety `MATCHIQ_KEYSTORE_B64`, `MATCHIQ_KEYSTORE_PASSWORD`, `MATCHIQ_KEY_ALIAS`, `MATCHIQ_KEY_PASSWORD` (GitHub Actions). Bez klucza APK podpisuje się kluczem debug.

iOS: `npx cap open ios` na macOS z Xcode. Na Windows nie da się zbudować IPA – robi to GitHub Actions (macOS runner).
