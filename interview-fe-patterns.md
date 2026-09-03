# Interview FE Patterns — JS/TS Mechanics

> Baza wiedzy dla pytań o **mechanikę JS/TS** (nie algorytmy — te są w `interview-patterns.md`).
> Zakres: `this` binding, closures, higher-order functions, timery, typowanie generyczne, wzorce FE (debounce/throttle, memoize, event emitter, itd.).

---

## Spis treści

1. [Debounce](#1-debounce)

---

## 1. Debounce

**Kategoria:** Higher-order functions · `this` binding · closures · timery
**Poziom:** oznaczone „Easy", realnie **mid/senior** — sedno leży w `this` i typowaniu, nie w logice.

### Key insight

`debounce` opóźnia wywołanie `fn` aż do momentu, gdy przez `delay` ms nie było _żadnego_ nowego wywołania. Każde wywołanie **resetuje** timer (`clearTimeout` + nowy `setTimeout`). Prawdziwa trudność to nie logika timera — to **poprawne przeniesienie `this` przez granicę asynchroniczną** i **przenośne otypowanie handle'a timera**.

### Canonical implementation

```typescript
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let currentTimerId: ReturnType<typeof setTimeout>;

  return function (this: unknown, ...args: any[]) {
    if (currentTimerId) {
      clearTimeout(currentTimerId);
    }
    currentTimerId = setTimeout(() => fn.apply(this, args), delay);
  };
}
```

### Dwie role `this` (rdzeń zadania)

To jest odpowiedź, którą chce usłyszeć interviewer — nie „użyłem `apply`", tylko rozbicie na dwie osobne role:

| Funkcja                             | Typ        | Rola                                                                                                                                                            |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **outer** (zwracana)                | `function` | Musi **przyjąć** `this` od wołającego: `debounced.apply(ctx)`. Arrow by tu nie zadziałał — nie ma własnego `this`, więc `.apply(ctx)` nie miałby czego ustawić. |
| **inner** (callback w `setTimeout`) | **arrow**  | Musi **przetrwać** z tym `this` do momentu odpalenia timera. Arrow łapie `this` **leksykalnie** w chwili definicji, więc zamraża kontekst z outer.              |
| **`fn.apply(this, args)`**          | —          | Forwarduje zamrożony `this` dalej do oryginalnej `fn`. Bez tego `fn` dostałoby `undefined` (goły call).                                                         |

**Sekwencja psucia się `this`, gdyby callback był zwykłą `function`:**
`setTimeout` po `delay` ms woła callback jako **gołe wywołanie**, poza stackiem `debounced`, bez wstrzyknięcia `this` → `this` === `undefined` (strict) / `globalThis` → kontekst przepada. Arrow to omija, bo w ogóle nie słucha, _jak_ `setTimeout` ją woła — ma `this` już zamrożony.

### Typowanie handle'a timera

```typescript
let currentTimerId: ReturnType<typeof setTimeout>;
```

- `typeof setTimeout` → typ samej funkcji (`typeof` w pozycji typu).
- `ReturnType<...>` → utility type wyciągający typ zwracany z sygnatury.
- **Efekt:** adnotacja dostosowuje się do środowiska sama — `number` pod DOM, `NodeJS.Timeout` pod `@types/node`, `Timer` pod Bun. Kod się nie zmienia.

**Dlaczego nie zwykłe `let id = setTimeout(...)` z inferencją?** Bo zmienna musi istnieć _przed_ returnem, gdy żaden timer jeszcze nie wystartował — nie masz czym jej zainicjalizować w punkcie deklaracji. `ReturnType<typeof setTimeout>` daje adnotację na „pustej" `let` bez commitowania się do nazwy typu.

### Typowanie `this` — `this: unknown`

Zamiana outer z arrow na `function` odpala błąd `noImplicitThis` (część `strict`):

> `'this' implicitly has type 'any' because it does not have a type annotation. ts(2683)`

Logika TS: zwykła `function` może dostać _dowolny_ `this` zależnie od wywołania (`debounced()` vs `debounced.apply(ctx)` vs `obj.debounced()`). TS nie wstawi po cichu `any` — żąda jawnej deklaracji. (Pod arrow błędu nie było, bo arrow nie ma własnego `this`.)

Deklaruje się go jako **fałszywy pierwszy parametr `this`** — istnieje tylko w typach, znika po kompilacji, nie przesuwa pozostałych argumentów:

```typescript
return function (this: unknown, ...args: any[]) {
```

**Czemu `unknown`, a nie konkretny typ ani `any`?** Bo `debounce` jest generyczny i przepuszcza `this` przez `fn.apply(this, args)` — nie czyta z niego żadnych pól. `apply` też nie zakłada nic o `thisArg`, więc `unknown` się tam wciska bez marudzenia.

- **`any`** — wyłącza sprawdzanie; przypadkowe `this.value` przeszłoby cicho i wybuchło w runtime.
- **`unknown`** — pełna swoboda w _przekazywaniu_ (`apply` nic z nim nie robi), zero swobody w _ślepym ufaniu_ (dotknięcie `this.cokolwiek` → TS zatrzymuje: „najpierw sprawdź"). Domyślna preferencja `unknown > any` wszędzie, gdzie wartość tylko przenosisz, nie konsumujesz.

### Named pitfalls (w tym własne anty-wzorce z tego podejścia)

1. **Outer jako arrow function** — mój pierwotny błąd. `return (...args) => {...}` → arrow nie ma własnego `this`, więc `debounced.apply({value: 42})` nie ma czego ustawić → test kontekstu wywala się. Fix: `return function (...args) {...}`.
2. **`fn(...args)` zamiast `fn.apply(this, args)`** — nawet z poprawnym `this` na outer, gołe `fn(...args)` woła `fn` bez kontekstu → `this` w `fn` przepada. Trzeba forwardować jawnie.
3. **`currentTimerId: number`** — fałszywa deklaracja. Sygnatura `setTimeout(...): number` pochodzi z `lib.dom.d.ts`; pod Bun/Node runtime zwraca **obiekt `Timeout`**, nie liczbę (`typeof id === "object"`). Nie wybucha od razu (bo `clearTimeout` przyjmuje ten sam typ), ale jest latentnym błędem. Fix: `ReturnType<typeof setTimeout>`.
4. **Callback w `setTimeout` jako zwykła `function`** — zamiana arrow → `function` w callbacku ponownie gubi `this` (patrz sekwencja wyżej). Callback **musi** zostać arrow.
5. **Brak `this: unknown` po zamianie arrow → `function`** — pod `strict` (`noImplicitThis`) TS rzuca `ts(2683)`: `this` implicitly `any`. Fix to jawna adnotacja `this: unknown` jako pierwszy (fałszywy) parametr. `unknown`, nie `any` — bo `this` tylko przekazujesz przez `apply`, nie dotykasz go.

### Talking points (na rozmowie)

- „Outer robię `function`, żeby **przyjął** `this`; inner robię arrow, żeby ten `this` **przetrwał** do odpalenia timera — arrow łapie `this` leksykalnie, zwykła function dostałaby kontekst od `setTimeout`, czyli żaden."
- „Handle timera typuję przez `ReturnType<typeof setTimeout>` — przenośnie, bez wiązania się z konkretnym runtime. Sygnatura DOM kłamie, że to `number`; pod Node/Bun to obiekt."
- „`this` typuję jako `this: unknown`, nie `any` — bo pod `strict` zwykła `function` wymaga jawnej deklaracji `this`, a ja ten `this` tylko przepuszczam przez `apply`, nie konsumuję go. `unknown` daje przekazywanie bez ślepego ufania."
- Use cases: search input (czekaj aż user przestanie pisać), window resize, ochrona przed double-click.
- **debounce vs throttle:** debounce odpala _po_ ciszy (reset przy każdym callu); throttle odpala _co_ `delay` niezależnie od liczby wywołań (rate limit). Różne narzędzia do różnych problemów.

### Complexity

- Czas: O(1) na wywołanie (clear + set timera).
- Pamięć: O(1) — jeden handle w closure na instancję. Osobne instancje = osobne closures, nie współdzielą stanu.

### Related

- **throttle** — bliźniak, inna semantyka odpalania.
- **`this` binding** — call/apply/bind, arrow vs function, utrata kontekstu przez granicę async (setTimeout, event handlery, callbacki).
- **closures** — `currentTimerId` żyje w domknięciu między wywołaniami.
- **memoize** — inny HOF z prywatnym stanem w closure (cache zamiast timera).

## Length<T> — Tuple Length & Type-Level Programming

**Kategoria:** TS type system — indexed access, tuple arity
**Źródło:** Frontend Masters / type-challenges 1.1

### Insight

Tupla pamięta swoją arność jako **literał liczbowy**. `T["length"]` (indexed access
na typie) wyciąga ten literał. Zwykły `string[]` / `T[]` o nieznanej długości ma
`length: number` — bez literału. To właśnie test na różnicę **tupla vs array**.

Głębszy insight: to nie jest "runtime'owe liczenie zrobione dziwnie". To **obliczenie
na poziomie typów** wykonane przez `tsc` w czasie kompilacji, którego wynik konsumuje
kompilator i edytor — nie działający kod. `arr.length` i `Length<T>` żyją w dwóch
nieprzecinających się światach (typy są **wymazywane / type erasure** przed runtime).

### Canonical implementation

```typescript
type Length<T extends readonly unknown[]> = T["length"];
```

W zadaniu wystarczy `readonly string[]`, ale `readonly unknown[]` jest ogólniejsze —
długość nie zależy od typu elementów.

### Pitfalls (w tym moje z sesji)

1. **[mój anti-pattern]** Napisałem `type Length<T extends string[]> = (arr: T) => number`
   — pomyliłem _opisanie typu funkcji_ z _odczytaniem informacji z typu_. Prawa strona
   type aliasu to NIE ciało funkcji; nie ma tam "return length". Mam **sięgnąć** po
   property typu (indexed access), nie budować sygnaturę funkcji.
2. **Constraint `string[]` odrzuca `as const`.** `typeof tesla` przy `as const` to
   `readonly [...]`, a readonly tupla NIE jest assignable do mutable `string[]`.
   Trzeba `readonly string[]`. Błąd wyskakuje "o krok obok" — przy liniach testowych,
   nie przy definicji.
3. **`string` ma `.length` → zwraca `number`, nie literał.** Case `Length<'hello world'>`
   failuje **dzięki constraintowi** (`string` nie jest assignable do `readonly string[]`),
   a NIE dzięki body. Nawet gdyby wpuścić stringa, `"hello world"["length"]` = `number`,
   nie `11`. Wiedz który mechanizm broni którego case'a — na rozmowie drążą "a co jeśli...".
4. **Inference tupli wymaga `const`.** `function f<T extends readonly unknown[]>(a: T)`
   przy `f([1,2,3])` daje `T = number[]` → `length: number`. Żeby dostać literał:
   `<const T ...>` albo `as const` po stronie callera.

### Talking points

- **"Po co komu type-level programming, skoro można runtime'owo?"**
  → _"Bo przesuwa błędy z runtime do compile-time, a typ wyniku potrafi zależeć od
  wejścia, czego runtime nie zakomunikuje edytorowi."_ Dojrzała odpowiedź, nie wykuta regułka.
- Rozwinięcie: type erasure = dwa światy (czas kompilacji vs runtime). Type-level daje:
  autocomplete, wyłapanie błędu PRZED uruchomieniem, dokumentację która nie kłamie
  (bo inaczej kod się nie kompiluje), bezpieczny refactor (tsc pokazuje wszystkie miejsca).
- Gdzie to realnie zarabia (nie w liczeniu tablic): Next.js route params z literału
  (`"/users/:id"` → `{ id: string }`), Zod `z.infer`, tRPC, Drizzle/Prisma, otypowane
  generyczne komponenty (`<Table columns data />`). `Length` to **kata** ucząca mechanizmu
  (indexed access + arność tupli), nie produkcyjne narzędzie.
- Kiedy NIE iść w typy: koszt = wolniejsza kompilacja, koszmarne error messages,
  czytelność dla zespołu. Jeśli gwarancję da się mieć runtime'owo (Zod na granicy API)
  albo nie jest w ogóle potrzebna — nie rób galaxy-brain conditional types z `infer`
  na trzech poziomach. Dojrzałość = wiedzieć, kiedy gwarancja compile-time jest warta

  ### First<T> — pierwszy element tuple (type-challenges #14)

**Key insight:** `T[0]` dla `[]` zwraca `undefined`, nie `never`
(index poza zakresem). Odróżnienie "puste" od "[undefined]" wymaga
sprawdzenia length ALBO pattern matchingu na kształcie tuple.

**Canonical (idiomatic):**
type First<T extends readonly any[]> =
T extends readonly [infer F, ...any[]] ? F : never;

**Alternatywa (length-based):**
type First<T extends readonly any[]> =
T["length"] extends 0 ? never : T[0];

**Pitfalls:**

- ❌ `T[0]` samo → dla [] daje undefined, nie never
- ❌ `T[0] extends undefined ? never : T[0]` → psuje [undefined]
- tuple ma LITERALNĄ length (0,1,2...); zwykła tablica ma length: number

**Talking point:** "brak elementu" ≠ "element === undefined".
`[infer F, ...]` nie dopasuje pustego tuple → never za darmo.

**Related:** Last<T> (`[...any[], infer L]`), Tail<T>, Length<T>

## throttle — leading + trailing edge

**Problem:** Senior FE Prep. Zaimplementuj `throttle`, które pali na leading edge, gwarantuje wypalenie ostatniego calla w serii (trailing), i nigdy nie strzela częściej niż raz na `delay`.

**Key insight:** Throttle = „pal natychmiast na wejściu do okna, potem najwyżej raz na `delay`, ale nie zgub ostatniego calla". Leading i trailing muszą się **wzajemnie wykluczać w obrębie jednego okna** — jeśli jeden wypala, drugi nie może dopalić w tym samym oknie. To jest oś całego problemu.

**Canonical implementation:**

```typescript
export function throttle<F extends (...args: any[]) => void>(
  fn: F,
  delay: number,
): (...args: Parameters<F>) => void {
  let lastTime = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let freshArgs: Parameters<F>;

  return function throttled(this: unknown, ...args: Parameters<F>) {
    freshArgs = args; // odświeżane co call — trailing strzeli najświeższymi

    if (Date.now() - lastTime > delay && !timerId) {
      // leading: okno minęło I żaden trailing nie tyka
      fn.apply(this, args);
      lastTime = Date.now();
    } else if (timerId === null) {
      // trailing: zaplanuj raz, callback czyta freshArgs (nie args!)
      timerId = setTimeout(() => {
        fn.apply(this, freshArgs);
        lastTime = Date.now(); // symetria do leading — inaczej double-fire
        timerId = null;
      }, delay);
    }
  };
}
```

**Pitfalls (w tym własne anti-patterny):**

1. **Stale args.** Domknięcie nad parametrem `args` łapie dane z calla, który _założył_ timer, nie z ostatniego w oknie. Objaw: trailing strzela `pos2`, gdy user zatrzymał się na `pos3`. Fix: `freshArgs` w scope domknięcia, nadpisywane na górze każdego wywołania; callback czyta `freshArgs`.
2. **Brak `lastTime = Date.now()` w callbacku trailinga.** Po strzale trailinga `lastTime` wskazuje stary leading → następny call liczy `now - lastTime > delay` od zamierzchłego punktu i pali za wcześnie → dwa strzały bliżej niż `delay`. (Potknięcie x2 tej sesji — warte osobnej flashcardy.)
3. **Leading pali, gdy trailing wciąż pending.** Okno minęło, ale uzbrojony wcześniej timer nikt nie rozbroił → leading strzela + timer dopala chwilę później → złamany rate limit. Dwie poprawne obrony:
   - `&& !timerId` w warunku leading — _suppress_ leading, dopóki timer tyka (wersja powyżej; leniwsza, prostsza, zero `clearTimeout` w throttle).
   - `clearTimeout(timerId)` w gałęzi leading — anuluj zbędny trailing (responsywniejsza, pali od razu). Uwaga: `clearTimeout` w throttle jest OK **tylko** w tej gałęzi — w gałęzi „każdy call" byłby debounce'owym resetem okna.
4. **`ReturnType<typeof Date.now>` = cargo-cult.** `Date.now()` jest zabetonowane w ECMA-262 do `(): number` w każdym runtime → to tylko `number` owinięty w szum. Kontrast: `ReturnType<typeof setTimeout>` **jest** uzasadnione, bo typ id timera różni się runtime (browser `number` vs Node `NodeJS.Timeout`). Kryterium: `ReturnType<>` zarabia, gdy typ realnie się waha albo chcesz sprzężenia z czymś poza Twoją kontrolą; odpuść, gdy jest ustalony specyfikacją.

**Notes:**

- `lastTime = 0` (nie `Date.now()`) na starcie — celowe. `0` to „prehistoria" względem realnego `Date.now()` (~1.7e12 ms), więc pierwszy call zawsze pali jako leading. `Date.now()` na starcie zablokowałby pierwszy leading edge.
- `!timerId` działa (id timera zawsze truthy: Node → obiekt, browser → dodatnia liczba), ale dla spójności z `timerId === null` w `else if` rozważ `=== null` w obu miejscach.
- **Opcjonalnie otwarte:** pairing `this`. Arrow-callback łapie `this` z calla, który założył timer, a `freshArgs` z ostatniego → rozjazd, gdy różne `this` w oknie. Fix symetryczny: `freshThis`. W praktyce throttle wisi na jednym kontekście, więc rzadko boli.

**Complexity:** O(1) czasu i pamięci na wywołanie.

**Talking points (rozmowa):**

- Leading vs trailing edge — umieć narysować timeline z burstem `a/b/c`.
- throttle ≠ debounce: debounce resetuje okno (`clearTimeout` co call), throttle gwarantuje regularność. Ciągły scroll przez 10 s przy `delay=300`: debounce strzela **0 razy** w trakcie (dopiero po ustaniu), throttle ~33 razy.
- Wzajemne wykluczanie leading/trailing w oknie (pitfall 3) — mało kto łapie bez podpowiedzi, mocny sygnał.
- `ReturnType<typeof setTimeout>` justified vs `Date.now` cargo-cult (pitfall 4) — pokazuje dojrzałość w TS.

**Related:** `debounce` (dual role of `this`, `ReturnType<typeof setTimeout>`), leading/trailing edge, lodash `_.throttle` / `_.debounce`.

# ES5 `myExtends` — imitacja `class extends` przez prototypy

## Key insight

Konstruktor w JS ma **dwa niezależne sloty prototypowe**, obsługiwane osobno:

- **Slot A — `fn.prototype`**: jawny obiekt, który `new` nadaje instancjom. Obsługuje `instancja.metoda()`.
- **Slot B — `Object.getPrototypeOf(fn)`** (`[[Prototype]]` _samej funkcji_): obsługuje `Konstruktor.static()`.

Pełna imitacja `extends` = **dwa lustrzane, dwuogniwowe łańcuchy** — jeden po `.prototype` (instancje), drugi po `[[Prototype]]` funkcji (static). Funkcja/obiekt ma tylko jeden `[[Prototype]]`, więc jednym linkiem nie złapiesz dwóch przodków — potrzebny łańcuch.
INSTANCJE: dog → MyType.prototype → Dog.prototype → Animal.prototype → Object.prototype
STATIC: DogExtended → Dog → Animal → Function.prototype

## Canonical implementation

```typescript
export const myExtends =
  S extends (...args: any[]) => any,
  T extends (...args: any[]) => any,
>(SuperType: S, SubType: T) => {
  // Step 1: konstruktor — odpala oba ciała na wspólnym this
  const extended = function MyType(
    this: unknown,
    ...args: [...Parameters<S>, ...Parameters<T>]
  ) {
    SuperType.apply(this, args);   // pola instancji: name
    SubType.apply(this, args);     // pola instancji: breed  (later-write-wins)
  };

  // Step 2: łańcuch INSTANCJI (slot A)
  Object.setPrototypeOf(SubType.prototype, SuperType.prototype); // #2: Dog.prototype → Animal.prototype
  extended.prototype = Object.create(SubType.prototype);         // #1: MyType.prototype → Dog.prototype (świeża warstwa)
  extended.prototype.constructor = extended;                     // higiena: wskaźnik zwrotny

  // Step 3: łańcuch STATIC (slot B) — lustro Step 2
  Object.setPrototypeOf(SubType, SuperType);   // #2: Dog → Animal
  Object.setPrototypeOf(extended, SubType);    // #1: extended → Dog

  // Step 4
  return extended;
};
```

## Two "override" mechanisms (nie mylić!)

| Co                               | Mechanizm                     | Kto wygrywa                                     |
| -------------------------------- | ----------------------------- | ----------------------------------------------- |
| Pola instancji (`name`, `breed`) | `.apply` po kolei na `this`   | **last-write-wins** — kto pisze później         |
| Metody (`greet`, `bark`)         | lookup po łańcuchu prototypów | **first-match-in-chain** — kto bliżej instancji |

Efekt semantyczny ten sam ("dziecko przesłania rodzica"), ale jednym rządzi _kolejność zapisu_, drugim _pozycja w łańcuchu_.

## Named pitfalls

**1. Kopiowanie właściwości zamiast delegacji → `instanceof` = false**
`Object.assign(MyType.prototype, Animal.prototype)` sprawia, że `greet()` działa, ALE `Animal.prototype` nigdy nie wchodzi do łańcucha instancji. `instanceof` szuka _obiektu_ w łańcuchu (identyczność), nie jego właściwości → `dog instanceof Animal === false`.
_Root cause_: kopia wartości ≠ obecność obiektu w łańcuchu.
_Fix_: delegacja (wepnij prawdziwy prototyp jako ogniwo).

**2. Alias `child.prototype = parent.prototype` zamiast `Object.create` → prototype pollution**
`=` to aliasing: obie nazwy wskazują _jeden_ obiekt. Zapis na `child.prototype` (np. fixup `.constructor`) wycieka na `parent.prototype`. Testy happy-path przechodzą, produkcja płonie.
_Root cause_: brak własnej warstwy dla child; współdzielony obiekt z parentem.
_Counterexample_: `child.prototype.constructor = child` → `new Parent().constructor === child` (bug).
_Fix_: `Object.create(parent.prototype)` — świeża warstwa delegująca przez referencję (nie kopia → łańcuch wciąż dochodzi do prawdziwego parenta, `instanceof` działa).

**3. Static przez jeden link (`setPrototypeOf(child, grandparent)`) → gubi statyki pośredniego rodzica**
`setPrototypeOf(extended, SuperType)` łapie tylko statyki `SuperType`; static na `SubType` przepada, bo łańcuch funkcji pomija `SubType`.
_Root cause_: funkcja ma jeden `[[Prototype]]` → dziedziczenie z dwóch przodków wymaga łańcucha, nie linku.
_Fix_: `extended → SubType → SuperType` (lustro łańcucha instancji).

**4. `x.prototype = Object.create(parent.prototype)` gubi automatyczny `.constructor`**
Podmiana `.prototype` na świeży pusty obiekt wyrzuca oryginalne `{ constructor: x }`. `instancja.constructor` przeskakuje po łańcuchu na parenta.
_Root cause_: nowy obiekt z `Object.create` nie ma własnego `.constructor`.
_Fix_: `x.prototype.constructor = x` — bezpieczny **tylko** dzięki `Object.create` (piszesz na warstwie child); przy aliasie brudziłby parenta (patrz pitfall #2).

## Gotchas

- **`.prototype` (slot A) ≠ `[[Prototype]]` funkcji (slot B)**: `F.prototype !== Object.getPrototypeOf(F)`. Nazwa `.prototype` myli — to "obiekt dla instancji", nie "prototyp tej funkcji".
- **Named function expression**: `const extended = function MyType(){}` — `MyType` widoczne tylko wewnątrz ciała (rekurencja, `.name` w stack trace); z zewnątrz `MyType` → `ReferenceError`. `extended.prototype` i "MyType.prototype" to ten sam obiekt.
- **`Object.create` linkuje przez referencję, nie kopiuje**: `getPrototypeOf(Object.create(x)) === x`. To dlatego łańcuch dochodzi do prawdziwego parenta.
- **`.apply` vs `.call`**: `apply(this, args)` bierze `args` jako tablicę (mamy już tablicę z rest); `call` wymagałby `...args`.
- **Kolejność linijek w Step 2 wymienna**: `Object.create(SubType.prototype)` trzyma _referencję_ do żywego `Dog.prototype`, więc późniejszy `setPrototypeOf` na nim jest widziany.
- **Mutacja inputu**: `setPrototypeOf(SubType.prototype, ...)` i `setPrototypeOf(SubType, ...)` trwale mutują cudze `Dog`/`Dog.prototype`. Akceptowalny kompromis dla imitacji `extends` (to samo robi Babel `_inherits`), ale świadomy.

## TS typing

- `<S extends (...args: any[]) => any>` + `(SuperType: S)` → TS **wnioskuje** konkretny `(name: string) => void`, więc `Parameters<S>` = prawdziwa tupla `[name: string]`, nie `any[]`. Bez generyka `Parameters<(...args: any[]) => any>` = `any[]` → dwa spready `any[]` w tupli = błąd 1265 (rest po rest).
- `[...Parameters<S>, ...Parameters<T>]` = konkatenacja tupli (tu `[name: string]` + `[]` = `[name: string]`) — zachowuje arność dla call-site (`new DogExtended('Rex')` chce string). Czysto ergonomia typów; runtime działa identycznie z `any[]` (args tylko przekazywane, nie czytane po indeksie).
- `this: unknown` — phantom parameter (typuje `this` pod `noImplicitThis`, nie jest realnym argumentem).

## Talking points

- _"Konstruktor ma dwa sloty prototypowe: `.prototype` dla instancji, `[[Prototype]]` funkcji dla static — imitacja extends obsługuje oba osobno, każdy dwuogniwowym łańcuchem."_
- _"`instanceof` sprawdza obecność obiektu w łańcuchu, nie właściwości — dlatego kopiowanie metod nie wystarcza, potrzebna delegacja."_
- _"`Object.create(parent.prototype)` daje child własną warstwę delegującą do parenta — bez tego alias brudzi parenta przy każdym zapisie."_
- _"To dokładnie to, co generuje Babel dla `class extends` (`_inherits` przestawia oba: `.prototype` i static)."_

## Complexity

Setup O(1). Property lookup O(d) gdzie d = głębokość łańcucha (tu stała, 4-5 ogniw).

## Related

- `debounce`/`throttle` — `this` binding, phantom `this` parameter, `.apply`
- type-challenges: `Parameters`, konkatenacja tupli, `extends` jako constraint vs dziedziczenie
- Follow-up interview Q: _"czemu `dog.constructor` pokazuje złą funkcję?"_ → pitfall #4

## myExtends — dziedziczenie w stylu ES5 (`class ... extends` pod maską)

### Key insight

`extends` da się odtworzyć na dwa różne **modele**, nie warianty:

- **A — classical constructor (dual parallel chains).** Konstruktor operuje na `this`, wymaga `new`. Typ złożony dostaje **własne, pośrednie ogniwo prototypu** (`Combined.prototype = Object.create(Sub.prototype)`), przez co łańcuch instancyjny i statyczny są **równoległe**, ogniwo w ogniwo — jak w ES6 `class`.
- **B — factory.** Funkcja buduje obiekt przez `Object.create(Sub.prototype)`, aplikuje oba konstruktory i **jawnie go zwraca**. Instancja jest zakorzeniona **bezpośrednio** w `Sub.prototype`; `Combined.prototype` jest martwy. Działa z `new` i bez `new`.

Rdzeń różnicy: **method resolution** chodzi po CAŁYM łańcuchu (więc obie wersje dają identyczny dostęp do metod obu rodziców), ale `instanceof` i `.constructor` patrzą na **pierwsze ogniwo** (bezpośredni prototyp). Dlatego jedno dodatkowe ogniwo na górze zmienia obserwowalne zachowanie, mimo że metody działają tak samo.

```text
A:  obj → Combined.prototype → Sub.prototype → Super.prototype → Object.prototype
B:  obj →                      Sub.prototype → Super.prototype → Object.prototype
```

### Canonical implementation

```ts
// A — classical constructor, new-mandatory, pełne typy
export const myExtends =
  S extends (...args: any[]) => any,
  T extends (...args: any[]) => any,
>(SuperType: S, SubType: T) => {
  const extended = function MyType(
    this: unknown,
    ...args: [...Parameters<S>, ...Parameters<T>]
  ) {
    SuperType.apply(this, args);
    SubType.apply(this, args);
  };
  Object.setPrototypeOf(SubType.prototype, SuperType.prototype); // instancyjny: Sub → Super
  extended.prototype = Object.create(SubType.prototype);         // dodatkowe ogniwo
  extended.prototype.constructor = extended;                     // napraw back-pointer
  Object.setPrototypeOf(SubType, SuperType);                     // statyczny: Sub → Super
  Object.setPrototypeOf(extended, SubType);                      // statyczny: MyType → Sub
  return extended;
};

// B — factory, new-agnostic, typy luźne
export const myExtends = (SuperType: Function, SubType: Function) => {
  function ExtendedType(...args: any[]) {
    const target = Object.create(SubType.prototype); // instancja zakorzeniona wprost w Sub.prototype
    SuperType.apply(target, args);
    SubType.apply(target, args);
    return target;                                   // jawny return → new-agnostic
  }
  Object.setPrototypeOf(SubType.prototype, SuperType.prototype);
  Object.setPrototypeOf(ExtendedType, SuperType);    // statyczny: Extended → Super (Sub pominięty!)
  return ExtendedType;
};
```

Zachowanie (zweryfikowane runtime, strict mode):

| cecha                                      | A                 | B              |
| ------------------------------------------ | ----------------- | -------------- |
| own props obu konstruktorów                | ✅                | ✅             |
| metody proto Super + Sub                   | ✅                | ✅             |
| `instanceof Combined`                      | ✅ true           | ❌ false       |
| `inst.constructor`                         | `MyType`          | `Sub` (mylące) |
| static Super z Combined                    | ✅                | ✅             |
| static Sub z Combined                      | ✅                | ❌ MISSING     |
| bez `new`                                  | rzuca `TypeError` | zwraca obiekt  |
| równoległość chain instancyjny ‖ statyczny | ✅                | ❌ asymetria   |

### Named pitfalls (z root cause)

1. **B: `instanceof Combined` = false, `constructor` = Sub.**
   Root cause: instancja zakorzeniona wprost w `Sub.prototype`, więc `ExtendedType.prototype` (domyślny, `{constructor: ExtendedType}` z proto `Object.prototype`) nigdy nie trafia do łańcucha — jest martwy. `instanceof` nie znajduje `Combined.prototype`; `constructor` rozwiązuje się na pierwszym ogniwie = `Sub.prototype`.

2. **B: statics `SubType` niedostępne z typu złożonego.**
   Root cause: łańcuch statyczny to tylko `Extended → Super`; `Sub` nie jest w nim wcale. A ma `MyType → Sub → Super`, więc widzi statics obu.

3. **`Object.create(proto)` gubi własny `constructor`.**
   Root cause: `Object.create` produkuje obiekt bez własnego `constructor` → bez ręcznego `extended.prototype.constructor = extended` `inst.constructor` zjechałby po łańcuchu do `Sub`. To jest dokładnie ten bug, który B ma „wbudowany".

4. **Efekt uboczny: mutacja przekazanego `SubType` (dzielony przez A i B).**
   Root cause: `Object.setPrototypeOf(Sub.prototype, Super.prototype)` mutuje in-place współdzieloną referencję → po wywołaniu goły `new Sub()` też staje się `instanceof Super`. A dodatkowo mutuje statyczny proto `Sub` (`setPrototypeOf(Sub, Super)`), więc skaża `Sub` mocniej (instancyjnie **i** statycznie); B tylko instancyjnie.

5. **A wymaga `new`.**
   Root cause: brak jawnego `return` → poleganie na `[[Construct]]`. W module (strict) wywołanie bez `new` daje `this === undefined`, `Super.apply(undefined, …)` rzuca `TypeError`. B jest odporne, bo zwraca obiekt jawnie (`new` odrzuca auto-`this`, gdy konstruktor zwróci obiekt).

6. **Reasoning trap: „bezpośredni prototyp" ≠ „prototyp osiągalny w łańcuchu".**
   Root cause: kuszące jest spłaszczenie węzła do jego rodzica — „obiekt, którego prototypem jest `Sub.prototype`" (czyli `Combined.prototype`) potraktować jak samo `Sub.prototype`. Ale to osobny obiekt (`Combined.prototype !== Sub.prototype`). Method resolution tego nie rozróżnia (oba dosięgają `Sub.prototype`), więc łatwo wywnioskować „wychodzi na to samo" — a `instanceof`/`constructor` natychmiast to demaskują.

### Talking points

- „`extends` zaimplementowałem dwoma modelami i porównałem. Classical-constructor odtwarza **dual parallel prototype chain** jak ES6 `class` — `instanceof`, `constructor` i statics działają, bo typ złożony ma własne ogniwo w obu równoległych łańcuchach. Factory jest krótsza i new-agnostyczna, ale zakorzenia instancję wprost w prototypie potomka, więc `instanceof CombinedType` zwraca false, a `constructor` wskazuje na potomka."
- Trade-off do nazwania: **wierność semantyce `class`** (A) vs **prostota + odporność na sposób wywołania** (B).
- „Oba dzielą jeden efekt uboczny: `setPrototypeOf` mutuje przekazany `SubType` globalnie."
- Rozstrzygnięcie „który był potrzebny" = które asercje faktycznie były w test harnessie (`instanceof Combined`? `constructor`? statics `Sub`?). To jest jedyny obiektywny arbiter, nie estetyka.

### Analogia (deliberate practice)

Dual parallel chains (A) = ten sam pasaż obiema rękami w unisono — ręka instancyjna i statyczna grają tę samą linię, ogniwo w ogniwo (czysta artykulacja struktury `class`). Factory (B) = melodia prawą, uproszczony akompaniament lewą — na instancji brzmi poprawnie, ale to nie ta sama dwugłosowa faktura.

### Related topics

`Object.create` vs `Object.setPrototypeOf` · `[[Construct]]` i reguła „konstruktor zwraca obiekt" · `[[Prototype]]` vs `.prototype` vs `__proto__` · instance chain vs static/constructor chain · `instanceof` (Symbol.hasInstance) i mechanika `.constructor` · side-effecty mutacji prototypu

## TupleToUnion<T> — indexed access z `number`

**Key insight:** `T[number]` wyciąga unię typów wszystkich elementów tupla. Indeksowanie _literałem_ (`T[0]`) daje jedną pozycję; indeksowanie _typem_ `number` pyta o "dowolny indeks naraz", więc TS zwraca unię wszystkich pozycji.

### Canonical implementation

```typescript
type TupleToUnion<T extends any[]> = T[number];
```

### Dlaczego `number` produkuje unię

- `T[0]` → jeden literał (`Arr[0]` w `['1','2','3']` = `'1'`, NIE `string`)
- `T[0 | 1]` → `T[0] | T[1]` (indexed access rozdziela się po unii kluczy)
- `T[number]` = "najszersza unia numerycznych indeksów tupla" → unia wszystkich elementów
- Jednoelementowy tupel: `[123][number]` = `123` (unia z jednym członem = ten człon)

### Named pitfalls

1. **`Arr[0]` to literał, nie `string`.** Root cause: literały żyją tylko w tuplach / typach literalnych. TS pamięta konkretną wartość na konkretnej pozycji, dopóki typ nie zostanie rozszerzony do `string[]`.
2. **`T[number]` na zwykłej tablicy gubi literały.** Root cause: `string[]` nie pamięta pozycji — każdy indeks to `string`, więc `TupleToUnion<string[]>` = `string`, nie unia literałów. Union literałów dostajesz tylko z tupla.

```typescript
type A = TupleToUnion<[123, "456", true]>; // 123 | '456' | true
type B = TupleToUnion<string[]>; // string
```

3. **`Number` vs `number`.** Root cause: `Number` to JS-owy obiekt-wrapper, `number` to typ prymitywu. W indexed access chcesz `number`.

### Talking points

- Mechanizm nazywa się **indexed access type**. `T[number]` to jego przypadek: indeksowanie typem zamiast literałem.
- "`T[number]` wyciąga union typu elementów; dla tupla literałów dostaję unię literałów, dla zwykłej tablicy — szeroki typ elementu."
- Dystrybutywność po unii kluczy: `T[K1 | K2]` = `T[K1] | T[K2]`.

### Related topics

- `keyof` + `T[keyof T]` (unia typów wartości obiektu — ten sam mechanizm, inny zbiór kluczy)
- Literal types vs widened types (`'1'` vs `string`)
- Distributive nature indexed access
- Mapped types (kolejny krok: iteracja po kluczach zamiast unii)

## Pick<T, K> — reconstruction

**Key insight:** Constraint `K extends keyof T` to warunek konieczny, nie kosmetyka — bez niego `T[P]` w ciele jest nielegalne, bo TS nie ma gwarancji, że `P` to klucz `T`.

**Canonical implementation:**

```typescript
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
```

**Named pitfalls:**

- **Brak constraintu (`K extends keyof T`)** → dwa błędy naraz: (a) `T[P]` nie kompiluje się, bo `P` może nie być kluczem `T`; (b) test `@ts-expect-error` na `MyPick<Todo, "invalid">` sam się wysypuje, bo bez constraintu nie ma błędu do złapania.
- **Mylenie constraint z default** → `K extends keyof T` (ograniczenie) to nie to samo co `K = keyof T` (wartość domyślna). Tu potrzebny constraint.

**Complexity:** type-level, O(|K|) mapowań.

**Talking points:**

- `keyof T` produkuje union literalów-kluczy; `extends` na generyku działa jak bound, nie jak equality.
- Mapped type `[P in K]` jest homomorficzny — zachowuje modyfikatory (`readonly`, `?`) źródła, co odróżnia go od ręcznego budowania obiektu.

**Related:** `Omit<T, K>` (dopełnienie — `Exclude<keyof T, K>`), `Record<K, T>`, `Partial<T>`.

## Deep Equals (rekurencyjne porównanie głębokie)

**Key insight:** Rekurencyjne zejście przez struktury + `Map` na wykrywanie cykli
(optymistyczne parowanie a→b). Sednem NIE jest algorytm, tylko **kolejność
strażników**: guard na `null` i rozgałęzienie typu muszą wyprzedzać każdy
dostęp do własności (`.length`, `Object.keys`), bo `typeof null === "object"`.

**Canonical implementation:**

```typescript
function deepEquals(a: any, b: any, cache = new Map()): boolean {
  if (cache.has(a) && cache.get(a) === b) return true; // cykl: para już widziana
  cache.set(a, b);

  if (a === b) return true; // prymitywy + ta sama referencja + null/null
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false; // MUSI być przed .length / .keys

  if (Array.isArray(a) !== Array.isArray(b)) return false; // symetria [] vs {}
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEquals(v, b[i], cache));
  }
  if (typeof a === "object") {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every(
      (k) => Object.hasOwn(b, k) && deepEquals(a[k], b[k], cache),
    );
  }
  return false;
}
```

**Named pitfalls + root cause:**

1. `typeof null === "object"` → `null` wpada w gałąź obiektową/tablicową i
   `Object.keys(null)` / `null.length` RZUCA. Fix: guard na `null` PRZED
   dostępem do własności, ale PO `a === b` (żeby `null/null` dało `true`).
2. Płytkie porównanie tablic: `b[i] === val` porównuje referencje →
   `[[1]] vs [[1]]` daje `false`. Fix: rekurencja `deepEquals(val, b[i])`.
3. `b[key] === undefined` NIE odróżnia braku klucza od wartości `undefined`
   → psuje `{a: null}` / `{a: undefined}`. Fix: `Object.hasOwn(b, key)`.
4. `b.hasOwnProperty(key)` zakłada prototyp → `Object.create(null)` nie ma
   tej metody i RZUCA. Fix: `Object.hasOwn` (ES2022) lub
   `Object.prototype.hasOwnProperty.call(b, key)`.
5. Asymetria `{} vs []`: `Array.isArray` sprawdzane tylko dla `a`. Fix:
   `Array.isArray(a) !== Array.isArray(b)`.

6. implicit undefined z brakującego returnu maskuje się w rekurencji (falsy), ujawnia na top-level prymitywie

**Out of scope (nazwij na rozmowie):**

- `NaN`: `===` daje `false`; lodash traktuje `NaN` jako równe (semantyka
  `SameValueZero`). Wybór projektowy.
- `Date`/`RegExp`/`Map`/`Set`: mają puste enumerowalne klucze → wyglądają jak
  `{}`. Wymagają dedykowanej gałęzi (`instanceof Date` → porównaj `.getTime()`).

**Complexity:** O(n) po sumie węzłów obu struktur; przestrzeń O(d) stos +
O(k) cache (k = liczba odwiedzonych węzłów-obiektów).

**Talking points:**

- „Guard order matters" — jednozdaniowa pointa całego zadania.
- Cache mapuje wartości, nie booleany → optymistyczne założenie równości
  przy cyklu (wystarczające, bo cykl domyka się na tej samej parze).

**Related:** structural sharing (Immer), `Object.is` vs `===`, memo
comparators w React (`React.memo`, `useMemo` deps).

**What is the recommended step-by-step approach for implementing a deep equals function?**

1. Strictly compare two values for equality and return if true.
2. Perform type checking on both values.
3. If types are not equal, return false.
4. If types are equal and primitive, return the comparison result.
5. If types are objects or arrays, check the cache to see if this pair has already been processed (to handle circular references).
6. Store the current pair in the cache.
7. Compare the length/number of keys - if lengths differ, return false.
8. Recursively compare each key and value, passing the cache to prevent infinite loops.

## deepClone (rekurencyjny, z obsługą cykli)

**Źródło:** UI interview prep course, problem 10. Wynik: 50/50 testów.
**Weryfikacja:** fuzz 20 000 losowych struktur (prymitywy / Date / Array / Object / Map / Set,
głębokość do 4) — 0 błędów, brak współdzielonych referencji, brak mutacji oryginału.

---

### Key insight

Cztery typy kolekcji różnią się dokładnie w **trzech miejscach**: (1) jak stworzyć pusty
kontener, (2) jak iterować, (3) jak zapisać. Wyciągnięcie tych trzech różnic do helperów
(`getTarget` / `entries` / `set`) sprowadza pętlę główną do jednego bloku wspólnego dla
`object` / `array` / `map` / `set`.

Cykle rozwiązuje `Map<original, clone>` — ale sedno leży w **momencie zapisu**, nie w
istnieniu cache'a.

> Helpery są **destylatem** rozwiązania, nie punktem wyjścia. Kolejność pracy: napisz
> zduplikowane bloki dla object i array → zobacz, co się różni → dopiero wtedy wyciągaj
> funkcje. Zaczynanie od pustych helperów w nagłówku pliku to pułapka.

---

### Canonical implementation

```typescript
import { detectType } from "@course/utils";

type TCollection = Map<any, any> | Set<any> | Record<any, any> | Array<any>;

function getTarget(type: string): TCollection {
  switch (type) {
    case "map":
      return new Map();
    case "set":
      return new Set();
    case "array":
      return [];
    default:
      return {};
  }
}

function entries(target: TCollection): Iterable<[key: any, value: any]> {
  if (target instanceof Map || target instanceof Set || Array.isArray(target)) {
    return target.entries();
  }
  return Object.entries(target);
}

function set(target: TCollection, key: any, value: any) {
  if (target instanceof Map) {
    target.set(key, value);
  } else if (target instanceof Set) {
    target.add(value);
  } else if (Array.isArray(target)) {
    target[key] = value; // split solely for TS narrowing
  } else {
    target[key] = value;
  }
}

export const deepClone = <T>(a: T, cache = new Map()): T => {
  if (!a || typeof a !== "object") return a; // (1) prymitywy + null
  if (cache.has(a)) return cache.get(a); // (2) warunek stopu dla cykli

  const type = detectType(a); // (3) dopiero teraz — nie marnuj na liściach

  switch (type) {
    case "date": {
      const clone = new Date(Number(a));
      cache.set(a, clone); // (4) tożsamość Date też ma znaczenie
      return clone as T;
    }
    case "object":
    case "array":
    case "map":
    case "set": {
      const clone = getTarget(type);
      cache.set(a, clone); // (5) PRZED pętlą — tying the knot
      for (const [key, value] of entries(a)) {
        set(clone, deepClone(key, cache), deepClone(value, cache));
      }
      return clone as T;
    }
    default:
      throw new Error("Unsupported type " + type); // (6) whitelist guard
  }
};
```

**Trace dla cyklu** `const o = {a:1}; o.self = o`:

```
deepClone(o)
  clone = {}                       cache: { o -> {} }
  entries: [["a",1], ["self",o]]
  key "a"    -> deepClone(1)   -> 1          clone = {a:1}
  key "self" -> deepClone(o)
                 cache.has(o) -> HIT
                 zwraca {a:1}  ← klon NIEKOMPLETNY w tym momencie
  clone.self = <ten sam obiekt>
  return clone                     clone = {a:1, self:<siebie>}
```

Zweryfikowane empirycznie: w momencie trafienia w cache klon miał klucze `["a"]`,
po powrocie `["a","self"]`, a `out.self === out` → `true`.

---

### Named pitfalls

**1. Tying the knot — cache zapisany PO pętli**

Root cause: warunek stopu rekurencji powstaje dopiero po jej zakończeniu → zależność
cykliczna. Pętla czeka na rekurencję, rekurencja czeka na cache, cache czeka na pętlę.

```
cache.set przed pętlą → OK, clone.self === clone
cache.set po pętli    → RangeError: Maximum call stack size exceeded
```

Reguła: **wpis do cache'a znaczy „ten klon ma już TOŻSAMOŚĆ", nie „jest gotowy".**
Rozdzielenie tożsamości od zawartości. Działa, bo przekazujesz referencję, a zewnętrzna
pętla dopełnia ten sam obiekt zanim ktokolwiek z zewnątrz go zobaczy.

**2. Klucze Map nie były klonowane**

```js
const k = {id:1};
const m = new Map([[k, "v"]]);
[...deepClone(m).keys()][0] === k   // true  ← WSPÓŁDZIELONE
[...structuredClone(m).keys()][0] === k  // false
```

Fix: `set(clone, deepClone(key, cache), deepClone(value, cache))`.
Bezpieczne dla wszystkich typów — klucz tablicy to `number`, obiektu `string` (przechodzą
przez guard prymitywów bez zmian), w `Secie` klucz jest ignorowany. Działa nawet cykl
przez klucz mapy, bo `key` idzie przez ten sam cache.

**3. Date poza cache'em → utrata tożsamości**

```js
const d = new Date(0);
deepClone({x:d, y:d}).x === .y        // false  (dwie różne daty!)
structuredClone({x:d, y:d}).x === .y  // true
```

Wartości się zgadzają, tożsamość nie. Cykle tego nie wykrywają (Date nie ma dzieci),
więc typowy test suite przepuszcza.

**4. Lookup table zwracająca mutowalne wartości**

```js
const targets = { array: [], map: new Map() }; // ← ewaluacja RAZ
return targets[type];
```

Wszystkie klony współdzielą jedną instancję:

```js
deepClone({a:[1], b:[2]}).a === .b   // true (!!)
```

Fix: `switch`/`case` (ewaluacja przy każdym wywołaniu) albo fabryki `{ array: () => [] }`.

**5. `if (cachedClone)` zamiast `cache.has(a)`**

Correct by accident: działa tylko dlatego, że `getTarget` zawsze zwraca truthy.
Jedna falsy wartość w cache'u → nieskończona rekurencja. `has()` kosztuje tyle samo.

**6. `throw` stringiem z konkatenacją obiektu**

```js
const w = Object.create(null);
w[Symbol.toStringTag] = "Weird";
"Unsupported type " + w;
// → TypeError: Cannot convert object to primitive value
```

Zamiast czytelnego „Unsupported type weird" dostajesz mylący `TypeError` z innej warstwy.
Osiągalne, nie teoretyczne. Fix: `throw new Error("Unsupported type " + type)` —
konkatenuj **string z detectType**, nie obiekt. Plus rzucony string nie ma stack trace'u
i `catch (e) { e.message }` daje `undefined`.

---

### Whitelist over blacklist (type dispatch)

`getTarget` ma `default: return {}` — sam w sobie jest **blacklistą**. Whitelistę realizuje
`switch` w `deepClone` przez wyliczenie case'ów + `default: throw`.

Bez tego:

```
Object.entries(/ab+c/g)      → []
Object.entries(new WeakMap()) → []
Object.entries(new Error("x")) → []
Object.entries(Promise.resolve()) → []
```

→ każdy z nich klonuje się **po cichu do `{}`**. Zero enumerowalnych właściwości, żadnego
błędu. Silent data corruption — najgorsza klasa buga, bo ujawnia się trzy warstwy dalej.

Ta sama reguła w `entries()`: sprawdzaj „czy to Map/Set/Array" (whitelist), nie „czy to
plain object, else `.entries()`" (blacklist) — bo w drugiej wersji `new Foo()` trafia do
`else` i wybucha `TypeError: target.entries is not a function`. Whitelist degraduje się
sensownie (klonuje jak obiekt), blacklist crashuje.

**Reguła ogólna:** wypisuj przypadki, które umiesz obsłużyć, i miej bezpieczny fallback.
Nie definiuj „wszystkiego innego" przez negację — „wszystko inne" jest nieskończone
i nie masz nad tym kontroli.

---

### Complexity

Czas **O(n)**, pamięć **O(n)** — n = liczba węzłów w grafie. Cache dodaje O(n) pamięci
i gwarantuje, że każdy węzeł jest odwiedzany dokładnie raz. Bez niego cykl = nieskończoność,
a graf z wieloma ścieżkami do tego samego węzła = wykładniczy blow-up.

---

### Znane ograniczenia (nazwać zanim zapytają)

| ograniczenie                       | zachowanie                                 | structuredClone        |
| ---------------------------------- | ------------------------------------------ | ---------------------- |
| gettery                            | klonowana wartość, nie getter              | tak samo               |
| klucze symbolowe                   | gubione                                    | gubione                |
| non-enumerable props               | gubione                                    | gubione                |
| własne props na tablicy (`a.meta`) | gubione                                    | gubione                |
| instancja klasy                    | zwykły obiekt, `instanceof Foo → false`    | tak samo               |
| `Object.create(null)`              | klon zyskuje `Object.prototype`            | zachowuje brak proto   |
| tablice rzadkie `[1,,3]`           | dziura → `undefined` (`1 in clone → true`) | zachowuje dziurę       |
| funkcje                            | zwracane przez **referencję**              | rzuca `DataCloneError` |

Dwie warte komentarza:

- **Tablice rzadkie:** `Array.prototype.entries()` **nie pomija dziur**, w odróżnieniu od
  `Object.entries` / `forEach` / `map`. Ironicznie — `Object.entries` dałoby tu wynik
  zgodny ze `structuredClone`.
- **Funkcje:** przechodzą bokiem, bo `typeof fn === "function"` → guard prymitywów je
  przepuszcza i `switch` nigdy ich nie widzi. To **dziura w whiteliście**. Zwracanie przez
  referencję jest obronialne (lodash `cloneDeep` robi tak samo — klonowanie domknięcia
  jest niemożliwe), ale musi być decyzją, nie przypadkiem.

**Poprawne bez zarzutu:** `-0` zachowane (`Object.is` → true), `NaN` w `Secie` działa
(SameValueZero), `null`, `Infinity`, wszystkie wartości falsy.

---

### Talking points

- rozdzielenie tożsamości od zawartości („tying the knot") — czemu cache przed pętlą
- czemu whitelist, nie blacklist, przy dispatchu po typie
- `instanceof` vs `toString.call`: trade-off narrowing w TS ↔ cross-realm safety
- co `structuredClone` robi lepiej (klucze Map, tożsamość Date, dziury) i czego nie umie
  (funkcje, prototypy klas)
- „`any` w pozycji klucza to nie »dowolny klucz«, tylko »przestań sprawdzać«"
- correct by accident vs correct by construction (`if (cachedClone)` vs `cache.has`)

---

### Related

- **deepEquals** — ten sam problem cykli, ale cache keyed na **PARZE**: `Map<a, Set<b>>`,
  nie na pojedynczym węźle (jeden node może być porównywany z wieloma partnerami)
- **structuredClone** — natywne, ale rzuca na funkcjach i gubi prototypy klas
- **lodash cloneDeep** — ground truth dla edge case'ów

---

---

## TEMATY POBOCZNE (z sesji nad deepClone)

Rzeczy, które wypłynęły przy okazji. Część z nich to samodzielne pytania rekrutacyjne.

---

### A. Tablica to nie „obiekt z numerami jako kluczami"

To prawda co do _storage_, ale niekompletna. Klon zbudowany jako `{}` zamiast `[]`:

```
clone            = {"0":2,"1":3}
clone.length     = undefined
isArray(clone)   = false
proto            = Object.prototype
clone.map        = undefined
[...clone]       = TypeError: clone is not iterable
```

Tracisz `length`, `Array.isArray`, wszystkie metody i iterowalność. Wszystko wisi na
**prototypie kontenera**, czyli na tym, czym literalnie zainicjalizowałeś zmienną.

**`length` nie jest własnością enumerowalną** — nie da się go doklonować kopiując entries.
Ale gdy kontener _jest_ tablicą, utrzymuje się sam: zapisujesz `arr["0"]` i `arr["1"]`,
`length` staje się `2`.

Powód: tablica to **exotic object** z własnym `[[DefineOwnProperty]]`, który synchronizuje
`length`, plus `Array.prototype`. Tego nie da się odtworzyć kopiowaniem właściwości.

---

### B. `Object.entries` vs `.entries()` — typ klucza

```js
Object.entries([10, 20])   // [["0",10],["1",20]]   klucze STRING
[...[10, 20].entries()]    // [[0,10],[1,20]]       klucze NUMBER
```

Runtime jest obojętny (`arr["0"] = v` działa), ale TS nie — indeksowanie tablicy stringiem
to `TS7015`.

Kształty dla wszystkich czterech:

```
Map:    [["k",1]]          klucz dowolny
Set:    [[10,10],[20,20]]  klucz = WARTOŚĆ (zduplikowana!)
Array:  [[0,10],[1,20]]    klucz number
Object: [["a",1]]          klucz string
```

**`Set.prototype.entries()` zwraca `[value, value]`** — wartość zduplikowaną. Wygląda
absurdalnie, ale sens jest taki: dostarczyć kształt `[key, value]` tam, gdzie klucza nie ma,
żeby `Set` był kompatybilny z kodem iterującym kolekcje generycznie. Idealnie pasuje do
`set()`, który dla `Seta` i tak ignoruje klucz.

---

### C. `typeof` vs `instanceof` vs `toString.call`

```
wartość      typeof     toString.call
{}           object     [object Object]
[]           object     [object Array]
new Map()    object     [object Map]
new Set()    object     [object Set]
new Date()   object     [object Date]
null         object     [object Null]
```

`typeof` ma osiem możliwych wyników i tylko jeden dotyczy obiektów. Odpowiada na pytanie
**„prymityw czy obiekt?"** — do tego jest idealny (guard na górze `deepClone`). Do
rozróżniania _rodzajów_ obiektów jest bezużyteczny.

`instanceof` sprawdza, czy `X.prototype` występuje **gdziekolwiek na łańcuchu prototypów**.
Jedyny wbudowany operator odpytujący łańcuch. Uwaga: `class MyMap extends Map {}` też
przejdzie `instanceof Map`.

**Cross-realm — `instanceof` zawodzi:**

```js
const foreignMap = vm.runInNewContext("new Map([['a',1]])");
foreignMap instanceof Map; // false  ← !!
Object.prototype.toString.call(foreignMap); // "[object Map]"
foreignMap.constructor === Map; // false
```

Każdy realm (iframe, Web Worker, `vm`, `postMessage`) ma **własne** globalne `Map`, `Array`,
`Object`. To prawdziwa mapa, działa, ale `instanceof` porównuje z `Map.prototype` _twojego_
realmu. Klasyczna przyczyna bugów przy danych z iframe'a — i powód, dla którego
**`Array.isArray()` istnieje jako osobna funkcja**: jest cross-realm-safe.

| metoda                           | zawęża w TS | cross-realm | odporna na dane |
| -------------------------------- | ----------- | ----------- | --------------- |
| `instanceof`                     | tak         | **NIE**     | tak             |
| `Object.prototype.toString.call` | nie         | tak         | tak             |
| duck typing (`"set" in x`)       | częściowo   | tak         | **NIE**         |

Wybór w tym zadaniu: `instanceof`, bo tylko on zawęża typ w TS. Alternatywa
(`detectType(x) === "map"`) jest cross-realm-safe, ale nie zawęża — wymagałaby własnych
type guardów (`function isMap(x): x is Map<any,any>`).

---

### D. Operator `in` — trzy rzeczy, które go wyróżniają

**1. Chodzi po łańcuchu prototypów.**

```js
Object.hasOwn(map, "set"); // false
Object.hasOwn(Map.prototype, "set"); // true
"set" in map; // true
```

`.set` leży na prototypie, nie na instancji. Dlatego duck typing metod w ogóle działa
przez `in`, a nie przez `hasOwn`.

**2. Zawęża typ w TypeScript** — ale na unii z `Record<any,any>` tylko połowicznie:

```
TCollection: "set" in target → Map<any,any> | Record<any,any>
bez Record:  "set" in target → Map<any,any>
```

**3. Odróżnia brak klucza od wartości `undefined`:**

```js
"x" in { x: undefined }; // true
```

**Dlaczego duck typing jest tu ZŁY:**

```js
const evil = { set: 1, add: 2, name: "zwykły obiekt" };
"set" in evil; // true  → zostanie wzięte za Mapę
//       → TypeError: target.set is not a function
```

Klonujesz **cudze dane**. Klucz `"set"` w DTO to nie egzotyka.

> **Reguła:** `instanceof` pyta „czym ta rzecz JEST" (tożsamość, przez prototyp).
> `in` pyta „czy ma taki KLUCZ" (kształt). Kształt danych zewnętrznych jest kontrolowany
> przez wejście, więc nie może służyć do identyfikacji typu. Duck typing bezpieczny na
> danych, których kształt kontrolujesz — niebezpieczny na cudzych.

**Bonus:**

```js
"toString" in {}; // true
"toString" in Object.create(null); // false
```

Ta sama rodzina co `.hasOwnProperty` wywołane na obiekcie bezprototypowym — powód istnienia
`Object.hasOwn`.

---

### E. Jak wykryć „plain object" (i dlaczego lepiej nie próbować)

```
wartość                proto===Object.proto   constructor===Object   toString.call
{}                     true                   true                   [object Object]
Object.create(null)    false                  false                  [object Object]
new Foo()              false                  false                  [object Object]
new Date()             false                  false                  [object Date]
new Map()              false                  false                  [object Map]
[]                     false                  false                  [object Array]
JSON.parse('{"a":1}')  true                   true                   [object Object]
```

- **`Object.getPrototypeOf(x) === Object.prototype`** — najprecyzyjniejsze, ale odrzuca
  `Object.create(null)`. Pełna wersja: `proto === Object.prototype || proto === null`.
- **`x.constructor === Object`** — krótsze, ale `constructor` jest nadpisywalny
  (`{ constructor: Object }` przejdzie test), a na obiekcie bezprototypowym
  `x.constructor.name` wybucha.
- **`toString.call(x) === "[object Object]"`** — **za szerokie**: `new Foo()` daje ten sam
  tag co `{}`. Nie odróżnisz instancji klasy od zwykłego obiektu. To prawdopodobnie tym
  jest `detectType` z kursu.

**Puenta:** definiowanie „zwykłego obiektu" jest trudniejsze niż wyliczenie trzech
konkretnych typów. To argument za whitelistą (sekcja wyżej).

---

### F. TypeScript — błędy, na które wpadłem, i co znaczą

**TS7015** — `Element implicitly has an 'any' type because index expression is not of type 'number'`

> Indeksowanie tablicy stringiem. Runtime OK, TS nie. Źródło: `Object.entries` daje stringi.

**TS7053** — `expression of type 'string' can't be used to index type 'TCollection'`

> Indeksowanie **unii**. Wymaga, żeby indeks działał na _każdym_ członie — tablica chce
> number, `Record` stringa. Nawet po odsianiu `Map` i `Set` zostaje `any[] | Record<any,any>`
> i nadal błąd. Trzeba zejść do jednego typu (`Array.isArray`).
>
> Ten błąd nie jest przeszkodą, tylko **wskazówką projektową**: nie istnieje jedno wyrażenie
> zapisujące do wszystkich czterech kolekcji. Stąd osobna funkcja `set()`.

**TS2322** — `Type 'X' is not assignable to type 'T'. 'T' could be instantiated with an arbitrary type`

> `T` jest **niezwiązane** (unconstrained). Kompilator nigdy nie udowodni, że twój klon jest
> typu `T`. Asercja `as T` jest nieunikniona — chodzi o to, żeby była w **jednym** miejscu.

**TS2352** — `Conversion of type 'X' to type 'Y' may be a mistake because neither type sufficiently overlaps`

> Asercja `as` działa tylko między typami, które się „wystarczająco pokrywają".
> `(a as Date)` gdzie `a: T & object` → błąd. Obejście: `as unknown as Date`.

**TS2693** — `'Record' only refers to a type, but is being used as a value here`

> `Record` istnieje wyłącznie jako alias typu, w runtime go nie ma.

**TS17008 / TS1382** (tylko `.tsx`) — `JSX element 'T' has no corresponding closing tag`

> Parser czyta `<T>` jako tag JSX. Fix: `<T,>` albo `<T extends unknown>`.

---

### G. `Record<any, any>` wyłącza type checking

Zweryfikowane (`tsc --strict`):

```typescript
type TCollection = Map<any, any> | Set<any> | Record<any, any> | Array<any>;

const a: TCollection = 42; // TS2322  (odrzuca)
const b: TCollection = "hello"; // TS2322  (odrzuca)
const c: TCollection = Map; // OK  ← KONSTRUKTOR przechodzi!
const d: TCollection = () => {}; // OK  ← funkcja przechodzi!
```

`Record<any, any>` to w praktyce „dowolny obiekt". Funkcja jest obiektem, konstruktor jest
funkcją → **każdy obiekt przechodzi przez `TCollection`**. Unia odrzuca tylko prymitywy.

Porównanie:

```
Record<any, any>       → return clone: T   przechodzi (!)
Record<string, any>    → TS2322
{ [k: string]: any }   → TS2322
any[]                  → TS2322
```

Klucz `any` degeneruje typ do czegoś na tyle bliskiego `any`, że kompilator przestaje
sprawdzać. Skutek uboczny w tym zadaniu: `case "object"` nie zgłaszał TS2322, choć
`case "array"` zgłaszał — nie z powodu poprawności, tylko z powodu wyłączonego checkingu.

> **`any` w pozycji klucza to nie „dowolny klucz", tylko „przestań sprawdzać".**
> Konsekwencja praktyczna: `TCollection` nie łapie błędów w tym zadaniu.
> Testy runtime są tu jedynym prawdziwym type checkerem — zielony `tsc` nic nie znaczy.

---

### H. Type space vs value space (instantiation expressions)

```typescript
return Map<any, any>; // ← kompiluje się! (dzięki sekcji G)
return new Map(); // ← to, o co chodziło
```

`Map<any, any>` w **pozycji wartości** to _instantiation expression_ (TS 4.7+): bierze
funkcję generyczną i przypina jej argumenty typu. Wynikiem jest **sam konstruktor**:

```
typeof Map           // "function"
Map === Map          // true
Map instanceof Map   // false
Map.get              // undefined
```

Runtime: pętla dostaje klasę `Map`, woła `.set()` i wybucha.
`Record<any,any>` w tej samej pozycji → TS2693 (alias typu nie istnieje w runtime).

---

### I. `const` w `switch` — brak scope'u per case

`case` **nie tworzy własnego scope'u**. Całe ciało `switch { ... }` to jeden blok.

```js
switch (1) {
  case 1:
    const c = {};
    break;
  case 2:
    const c = [];
    break;
}
// SyntaxError: Identifier 'c' has already been declared
```

Błąd **parsowania**, nie runtime'u — plik nie uruchomi się w ogóle, niezależnie od gałęzi.

Subtelniejszy efekt — **TDZ**:

```js
switch (x) {
  case "a":
    return clone; // ← binding z case "b"
  case "b":
    const clone = {};
    return clone;
}
// case 'a' -> ReferenceError: Cannot access 'clone' before initialization
// case 'b' -> {}
```

Nie „zmienna nie istnieje", tylko „istnieje, ale nie wolno jej dotknąć".

**Najbardziej naturalne miejsce, gdzie TDZ gryzie w praktyce** — dobry przykład do pytania
o `var`/`let`/`const`. Fix: klamerki wokół ciała case'a. ESLint: `no-case-declarations`
(w `eslint:recommended`).

---

### J. `{}` na początku instrukcji

```js
({} + [])     // "[object Object]"   ← wyrażenie: obiekt + tablica
{} + []       // 0                   ← instrukcja: pusty blok, potem +[]
{}.entries    // SyntaxError
typeof {}.entries   // OK — typeof wymusza pozycję wyrażenia
```

Ten sam ciąg znaków, dwa wyniki, zależnie wyłącznie od pozycji. Źródło słynnego „WAT".

Kiedy nawiasy są potrzebne:

- `{}.foo` na początku linii → **tak**
- `typeof {}.foo`, `console.log({}.foo)` → nie (jesteś w wyrażeniu)
- `() => ({ a: 1 })` → **tak**, bez nich `{` czyta się jako ciało funkcji
  ← jedyny przypadek spotykany codziennie w Reakcie: `setState(p => ({...p, x: 1}))`

W REPL-ach (Node, Bun) zachowanie bywa inne niż w pliku, bo robią transformację wejścia —
Bun explicite traktuje gołe `{ a: 1 }` jako wyrażenie obiektowe.

---

### K. Asercje: `as any` vs `as unknown as X`

Oba wyłączają sprawdzanie, ale różnie:

- **`as any`** — wynik jest `any`, checking pada **też w dół strumienia**.
  `(a as any).cokolwiek.dowolnie.głęboko` przechodzi bez słowa.
- **`as unknown as X`** — wynik jest `X`, dalej wszystko sprawdzane normalnie.
  Wyłączasz kompilator **tylko w punkcie asercji**.

> `as unknown as X` jest węższym narzędziem i prawie zawsze lepszym wyborem.
> Ale najlepsza asercja to ta, której nie ma.

Konkretny przypadek — klonowanie `Date`, gdzie `a: T & object`:

| wariant                          | kompiluje się                    |
| -------------------------------- | -------------------------------- |
| `new Date(a)`                    | **nie** — TS2769                 |
| `new Date(a as Date)`            | **nie** — TS2352 (brak pokrycia) |
| `new Date(a as any)`             | tak, ale `any` gasi za szeroko   |
| `new Date(a as unknown as Date)` | tak, rozwlekłe                   |
| `new Date(+a)`                   | **tak, bez asercji**             |
| `new Date(Number(a))`            | **tak, bez asercji** ← wybrane   |

Wszystkie dają identyczny wynik w runtime (`Symbol.toPrimitive` → `valueOf()` → timestamp).
`Number(a)` jest bardziej jawne niż unary plus, który łatwo przeoczyć wzrokiem.

Trade-off: `Number(a)` na nie-dacie da `NaN` → `Invalid Date` zamiast wyjątku. Wersja
z `.getTime()` rzuci `TypeError` — kosztem podwójnej asercji.

---

### L. Sygnatura generyczna — gdzie stoi `<T>`

```typescript
export const deepClone = <T>(a: T, cache = new Map()): T => { ... }
//                        ↑    ↑         ↑              ↑
//                        1    2         3              4
```

1. deklaracja parametru typu 2. typ argumentu 3. parametr domyślny 4. typ zwracany

Sens: **cokolwiek wsadzisz, dostaniesz z powrotem to samo.** Bez generyka byłoby
`(a: unknown): unknown` i każdy wywołujący musiałby castować.

**Trzy równoważne formy** (identyczny `.d.ts`):

```typescript
const idA = <T>(x: T): T => x; // parametr typu na funkcji   ← preferowana
const idB: <T>(x: T) => T = (x) => x; // adnotacja typu na zmiennej
function idC<T>(x: T): T {
  return x;
} // deklaracja funkcji
```

Wersja B wymaga powtórzenia sygnatury w dwóch miejscach → dwa miejsca do rozjechania się.

> **Zasada:** `<T>` stoi zawsze bezpośrednio przed listą parametrów. Funkcja strzałkowa,
> deklaracja, metoda klasy, typ — wszędzie tak samo.

**Deklaracja ≠ constraint:**

```typescript
<T>                  // deklaracja: T może być czymkolwiek (unconstrained)
<T extends object>   // deklaracja + CONSTRAINT
```

`<T>` bez constraintu jest przyczyną TS2322 i TS2352 — kompilator nie wie o `T` nic, więc
nic mu nie udowodnisz. Ale constraint `extends object` zabiłby `deepClone(42)`, więc
`<T>` jest tu właściwym wyborem, a asercje to cena.

**`cache = new Map()`** — zwykły parametr domyślny (ES2015). Typ wywnioskowany:

```
declare const deepClone: <T>(a: T, cache?: Map<any, any>) => T;
```

Parametr staje się opcjonalny. Zewnętrzny wywołujący dostaje świeżą mapę, rekurencja
przekazuje istniejącą — jeden mechanizm, zero wrappera.

Trzy uwagi:

- Każde wywołanie zewnętrzne tworzy **nową** mapę. Cache musi być per-operacja; globalny
  trzymałby oryginały przy życiu → memory leak.
- `Map<any, any>` to domyślne wnioskowanie z pustego `new Map()`, nie decyzja.
  Precyzyjniej: `new Map<object, object>()`.
- **API leak:** `cache` jest częścią publicznej sygnatury. Alternatywa: publiczna funkcja
  bez cache'a opakowująca prywatną rekurencyjną. W tym zadaniu prostota wygrywa.

**Pułapka w `.tsx`:**

```typescript
const id = <T>(x: T): T => x; // TS17008: JSX element 'T' has no closing tag
const id = <T>(x: T): T => x; // OK  ← stąd to dziwne `<T,>` w kodzie reactowym
```

---

### M. Środowisko: Bun vs Node

`@course/utils` **nie jest pakietem z npm** — to alias z `tsconfig.json` → `compilerOptions.paths`
(albo workspaces). Node nie czyta `tsconfig.json`, więc szuka w `node_modules` i nie znajduje:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@course/utils'
```

Bun czyta `tsconfig.json` i respektuje `paths`. Stąd `bun test`, nie `node`.

```
bun src/problems/10-deep-clone/deep-clone.ts
bun test src/problems/10-deep-clone/test/deep-clone.test.ts
```

**REPL do szybkich eksperymentów** (nie w pliku z rozwiązaniem — unikniesz walki z importami):

- `bun repl` (od Bun 1.3.10): TypeScript bezpośrednio, top-level `await`, `_` = ostatni wynik,
  historia między sesjami, `bun repl -p "wyrażenie"` do jednorazowych sprawdzeń
- `node` — wystarczy do czystego JS (`Set.entries`, `Object.entries`)

---

### N. Metodologia — co zadziałało w tej sesji

1. **Nie zaczynaj od helperów.** Napisz zduplikowany kod → zobacz różnice → wyciągnij.
   Puste funkcje w nagłówku pliku wyglądają jak punkt wyjścia, a są punktem dojścia.
2. **Fallthrough w `switch` to sygnał.** Case'y bez `break`, jeden pod drugim, mówią
   „te przypadki mają wspólne ciało".
3. **Sprawdzaj empirycznie, nie z głowy.** Połowa pułapek w tej sesji (`Set.entries()`,
   `Object.entries` na tablicy, `Map` jako wartość, konkatenacja w `throw`) ujawniła się
   dopiero po uruchomieniu.
4. **Zielony `tsc` ≠ poprawność** — patrz sekcja G.
5. **Test różnicowy ze `structuredClone`** wykrył dwa znaleziska (klucze Map, tożsamość Date),
   których nie złapało 50 testów z kursu.

## TS: Mapped types i homomorficzność

**Data:** 2026-08-14
**Źródło:** challenge „zaimplementuj własne `Readonly<T>`" (kurs)
**Status:** rozwiązane samodzielnie, drążone w głąb

### Rozwiązanie

```typescript
type MyReadonly<T> = {
  readonly [Property in keyof T]: T[Property];
};
```

Identyczne z definicją w `lib.es5.d.ts`.

### Ścieżka dedukcji (do powtórzenia na rozmowie)

`keyof T` → union nazw kluczy → mapped type pozwala przeiterować po tym unionie → w każdej iteracji można zmienić **wartość** (`T[P]`), **modyfikator** (`readonly`, `?`) i — z klauzulą `as` — **nazwę klucza**.

### Homomorphic mapped type — kluczowy koncept

Zapis `[P in keyof T]`, gdzie `T` jest **parametrem typu**, uruchamia w kompilatorze specjalny tryb: _homomorphic mapped type_. TS nie wykonuje tego zapisu dosłownie — ma zaszyte cztery reguły:

| #   | Zachowanie                                                        |
| --- | ----------------------------------------------------------------- |
| 1   | Modyfikatory `?` i `readonly` z wejścia przechodzą na wyjście     |
| 2   | Tablica → tablica, tupla → tupla (z zachowaną długością)          |
| 3   | Union na wejściu → dystrybucja po wariantach                      |
| 4   | Prymityw na wejściu → ten sam prymityw na wyjściu (bez mapowania) |

**Bez reguły 2** `Readonly<string[]>` dałoby obiekt z `push`, `pop`, `length` jako readonly properties — nie tablicę.
**Bez reguły 4** `Readonly<string>` dałoby obiekt z metodami stringa jako polami.

**Dlaczego reguła 4 w ogóle istnieje:** nie po to, żeby ktoś pisał `Readonly<string>`. Jest warunkiem koniecznym dla reguły 3 — przy `Readonly<string | Config>` kompilator rozbija union i mapuje każdy wariant osobno, więc musi umieć przepuścić prymityw. Inaczej `Readonly`/`Partial`/`Required` psułyby się na każdym unionie z prymitywem.

### Dlaczego wbudowany `Readonly<T>` nie ma constraintu

Naturalny odruch to dopisać `T extends object`. **Nie robi się tego** — constraint zabiłby regułę 3+4, czyli `Readonly<string | Config>` przestałoby się kompilować. Homomorficzność sama obsługuje tablice i prymitywy sensownie.

### Pułapka: klauzula `as` wyłącza regułę 2

```typescript
type Suspect<T> = { readonly [P in keyof T as P]: T[P] }; // as P = no-op!
```

`as P` mapuje klucz **na samego siebie** — nic nie zmienia. A mimo to:

```
error TS2740: Type 'readonly string[]' is missing the following properties
from type 'Suspect<string[]>': pop, push, reverse, shift, and 5 more.
```

Reguła jest **składniowa, nie semantyczna**: kompilator sprawdza samą _obecność_ klauzuli `as` w deklaracji, nie analizuje, czy ona cokolwiek robi.

Homomorficzność to **nie jest przełącznik zero-jedynkowy** — reguły włączają się niezależnie:

| reguła                              | `[P in keyof T]` | `[P in keyof T as P]` |
| ----------------------------------- | ---------------- | --------------------- |
| 1. modyfikatory `?` / `readonly`    | tak              | **tak**               |
| 2. tablica → tablica, tupla → tupla | tak              | **NIE**               |
| 3. dystrybucja po unionie           | tak              | tak                   |
| 4. pass-through prymitywów          | tak              | tak                   |

**Praktyczny wniosek:** nie dopisuj `as`, jeśli go nie potrzebujesz — dostaniesz cichą regresję na tablicach, bez żadnego błędu kompilacji.

### Klauzula `as` — do czego służy naprawdę (TS 4.1+)

Key remapping — zmiana nazwy klucza w trakcie mapowania:

```typescript
type Getters<T> = {
  [P in keyof T as `get${Capitalize<string & P>}`]: () => T[P];
};
// { name: string } → { getName: () => string }
```

Drugie zastosowanie: `as` zwracające `never` **usuwa** klucz z wyniku. Tak implementuje się `Omit`.

### Shallow vs deep readonly

`Readonly<T>` (i własna implementacja) jest **płytkie** — jeden przebieg po kluczach najwyższego poziomu, `T[P]` przechodzi nietknięte:

```typescript
type Nested = MyReadonly<{ user: { name: string } }>;
n.user = {...};       // BŁĄD: read-only property
n.user.name = "b";    // przechodzi!
```

Gdzie to boli realnie:

- `Object.freeze()` w runtime też jest płytkie (typ i zachowanie zgodne)
- **Redux / Zustand** — `readonly` w typie stanu nie chroni zagnieżdżonych pól; stąd własne `DeepReadonly` albo Immer
- **React props** — `Readonly<Props>` nie broni przed `props.config.x = 1`
- Wyjątek: `as const` na literale działa rekurencyjnie (ale na wartościach, nie typach)

### Metodyczna lekcja: hover kłamie

Przy `type X = Suspect<string[]>` IDE pokazuje po prostu `Suspect<string[]>` — TS nie rozwija aliasu. **Weryfikuj zachowaniem, nie tooltipem:**

```typescript
declare const b: X;
const lit: X = ["a"]; // czy literał pasuje?
b[0] = "z"; // czy readonly?
b.push("q"); // czy metoda istnieje?
declare const ro: readonly string[];
const c: X = ro; // ← ta linia rozstrzyga; treść błędu wymienia różnice
```

Celowy błąd typu (`const t: number = x`) to najszybszy sposób, żeby kompilator wypisał pełny kształt typu.

### Pytania rozmowowe, na które to odpowiada

- „Zaimplementuj `Readonly<T>` / `Partial<T>` / `Pick<T, K>` bez używania wbudowanych"
- „Czym różni się homomorphic mapped type od zwykłego?"
- „Dlaczego `Readonly<T>` nie ma constraintu `T extends object`?"
- „Co się stanie z `Partial<string[]>`?"
- „Jak zrobić `DeepReadonly`? Gdzie się psuje?" _(do zrobienia)_

### TODO

- [ ] `DeepReadonly<T>` — rekurencja + conditional type; rozważyć funkcje, `Date`, `Map`/`Set`
- [ ] `+readonly` / `-readonly` i `-?` — kiedy wariant z plusem ma sens; `Required<T>` jako przykład

### Rozwiązanie instruktora — pułapka `T extends {}`

```typescript
type MyReadonly<T extends {}> = { readonly [P in keyof T]: T[P] };
```

**Czy constraint psuje homomorficzność? NIE.** Homomorficzność uruchamia _ciało_
(wzorzec `[P in keyof T]`). Constraint to bramka w liście parametrów — decyduje
co wolno przekazać, nie co się z tym stanie. Wszystkie 4 reguły działają dalej.

**Prawdziwy błąd: `{}` to nie „obiekt".** W TS `{}` znaczy „cokolwiek poza `null`
i `undefined`". `Instr<string>` kompiluje się bez problemu. Constraint, który miał
blokować prymitywy, przepuszcza je wszystkie — a de facto jest strażnikiem null-safety.

Fałszywi przyjaciele: `{}` ≠ `object` ≠ `Object`. Dla „tylko object types" → `T extends object`.

**Realne koszty:**

1. Odrzuca uniony z null: `Instr<string | null>` → `TS2344`. Wbudowany `Readonly` przechodzi.
2. **Zaraża kompozycję:** `type Wrapper<T> = Instr<T>` → `TS2344: Type 'T' does not
satisfy the constraint '{}'`. Każdy typ generyczny używający `Instr` musi powtórzyć
   constraint. Propaguje się przez całą bazę kodu.

**Zasada:** constraint w utility type dodajesz tylko wtedy, gdy ciało bez niego się
nie kompiluje. Tu `keyof T` działa na każdym `T` — constraint to czysty koszt.

## TS-01: Indexed access z `number` (tuple → unia elementów)

**Data:** 2026-08-14
**Źródło:** type-challenges — _Tuple to Object_ (easy)

### Rozwiązanie

```ts
type TupleToObject<T extends readonly PropertyKey[]> = {
  [K in T[number]]: K;
};
```

Zweryfikowane na oficjalnych testach type-challenges (TS 7.0.2, `--strict`) — wszystkie 4 przypadki `Expect<Equal<...>>` przechodzą, `@ts-expect-error` na `[[1,2],{}]` też.

### Sedno wzorca

`T[number]` = unia wszystkich elementów krotki.

Mechanizm: indexed access **dystrybuuje się po unii kluczy**. `T[0 | 1]` daje unię elementów 0 i 1. `number` to unia wszystkich indeksów liczbowych, więc `T[number]` daje wszystkie elementy naraz. To nie jest osobna magia — to ten sam mechanizm co `T[0]`.

### Gdzie się zaciąłem

1. **Sięgnąłem po `keyof`** zamiast indexed access. `keyof` daje **klucze** (`0 | 1 | ... | "length" | "map" | ...`), a ja chciałem **wartości**. W tablicy `"tesla"` to wartość pod kluczem `0`, nie klucz. → Pytanie kontrolne na przyszłość: _czy potrzebuję kluczy czy wartości?_ Jeśli wartości — nigdy `keyof`.
2. **Nie znałem `PropertyKey`** = `string | number | symbol`. Wbudowany alias z lib.es5.d.ts.

### Constrainty na tablicę — trzy niezależne osie

| Oś            | Wariant                               | Znaczenie                                 |
| ------------- | ------------------------------------- | ----------------------------------------- |
| Długość       | `any[]` / `[any]` / `[any, ...any[]]` | dowolna / dokładnie 1 / co najmniej 1     |
| Mutowalność   | `any[]` / `readonly any[]`            | wymaga `push` itd. / nie wymaga           |
| Typ elementów | `any[]` / `PropertyKey[]`             | cokolwiek / tylko to, co może być kluczem |

Pułapki:

- `[any]` to **krotka jednoelementowa**, nie „tablica czegokolwiek". Nawiasy przed vs po typie to różne konstrukcje.
- `[...any]`, `[...any[]]` i `any[]` to **dokładnie ten sam typ** (sprawdzone `Equal` → `true`). Spread pojedynczej tablicy w krotce nic nie wnosi.
- `readonly T[]` jest **nadtypem** `T[]`, nie podtypem. Ma mniej metod → mniej gwarantuje → pasuje do niego więcej typów. Mutowalna przechodzi jako readonly, odwrotnie nie.
- **Reguła praktyczna:** generyk, który tylko _czyta_ z tablicy, powinien mieć constraint `readonly` — inaczej odcina wszystkich użytkowników `as const`.

### Narzędzia debugowania typów

```ts
// wymusza rozwinięcie leniwego aliasu przy hoverze
type Expand<T> = T extends T ? T : never;

// test IDENTYCZNOŚCI typów (nie tylko wzajemnej przypisywalności)
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// zmusza kompilator do wypisania nazw kluczy w komunikacie błędu
const z: Record<keyof typeof tuple, number> = {};
```

### Test pamięci (sprawdzić 2026-08-15)

1. Jak z `readonly ["a","b","c"]` dostać `"a" | "b" | "c"`? Dlaczego to działa?
2. Czym się różni `[any]` od `any[]`?
3. Dlaczego `readonly number[]` nie przechodzi constraintu `number[]`, ale odwrotnie tak?
4. Co to `PropertyKey` i po co go tu użyłem?
5. Napisz `TupleToObject` od zera bez zaglądania.

### Powiązane zadania (ten sam klocek wraca)

`TupleToUnion`, `Last`, `Includes`, `Zip`, `Length of Tuple`

# Stringify (challenge podsumowujący deepEquals + deepClone)

Data: 15.08.2026 · kurs: struktury danych / rekurencja

## Problem

Zamienić dowolną wartość na string opisujący jej **strukturę** — rekurencyjnie w głąb, z wykryciem cyklicznych referencji.

| typ                       | input                 | output                         |
| ------------------------- | --------------------- | ------------------------------ |
| null                      | `null`                | `null`                         |
| number / bigint / boolean | `42`, `42n`, `true`   | `42`, `42`, `true`             |
| regexp                    | `/abc/gi`             | `/abc/gi`                      |
| string                    | `"hello"`             | `"hello"` (z cudzysłowami)     |
| undefined                 | `undefined`           | `"undefined"` (z cudzysłowami) |
| symbol                    | `Symbol('x')`         | `"Symbol(x)"`                  |
| date                      | `new Date()`          | `toLocaleString()`             |
| object / map              | `{a:1}`, `Map{a=>1}`  | `{ a: 1 }`                     |
| array / set               | `[1,"a"]`, `Set{1,2}` | `[1,"a"]`                      |
| cykl                      | ref do przodka        | `[Circular]`                   |
| inne                      | `function(){}`        | `"Unsupported Type"`           |

## Implementacja końcowa

```typescript
type TCollection = Map<any, any> | Set<any> | Record<any, any> | Array<any>;

function entries(target: TCollection): Iterable<[key: any, value: any]> {
  if (target instanceof Map || target instanceof Set || Array.isArray(target)) {
    return target.entries();
  }
  return Object.entries(target);
}

export const stringify = (a: any, cache = new Set()): string => {
  const type = detectType(a);

  switch (type) {
    case "symbol":
      return a.toString();
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "regexp":
      return `${a}`;
    case "undefined":
    case "string":
      return `"${a}"`;
    case "date":
      return a.toLocaleString();

    case "map":
    case "object": {
      if (cache.has(a)) return "[Circular]";
      cache.add(a);
      let keyValueStrings = [];
      for (const [key, value] of entries(a)) {
        keyValueStrings.push(`${key}: ${stringify(value, cache)}`);
      }
      cache.delete(a);
      return `{ ${keyValueStrings.join(", ")} }`;
    }

    case "array":
    case "set": {
      if (cache.has(a)) return "[Circular]";
      cache.add(a);
      let values = [];
      for (const [_, value] of entries(a)) {
        values.push(stringify(value, cache));
      }
      cache.delete(a);
      return `[${values}]`;
    }

    default:
      return '"Unsupported Type"';
  }
};
```

## Decyzje projektowe

**1. `entries()` jako wspólny protokół przejścia.**
Cztery różne struktury danych, jedna pętla. `Map.entries()` → `[key, value]`, `Array.entries()` → `[index, value]`, `Set.entries()` → `[value, value]` (Set duplikuje wartość właśnie po to, żeby pasować do interfejsu), a dla zwykłego obiektu `Object.entries()`. Bez tego byłyby cztery osobne pętle.

**2. `toString()` odrzucone.**
Jest płytkie i zwraca śmieci: `map.toString()` → `"[object Map]"`, `{}.toString()` → `"[object Object]"`. Nie da się go użyć jako bazy — string trzeba budować od zera.

**3. `push` + `join` zamiast `+=`.**
Nie chodzi o wydajność (V8 optymalizuje konkatenację przez rope strings). Chodzi o **separator**: przy `+=` musisz przy każdej iteracji sprawdzać „czy to ostatni element", żeby nie zostawić wiszącego przecinka. `join` załatwia to za darmo.

**4. Cache jako `Set`, nie `Map`.**
W `deepClone` potrzebna była Mapa, bo mapowałeś `oryginał → klon`. W `deepEquals` — `a → b`. Tutaj pytasz wyłącznie o **przynależność**, nie ma czego pamiętać po stronie wartości. Set to Map, w której value zawsze byłoby `true`.

**5. Scalone `case`'y przez fallthrough.**
`map` + `object` produkują identyczny output (`{ k: v }`), `array` + `set` też (`[v]`). Fallthrough zamiast duplikacji ciała.

**6. Świadomie zostawiona duplikacja guardu.**
`if (cache.has(a)) → add → pętla → delete` powtarza się w dwóch gałęziach. Alternatywy: tabela lookup `SHAPES` z polami `keyed/sep/wrap`, albo jeden `return` na końcu, albo wspólny guard przed `switch` ograniczony do typów kontenerowych. Przy 4 wariantach wszystkie są obronne — zostawiona duplikacja, bo traversal jest wtedy widoczny lokalnie w `case`.

## Znane ograniczenia (poza spec)

- **Klucze Map nie przechodzą przez `stringify`.** `${key}` na obiekcie → `[object Object]`, na Mapie → `[object Map]`, na **symbolu → rzuca `TypeError`**. Spec nie pokrywa nie-stringowych kluczy.
- **`symbol` zwraca `Symbol(x)` bez cudzysłowów**, JSDoc wymaga `"Symbol(x)"`. Suite testów tego nie sprawdza. Do rozstrzygnięcia: kod czy komentarz jest prawdą.
- **Pusty obiekt / pusta Mapa → `{  }`** (dwie spacje). Pusta tablica i pusty Set → `[]` poprawnie.
- **`[${values}]`** polega na niejawnym `Array.prototype.toString` (= `join(",")`). Działa, ale gałąź obiektowa woła `join` jawnie — niespójność.
- **`toLocaleString()` na Date** zależy od locale i TZ runtime'u → test niedeterministyczny w CI.
- **`cache` jest w publicznej sygnaturze** — można wstrzyknąć własny Set z zewnątrz. Czyściej: wewnętrzny `walk(value, path)` + cienki wrapper `stringify(value)`.

## Testy regresyjne (wszystkie przechodzą)

```
[1,1]                        → [1,1]
{a:"x",b:"x"}                → { a: "x", b: "x" }
x.self = x                   → { a: 1, self: [Circular] }
{q:a, w:a}  (shared)         → { q: { tescik: 1 }, w: { tescik: 1 } }
x.a=x; x.b=x                 → { a: [Circular], b: [Circular] }
p.q=q; q.p=p; p.q2=q         → { q: { p: [Circular] }, q2: { p: [Circular] } }
Set zawierający siebie       → [[Circular]]
[inner, inner]               → [[1],[1]]
arr.push(arr)                → [1,[Circular]]
```

---

# Tematy poboczne

## Path set vs visited set

Główny wzorzec z tego zadania. To są DWA różne zbiory:

|            | `visited` (historia)               | `path` (ścieżka)                          |
| ---------- | ---------------------------------- | ----------------------------------------- |
| Znaczenie  | „widziałem ten węzeł kiedykolwiek" | „ten węzeł jest moim przodkiem TERAZ"     |
| Cykl życia | tylko `add`, nigdy `delete`        | `add` przy wejściu, `delete` przy wyjściu |
| Do czego   | deduplikacja, memoizacja           | wykrywanie **cyklu**                      |

Reguła: `add` i `delete` klamrują całe przejście węzła — w tej samej ramce wywołania, wokół całej pętli po dzieciach. Nazywaj to `path`, nie `cache` — `cache` sugeruje historię, czyli błędną semantykę.

Pojawia się też w: detekcji cyklu w grafie skierowanym, topological sort, LeetCode 207 / 802 / 1192, `deepFreeze`.

**Cztery kształty inputu demaskujące złą implementację** (coraz trudniejsze):

1. `x.self = x` — czysty cykl. Przechodzi nawet przy `visited`.
2. `const a = {t:1}; b = {q:a, w:a}` — **shared, nie cykl**. `visited` daje fałszywy `[Circular]` na `w`.
3. `x.a = x; x.b = x` — shared **i** cykl naraz. Łapie złe miejsce `delete`.
4. `p.q = q; q.p = p; p.q2 = q` — cykl wzajemny + shared.

**Trzy błędy, które popełniłem po kolei:**

- `has`/`add` **przed** rozpoznaniem typu → primitywy trafiają do zbioru → `[1, 1]` daje `[1,[Circular]]`. Do path setu wchodzą wyłącznie referencje; typ `Set<object>` wyklucza to na poziomie kompilacji.
- `delete` **wewnątrz pętli** po dzieciach → węzeł znika ze ścieżki po pierwszym dziecku → nieskończona rekurencja na kształcie 1.
- `delete` na **dziecku** zamiast na sobie → usuwasz wpis, którego nie dodałeś (gałąź zwracająca `[Circular]` nic nie dodała, wpis należał do przodka) → stack overflow na kształcie 3. Zasada: **kto dodał, ten usuwa**.

Dodatkowo: `if (set.has(x)) set.delete(x)` — `Set.prototype.delete` na nieistniejącym elemencie to no-op, guard jest szumem.

## Gotchas z JS/TS

- `` `${Symbol("x")}` `` rzuca `TypeError: Cannot convert a Symbol value to a string`. `String(Symbol("x"))` działa — spec ma dla `String()` jawny wyjątek. Jedyny typ w JS blokujący niejawną konwersję na string.
- `` `[${tablica}]` `` niejawnie woła `Array.prototype.toString` → `join(",")`.
- `!a || typeof a !== "object"` jako test „to primityw" jest zepsute: `""` i `0` łapią się przez `!a`, `typeof function` to `"function"`, a `Date`/`RegExp` to obiekty. Działa w `deepEquals` (wszystkie primitywy przez `===`), NIE działa gdy output różni się per typ.
- `Set` porównuje elementy przez SameValueZero → `1` i `1` to ten sam element, `{}` i `{}` nie.
- Type guard (`x is T`) zamiast `as` przy zawężaniu do klucza tabeli lookup.
- Para acquire/release (`add`/`delete`) w `try/finally` — niezmiennik przeżywa wyjątek w środku pętli.

## Która duplikacja jest tania

Duplikacja **formatowania** (literały, separatory) — tania. Zepsujesz, test krzyknie, każda gałąź czyta się lokalnie.

Duplikacja **niezmiennika** (para acquire/release) — droga. Da się naprawić w jednej gałęzi i zapomnieć o drugiej, a testy przechodzą aż do rzadkiego kształtu inputu.

Na rozmowie warto powiedzieć wprost, kiedy przestać abstrahować: tabela lookup przy 4 wariantach jest na styk opłacalna, przy 2 to przeinżynierowanie.

## Do zrobienia

- [ ] Test pamięci 16.08: detekcja cyklu w `deepFreeze` od zera, sprawdzona na czterech kształtach
- [ ] Rozstrzygnąć rozbieżność symbol: kod vs JSDoc
- [ ] Dopisać do JSDoc ograniczenie o kluczach Map

## 6. Drain, pętle iteracyjne i mikrotaski (28.08.2026)

Kontekst: trace `MyPromise` na snippecie z łańcuchem dwóch `.then`. Wszystko poniżej to decyzje projektowe do obrony na rozmowie, nie mechanika.

### 6.1 Drain w `flushHandlers` — dlaczego tak, a nie prościej

```ts
const pending = this.handlers;
this.handlers = [];
pending.forEach(/* ... */);
```

**Semantyka:** `this.handlers = []` przestawia **strzałkę** (pole wskazuje na nową tablicę). `pending` nadal trzyma referencję do starej. Żeby zmienić **obiekt**, trzeba go dotknąć: `push`, `splice`, `length = 0`, `obj.x = ...`.

> Przypisanie do zmiennej/pola przestawia strzałkę. Mutacja dotyka obiektu.

Ta sama pułapka gryzie w React (`state.items.push(x)` nie wywoła re-rendera — referencja się nie zmieniła) i w `useEffect` deps. Trzy różne opakowania, jeden mechanizm.

**Dwa powody czyszczenia:**

| Powód                                                                            | Czy zachodzi przy `flushHandlers`, który _kolejkuje_                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| (b) nie wykonać handlera dwa razy — `then` i `settle` oba wołają `flushHandlers` | **tak**, to realny powód                                                            |
| (a) nie zjeść handlera dorzuconego w trakcie pętli                               | **nie** — pętla tylko kolejkuje, nie wykonuje kodu użytkownika, nie ma kto dorzucić |

Powód (a) jest prawdziwy dla **innego kształtu** `flushHandlers`: takiego, który woła `onFulfilled` synchronicznie w pętli. Wtedy handler może w środku `forEach` zawołać `.then` na tym samym promise, `forEach` go nie odwiedzi (zamrożony `len`), a czyszczenie po pętli by go skasowało.

**Odpowiedź na „czemu drain, a nie po prostu `this.handlers = []` po pętli":**

> Poprawność draina nie zależy od tego, czy pętla wykonuje kod użytkownika, czy tylko go kolejkuje.

Zmiana `flushHandlers` z kolejkowania na wywołanie synchroniczne — albo dołożenie w środku pętli czegokolwiek, co oddaje kontrolę — nie psuje kodu z drainem. Kod z czyszczeniem po pętli psuje się po cichu.

### 6.2 Dwa rodzaje pętli iteracyjnych

`Array.prototype.forEach`: `len` odczytywany **raz**, przed pierwszym callbackiem. Potem `while k < len` z zamrożoną liczbą.

- element **dodany** w trakcie → poza `len` → **nie odwiedzony**
- element **usunięty** przed odwiedzeniem → pominięty (sprawdzenie `HasProperty`, nie dostaniesz `undefined`)
- element **nadpisany** w trakcie → callback dostanie nową wartość (odczyt `arr[k]` dzieje się w momencie odwiedzenia)

Zamrożona jest **długość**, nie zawartość.

| Konstrukcja                                       | Zobaczy dorzucony element                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `forEach` / `map` / `filter` / `some` / `every`   | **nie** — `len` czytany raz                                                        |
| `for (let i = 0; i < arr.length; i++)`            | **tak** — `length` re-ewaluowane co obrót → przy ciągłym `push` pętla nieskończona |
| `for...of`                                        | **tak** — iterator sprawdza `index >= length` co krok → j.w.                       |
| `for (let i = 0, len = arr.length; i < len; i++)` | **nie** — ręcznie to samo, co `forEach`                                            |

**Dlaczego w `flushHandlers` chcemy typu „zamrożonego":** drain + `forEach` gwarantuje **ograniczoną porcję pracy** — bierzesz N handlerów, obsługujesz N, cokolwiek dojdzie czeka na następny flush. Pętla z re-ewaluowaną długością wciąga nowe do bieżącego przebiegu, więc handler dokładający handler może ją zapętlić bez końca.

**Łuk domykający — ta sama różnica na innym poziomie robi coś przeciwnego.** Pętla drenująca mikrotaski w event loopie:

```js
while (microtaskQueue.length > 0) {
  // ← length re-ewaluowane co obrót
  microtaskQueue.shift()();
}
```

To **celowo** drugi typ. Dlatego mikrotask dodany w trakcie drenażu wykonuje się w **tym samym checkpoincie**, a nie po następnym macrotasku — i dlatego mikrotask kolejkujący w nieskończoność kolejny mikrotask **zawiesza stronę na amen**. Z macrotaskami tak nie jest.

### 6.7 Dlaczego `queueMicrotask` jest niezbędne — pełne uzasadnienie

**Wymóg (Promises/A+ 2.2.4):** `onFulfilled`/`onRejected` nie mogą zostać wywołane, dopóki stos wykonania zawiera cokolwiek poza kodem platformowym. Niezbędne jest więc **odroczenie**, nie konkretna funkcja — `queueMicrotask` to najprostszy sposób, żeby je spełnić.

**Zasada nadrzędna, z której wynika cała reszta:** `.then` ma mieć **jedno** zachowanie, nie dwa. Rejestruje i wraca — także wtedy, gdy wartość jest już od dawna dostępna.

**Cztery szkody z wywołania synchronicznego:**

**(1) Zalgo — kolejność zależna od stanu, nie od kodu.**

```js
function get(cache) {
  return cache
    ? cache.then((v) => v * 2) // settled
    : fetchFromNetwork().then((v) => v * 2); // pending
}
console.log("1");
get(cache).then((v) => console.log("3:", v));
console.log("2");
```

Z odroczeniem zawsze `1 2 3`. Bez — `1 3 2` przy trafieniu w cache, `1 2 3` przy pudle. **Kolejność wykonania programu zaczyna zależeć od tego, czy dane były w cache'u.** Termin: „releasing Zalgo" (Isaac Schlueter, 2013).

**(2) `resolve()` przestaje być zwykłym wywołaniem — reentrancy.**

```js
close() {
  this.socket = null         // (1) zaczynam sprzątać
  this.pendingResolve(true)  // (2) — przy sync flushu: wywołanie CAŁEGO cudzego łańcucha
  this.state = 'closed'      // (3) kończę sprzątanie
}
```

Handlery zobaczą obiekt w stanie połowicznie posprzątanym (`socket` już `null`, `state` wciąż `'open'`) i mogą wejść w `close()` ponownie. Reguła: **nie oddawaj sterowania nieznanemu kodowi w środku własnej operacji.**

**(3) TDZ — twardy `ReferenceError`, nie kwestia stylu.**

```js
const p1 = p0.then((v) => {
  console.log(p1);
  return v + 1;
});
```

Wiązanie `p1` inicjalizuje się dopiero gdy `.then` **zwróci**. Sync handler odpala wcześniej → `Cannot access 'p1' before initialization`. Znów tylko na settled promisie — błąd zależny od wyścigu.

**(4) Stos rośnie zamiast się zwijać.**

```js
function loop(p, n) {
  return n === 0
    ? p
    : loop(
        p.then((v) => v + 1),
        n - 1,
      );
}
loop(MyPromise.resolve(0), 100000);
```

Sync → 100 000 zagnieżdżonych ramek → `Maximum call stack size exceeded`. Odroczenie daje każdemu handlerowi **czysty, płytki stos**; głębokość jest stała niezależnie od długości łańcucha. To powód, dla którego `await` w długiej pętli w ogóle działa.

**Dlaczego mikrotask, a nie `setTimeout(fn, 0)`:**

|            | mikrotask                                          | `setTimeout(fn, 0)`                    |
| ---------- | -------------------------------------------------- | -------------------------------------- |
| Kiedy      | po bieżącym zadaniu, **przed** oddaniem sterowania | jako kolejne zadanie                   |
| Drenaż     | kolejka do końca, łącznie z dopisanymi w trakcie   | jedno zadanie na obrót                 |
| Render     | łańcuch domyka się **przed** malowaniem klatki     | render i I/O wchodzą między ogniwa     |
| Opóźnienie | brak                                               | clamp ~4 ms po 5 zagnieżdżeniach       |
| Interop    | ta sama kolejka co natywne promise'y i `await`     | inna kolejka → kolejność się rozjeżdża |

Ostatni wiersz rozstrzyga: przy `setTimeout` snippet

```js
Promise.resolve().then(() => console.log("natywny"));
MyPromise.resolve().then(() => console.log("mój"));
```

zawsze dałby `natywny mój` — implementacja przestałaby być **wymienna** z natywną, czyli straciłaby sens.

**Formuła na rozmowę:** „`queueMicrotask` gwarantuje, że `.then` ma jedno zachowanie niezależnie od stanu promise'a: rejestruje i wraca. Bez tego kolejność wykonania zależałaby od tego, czy wartość była gotowa, `resolve()` wywoływałoby cudzy kod w środku moich niezmienników, a długie łańcuchy przepełniałyby stos. Mikrotask, a nie `setTimeout`, bo tylko ta kolejka daje interop z natywnymi promise'ami i `await`."

### 6.4 Liczydło obrotów

**Łańcuch N ogniw `.then` = N obrotów kolejki mikrotasków**, wszystkie w jednym checkpoincie.

```js
const p0 = new MyPromise((resolve) => resolve(1));
const p1 = p0.then((v) => v + 1);
const p2 = p1.then((v) => console.log(v));
console.log("--- koniec kodu synchronicznego ---");
```

```
--- koniec kodu synchronicznego ---
2
```

- **M1** (wrapper `p0 → p1`): `(v) => v + 1` z `v = 1` → `2` → `resolveNext(2)` → `settle` p1 → `flushHandlers` p1 → **kolejkuje M2**. Konsola: nic.
- **M2** (wrapper `p1 → p2`): `console.log(2)` → **drukuje `2`** → zwraca `undefined` → `resolve` p2 → `flushHandlers` p2 → handlers pusta.

To samo liczydło obsługuje pytanie o `return Promise.resolve()` z handlera (§ pytanie otwarte — obsługa thenable): ogniw jest więcej, niż widać w kodzie.

### 6.5 Gotchas / pytania rekrutacyjne z tej sekcji

1. _„Co się stanie, jak w pętli po tablicy będziesz do niej dopisywał?"_ → **zależy, którą pętlą** (tabela 6.2)
2. _„Czemu `.then` nie odpala callbacka od razu, skoro promise jest już fulfilled?"_ → Zalgo (6.3)
3. _„Czemu mikrotask, a nie `setTimeout`?"_ → checkpoint przed renderem/timerami (6.3)
4. _„Czemu kopiujesz tablicę przed pętlą zamiast wyczyścić po?"_ → odporność na zmianę kształtu pętli (6.1)
5. _„Ile mikrotasków zużyje łańcuch trzech `.then`?"_ → trzy (6.4)

### 6.6 Własna pułapka do przetestowania

Przy trace'owaniu **przeskoczyłem jeden obrót** w ostatnim ogniwie: na `p1` przyjąłem, że `flushHandlers` wykona handler synchronicznie, choć dwa kroki wcześniej poprawnie zapisałem, że na `p0` go **kolejkuje**.

Reguła do zautomatyzowania:

> `flushHandlers` **zawsze kolejkuje, nigdy nie wykonuje**. Nie ma w nim ścieżki synchronicznej — na każdym ogniwie łańcucha zachowuje się identycznie.

Wiedza jest, odruchu nie ma. To typ błędu, który wypada pod presją rozmowy → materiał na test pamięci, nie na naukę od zera.

# Promise na rozmowę — wersja do odtworzenia z pamięci

Data: 2026-08-29. To jest **wersja robocza na zadanie rekrutacyjne** „napisz własną implementację Promise". 86 linii kodu. Świadomie niepełna — patrz §5.

Materiał do pogłębiania: [[promise-implementacje]] (porównanie dwóch wcześniejszych podejść + analiza bugów).

## Spis treści

1. Kod
2. Jedyna zmiana w logice — 4 linie w `resolve`
3. Kolejność pisania na tablicy
4. Koszt zgodności — zmierzone
5. Co świadomie zostaje zepsute (i co powiedzieć, gdy padnie pytanie)
6. Dokładka: `Promise.all` i `race`
7. Talking points

---

## 1. Kod

```ts
type PromiseStatus = "pending" | "fulfilled" | "rejected";

const PENDING: PromiseStatus = "pending";
const FULFILLED: PromiseStatus = "fulfilled";
const REJECTED: PromiseStatus = "rejected";

type Executor<T> = (
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (reason: any) => void,
) => void;

// callback MOŻE zwrócić promise — bez tego chaining asynchroniczny się nie typuje
type OnFulfilled<T, R> = (value: T) => R | PromiseLike<R>;
type OnRejected<R> = (reason: any) => R | PromiseLike<R>;

/**
 * Rekord odroczonej reakcji — odpowiednik [[PromiseReaction]] ze specyfikacji.
 * Most między dwoma promise'ami: czyta wartość z bieżącego, wynik wpycha do następnego.
 */
type Handler = {
  onFulfilled: OnFulfilled<any, any> | undefined;
  onRejected: OnRejected<any> | undefined;
  resolveNext: (value: any) => void;
  rejectNext: (reason: any) => void;
};

export class MyPromise<T> {
  private handlers: Handler[] = [];
  private status: PromiseStatus = PENDING;
  /** Jedno pole na wartość i na powód — znaczenie rozstrzyga `status`. */
  private value: any = undefined;
  /** Strażnik jednorazowości — jeden punkt kontrolny dla każdej drogi do settlementu. */
  private isResolved: boolean = false;

  constructor(executor: Executor<T>) {
    try {
      // Executor wykonuje się SYNCHRONICZNIE — dlatego new MyPromise(r => r(42))
      // zwraca obiekt już w stanie fulfilled.
      executor(this.resolve, this.reject);
    } catch (err) {
      // throw użytkownika zamieniamy na odrzucenie. Nigdy odwrotnie.
      this.reject(err);
    }
  }

  private settle(status: PromiseStatus, value: any): void {
    if (this.isResolved) return;
    this.status = status;
    this.value = value;
    this.isResolved = true;
    this.flushHandlers();
  }

  // Strzałki, nie metody: obie wędrują do executora jako gołe referencje
  // i są wołane bez kropki, więc `this` musi być przyklejone leksykalnie.
  private resolve = (value: any): void => {
    // ↓ JEDYNA zmiana w logice względem naiwnej wersji
    if (value && typeof value.then === "function") {
      value.then(this.resolve, this.reject);
      return;
    }
    this.settle(FULFILLED, value);
  };

  private reject = (reason: any): void => {
    // reject NIE rozpakowuje — tak samo działa natywny Promise.
    this.settle(REJECTED, reason);
  };

  private flushHandlers(): void {
    if (this.status === PENDING) return;

    // Opróżnienie tablicy jest KONIECZNE, ale nie z powodu re-entrancy — w pętli
    // tylko kolejkujemy mikrotaski, więc nikt nowego rekordu nie dopisze.
    // Powód: flushHandlers() woła się przy KAŻDYM then(), nie tylko przy
    // rozstrzygnięciu. Bez opróżnienia drugie then() na rozstrzygniętym promisie
    // zakolejkowałoby ponownie rekord pierwszego → callback odpaliłby się dwa razy.
    const pending = this.handlers;
    this.handlers = [];

    pending.forEach((handler) => {
      // Jedyne miejsce, w którym cokolwiek trafia do kolejki mikrotasków.
      // Do kolejki idzie wrapper, nie callback użytkownika — queueMicrotask woła
      // go bez argumentów, więc wartość musi przyjechać domknięciem.
      queueMicrotask(() => {
        const callback =
          this.status === FULFILLED ? handler.onFulfilled : handler.onRejected;

        if (!callback) {
          // Brak callbacku → przepuść wartość dalej, ZACHOWUJĄC tor.
          // Dzięki temu jeden .catch na końcu łapie błąd z dowolnego ogniwa.
          if (this.status === FULFILLED) handler.resolveNext(this.value);
          else handler.rejectNext(this.value);
          return;
        }

        try {
          // resolveNext to resolve NASTĘPNEGO promise'a — czyli ten z adopcją.
          // Stąd bierze się rozpakowywanie zwróconych promise'ów.
          handler.resolveNext(callback(this.value));
        } catch (err) {
          // Bez tego throw poleciałby w pustkę: jesteśmy w mikrotasku,
          // nad nami nie ma już żadnego try/catch użytkownika.
          handler.rejectNext(err);
        }
      });
    });
  }

  then<R = T>(
    onFulfilled?: OnFulfilled<T, R>,
    onRejected?: OnRejected<R>,
  ): MyPromise<R> {
    // Executor nowego promise'a nie rozstrzyga go — chowa jego parę sterującą
    // do rekordu. To jedyne miejsce, w którym da się dobrać do resolve/reject
    // cudzej instancji.
    const next = new MyPromise<R>((resolveNext, rejectNext) => {
      this.handlers.push({ onFulfilled, onRejected, resolveNext, rejectNext });
    });

    // `this` mógł być rozstrzygnięty dawno temu — wtedy rekord idzie do kolejki od razu.
    this.flushHandlers();
    return next;
  }

  // T zostaje w unii: .catch NIE konsumuje toru sukcesu.
  catch<R = never>(onRejected?: OnRejected<R>): MyPromise<T | R> {
    return this.then<T | R>(undefined, onRejected);
  }

  static resolve<T>(value: T): MyPromise<T> {
    return new MyPromise<T>((res) => res(value));
  }

  static reject<R = never>(reason: any): MyPromise<R> {
    return new MyPromise<R>((_, rej) => rej(reason));
  }
}
```

Zweryfikowane: kompiluje się pod `tsc --strict`, wszystkie standardowe przypadki przechodzą, kolejność mikrotasków w łańcuchu identyczna jak w natywnym `Promise`.

---

## 2. Jedyna zmiana w logice — 4 linie w `resolve`

```ts
if (value && typeof value.then === "function") {
  value.then(this.resolve, this.reject);
  return;
}
```

Trzy rzeczy do powiedzenia na głos przy pisaniu tych czterech linii:

- **`typeof value.then === "function"`, nie `instanceof MyPromise`** — ten sam koszt, a rozpakowuje też natywne `Promise` i cudze biblioteki. Sprawdzasz kształt, nie klasę.
- **Oba tory.** Gdyby przekazać tylko `this.resolve`, odrzucenie w środku zawiesiłoby promise na zawsze i połknęło błąd bez śladu. To był krytyczny bug w jednej z wcześniejszych wersji.
- **Rekurencja gratis.** `this.resolve` woła samo siebie, więc promise w promisie w promisie rozpakowuje się do dna bez ani jednej dodatkowej linijki.

**Bonus, który dostajesz za darmo:** `then` zwracający promise działa bez żadnego kodu w `flushHandlers`, bo `handler.resolveNext` to jest właśnie ten `resolve` następnego promise'a. Jedna poprawka w jednym miejscu naprawia oba przypadki (`res(promise)` w executorze i `return promise` z callbacku) — to jest najlepszy argument do pokazania, jeśli ktoś zapyta „a co z `.then(() => fetch(...))`".

---

## 3. Kolejność pisania na tablicy

Odporna na stres — po każdym kroku da się coś pokazać:

1. Typy + pola (`status`, `value`, `handlers`, `isResolved`)
2. `constructor` — executor synchronicznie, w `try`
3. `settle` / `resolve` / `reject` — **`resolve` najpierw BEZ adopcji**, prosto
4. `then` + `flushHandlers` — tu masz działający chaining, można zademonstrować
5. `catch` + statyki
6. **Wracasz do `resolve` i dokładasz 4 linie adopcji**, mówiąc: _„a teraz obsłużę przypadek, w którym callback zwraca promise"_

Krok 6 jako osobny, świadomy ruch robi lepsze wrażenie niż napisanie tego od razu — pokazujesz, że wiesz, gdzie w architekturze jest miejsce na tę operację i dlaczego akurat tam.

---

## 4. Koszt zgodności — zmierzone na oficjalnym suicie Promises/A+

| Wersja                                       | A+                                              | Objętość     |
| -------------------------------------------- | ----------------------------------------------- | ------------ |
| Naiwna (bez adopcji)                         | nie do zmierzenia — brak adopcji wywraca połowę | 86 linii     |
| **Ta**                                       | **596 / 872 (68%)**                             | **86 linii** |
| + strażnik `called` i `try` (6 linii)        | 698 / 872 (80%)                                 | 92 linie     |
| Pełna paranoja (`.call`, getter, osobny job) | 872 / 872                                       | 126 linii    |

**To argument ZA tą wersją, nie przeciw.** Dołożenie 6 linii kupuje raptem 12 punktów procentowych, bo reszta failujących testów to obiekty, których jedynym celem jest złamanie implementacji: thenable wołający oba callbacki, thenable rzucający po wywołaniu resolve, getter `.then` wybuchający przy odczycie, thenable wywoływalny tylko raz. Żaden z tych przypadków nie występuje w normalnym kodzie — natywne promise'y, `axios`, `fetch` przechodzą przez te 4 linie bez problemu (sprawdzone osobno).

Krzywa jest bardzo niekorzystna: pierwsze 4 linie kupują większość praktycznej wartości, ostatnie 40 kupują odporność na złośliwców. Na rozmowie chcesz być po lewej stronie tej krzywej.

---

## 5. Co świadomie zostaje zepsute

Znać na wypadek pytania „a co się stanie, gdyby…":

1. **`p.then(() => p)` zawiesi się** zamiast rzucić `TypeError`. Spec (2.3.1) wymaga wykrycia cyklu.
   _„Świadomie pominąłem — to jedna linijka na początku `resolve`:"_

   ```ts
   if (value === this) return this.reject(new TypeError("Chaining cycle"));
   ```

   Naprawdę darmowa, można dopisać.

2. **Złośliwy thenable może rozstrzygnąć promise dwa razy**, jeśli pierwszy raz zrobi to innym _pending_ thenable.
   _„Strażnik `isResolved` w `settle` łapie większość przypadków, ale nie ten — spec ma na to osobną flagę `called` wewnątrz procedury rozstrzygania."_

3. **Adopcja kosztuje o dwa ticki mniej niż w natywnym.** Natywny wkłada wywołanie `.then` obcego thenable w osobny job (`NewPromiseResolveThenableJob`). Zwykłe łańcuchy są tick-w-tick zgodne — sprawdzone porównaniem sekwencji z prawdziwym `Promise`.

**Umiejętność wymienienia tych trzech jest warta więcej niż ich zaimplementowanie.** Kandydat, który mówi „wiem, że tu upraszczam, oto co dokładnie odpuszczam i dlaczego", wygrywa z kandydatem, który napisał więcej kodu i nie umie powiedzieć, gdzie ten kod jest niepełny.

---

## 6. Dokładka: `Promise.all` i `race`

Najczęstsze pytanie dodatkowe. Dwanaście linii do zapamiętania:

```ts
static all<V>(items: (V | PromiseLike<V>)[]): MyPromise<V[]> {
  return new MyPromise((resolve, reject) => {
    const results: V[] = new Array(items.length);
    let remaining = items.length;
    if (remaining === 0) return resolve(results);
    items.forEach((item, index) => {
      MyPromise.resolve(item).then((value) => {
        results[index] = value as V;   // indeks z domknięcia = kolejność wejścia
        if (--remaining === 0) resolve(results);
      }, reject);                      // pierwsze odrzucenie wygrywa,
    });                                // reszta wpada w isResolved
  });
}
```

Dwie rzeczy do powiedzenia na głos przy pisaniu:

- **indeks z domknięcia**, nie `results.push` — `push` daje kolejność ukończenia zamiast kolejności wejścia;
- **`reject` przekazany gołą referencją do wszystkich** — drugie i trzecie odrzucenie same się wyciszą na strażniku `isResolved`, nie trzeba do tego żadnego kodu. To moment, w którym flaga zwraca zainwestowany wysiłek.

`race` to ta sama pętla bez licznika:

```ts
items.forEach((item) => MyPromise.resolve(item).then(resolve, reject));
```

---

## 7. Talking points

1. **„Jedna poprawka w `resolve` naprawia oba przypadki naraz."** `res(promise)` w executorze i `return promise` z callbacku to ta sama operacja — bo `handler.resolveNext` to jest `resolve` następnego promise'a. Pokazuje, że rozumiesz przepływ, a nie łatasz objawy.

2. **Dlaczego do kolejki idzie wrapper, a nie callback użytkownika.** `queueMicrotask` woła bez argumentów, więc wartość musi przyjechać domknięciem — a przy okazji wrapper jest miejscem na `try/catch`, bez którego rzut z callbacku poleciałby w pustkę: jesteśmy w mikrotasku, nad nami nie ma już stosu użytkownika.

3. **Dlaczego `resolve`/`reject` to strzałki, a nie metody.** Wędrują do executora jako gołe referencje i są wołane bez kropki, więc `this` musi być przyklejone leksykalnie.

4. **Dlaczego `handlers` trzeba opróżnić.** Nie z powodu re-entrancy (w pętli tylko kolejkujemy) — tylko dlatego, że `flushHandlers` woła się przy każdym `then()`. Bez opróżnienia branching odpaliłby pierwszy callback wielokrotnie. Sprawdzone empirycznie: trzy `.then()` na rozstrzygniętym promisie dają `A A B A B C`.

5. **Świadome uproszczenia** — §5. Miej je pod ręką na pytanie „co by tu jeszcze brakowało".

Powiązane: [[promise-implementacje]], [[interview-patterns]], [[event-loop-model]]

## Trace łańcucha Promise — dwa miejsca, w których się wykłada

**Zadanie:** przetraceować `Promise.resolve().then(throw).then(A).catch(B).then(C).finally().then(D)`
własnym modelem implementacji (handlers + flushHandlers + queueMicrotask).
Wynik: `B: boom` / `C: z` / `D: undefined`.

### Luka 1 — „brak złożenia": handler mieszka gdzie indziej, niż steruje

Przy propagacji odrzucenia zgubiłem ogniwo: uznałem, że w `handlers` promise'a
zwróconego z `catch` siedzi callback przekazany **do** `catch`. Strukturalnie
niemożliwe.

**Reguła:** handler mieszka na promisie, na którym wołasz `.then`;
steruje promisem, który `.then` **zwraca**. Źródło ≠ cel.

Objaw off-by-one: `C:` znika z outputu, a `D:` drukuje `z` zamiast `undefined`.
Test diagnostyczny — jeśli w łańcuchu z `catch` gubi ci się dokładnie jeden
`console.log`, sprawdź właśnie to.

### Luka 2 — „detal": granulacja mikrotasków

Opisywałem kaskadę throw → reject → reject → catch jako jeden ciąg w jednym
mikrotasku. `flushHandlers` woła wyłącznie `queueMicrotask` — nic nie leci
synchronicznie. **Jeden tick na ogniwo.** `B: boom` drukuje się w ticku 3,
nie w tym, w którym poleciał `throw`. Bez tego przeplot z natywnymi
promise'ami wychodzi źle.

### `finally` — dlaczego zwrotka callbacka jest ignorowana

Pozorna sprzeczność: `then` zawsze resolve'uje następny promise zwrotką
handlera, więc jak `finally` przepuszcza starą wartość?

Bo `finally` **nie rejestruje twojego callbacka jako `onFulfilled`** —
rejestruje opakowania, a callback siedzi w środku:

```js
(v) => {
  cb();
  return v;
}; // zwraca v z domknięcia, nie cb()
(r) => {
  cb();
  throw r;
}; // rethrow, nie return
```

Reguła `then` bez zmian; zmienia się tylko to, co jest handlerem.

- **Asymetria jest nośna.** Tor błędu musi robić `throw r`. `return r`
  zamieniłoby odrzucenie w spełnienie — najczęstszy bug w domowych `finally`.
- **Wersja zgodna ze spec czeka:** `(v) => Promise.resolve(cb()).then(() => v)`.
  Zwrotka jest ignorowana jako **wartość**, ale nie jako **czas** — thenable
  z `cb` wstrzymuje łańcuch, a jego odrzucenie nadpisuje oryginalny wynik.
- Rzut z `cb` nadpisuje wszystko, nawet gdy oryginał był fulfilled.

Powiązane: [[promise-implementacje]] (§9 — `finally` na liście braków
własnej implementacji), [[event-loop-model]]
