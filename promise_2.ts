type PromiseStatus = "pending" | "fulfilled" | "rejected";

const PENDING: PromiseStatus = "pending";
const FULFILLED: PromiseStatus = "fulfilled";
const REJECTED: PromiseStatus = "rejected";

// Step 1: Define types and constants
type Executor<T> = (
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (reason: any) => void,
) => void;

// FIX 2: callback może zwrócić promise — bez tego chaining asynchroniczny nie typuje się.
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
  // Step 2: Class fields
  private handlers: Handler[] = [];
  private status: PromiseStatus = PENDING;
  /**
   * Jedno pole na wartość spełnienia i na powód odrzucenia — znaczenie rozstrzyga `status`.
   * Kosztem jest utrata typowania; wersja bezpieczna typowo wymagałaby unii rozłącznej
   * { status: 'fulfilled', value: T } | { status: 'rejected', reason: any }.
   */
  private value: any = undefined;
  /**
   * Strażnik jednorazowości. Tu jest równoważny z `status !== PENDING`, bo w trakcie
   * adopcji cudzego promise'a świadomie go nie zapalamy (patrz `resolve`). W pełnej
   * implementacji to są dwie różne rzeczy: promise bywa *resolved* (los przypieczętowany)
   * i wciąż *pending* (wartości jeszcze nie ma).
   */
  private isResolved: boolean = false;

  // Step 4: constructor + Executor
  constructor(executor: Executor<T>) {
    try {
      // Executor wykonuje się SYNCHRONICZNIE — dlatego `new MyPromise(r => r(42))`
      // zwraca obiekt już w stanie fulfilled.
      executor(this.resolve, this.reject);
    } catch (err) {
      // throw użytkownika zamieniamy na odrzucenie. Nigdy odwrotnie.
      this.reject(err);
    }
  }

  // Step 3: settle, resolve, reject
  private settle(status: PromiseStatus, value: any): void {
    if (this.isResolved) return; // jeden punkt kontrolny dla każdej drogi do settlementu
    this.status = status;
    this.value = value;
    this.isResolved = true;
    this.flushHandlers();
  }

  // Strzałki, nie metody: te dwie funkcje wędrują do executora jako gołe
  // referencje i są wołane bez kropki, więc `this` musi być przyklejone leksykalnie.
  private resolve = (value: any): void => {
    // FIX 1 — JEDYNA zmiana w logice. Rozstrzygnięcie promise'em (albo czymkolwiek
    // z metodą .then) znaczy "przejmij jego los", a nie "weź go jako wartość".
    // Bez tych czterech linii .then(() => fetchCoś()) daje w następnym ogniwie
    // obiekt promise'a zamiast wyniku — czyli łańcuch asynchroniczny nie działa.
    //
    // Sprawdzamy kształt (.then), nie klasę (instanceof) — ten sam koszt,
    // a rozpakowuje też natywne Promise.
    // Oba tory: bez `this.reject` odrzucenie w środku zawiesiłoby nas na zawsze.
    if (value && typeof value.then === "function") {
      value.then(this.resolve, this.reject);
      return;
    }
    this.settle(FULFILLED, value);
  };

  private reject = (reason: any): void => {
    // reject NIE rozpakowuje — odrzucenie promise'em daje promise jako powód.
    // Tak samo działa natywny Promise.
    this.settle(REJECTED, reason);
  };

  // Step 6: handler execution
  private flushHandlers(): void {
    if (this.status === PENDING) return;

    // FIX 4 (komentarz): opróżnienie tablicy jest konieczne, ale NIE z powodu
    // dopisywania rekordów w trakcie pętli — tu tylko kolejkujemy mikrotaski,
    // więc nikt nic nie dopisze. Powód jest inny: flushHandlers() woła się przy
    // KAŻDYM then(), nie tylko przy rozstrzygnięciu. Bez opróżnienia drugie then()
    // na rozstrzygniętym promisie zakolejkowałoby ponownie rekord pierwszego
    // i callback odpaliłby się dwa razy.
    const pending = this.handlers;
    this.handlers = [];

    pending.forEach((handler) => {
      // Jedyne miejsce w pliku, w którym cokolwiek trafia do kolejki mikrotasków.
      // Do kolejki idzie wrapper, nie callback użytkownika — queueMicrotask woła
      // go bez argumentów, więc wartość musi przyjechać domknięciem.
      queueMicrotask(() => {
        const callback =
          this.status === FULFILLED ? handler.onFulfilled : handler.onRejected;

        if (!callback) {
          // Brak callbacku → przepuść wartość dalej, ZACHOWUJĄC tor.
          // Dzięki temu jeden .catch na końcu łańcucha łapie błąd z dowolnego ogniwa.
          if (this.status === FULFILLED) handler.resolveNext(this.value);
          else handler.rejectNext(this.value);
          return;
        }

        try {
          // resolveNext to resolve NASTĘPNEGO promise'a — czyli ten z FIX 1.
          // Stąd bierze się rozpakowywanie zwróconych promise'ów: nie ma tu
          // żadnego osobnego kodu na ten przypadek.
          handler.resolveNext(callback(this.value));
        } catch (err) {
          // Wyjątek z callbacku → tor błędu. Bez tego throw poleciałby w pustkę:
          // jesteśmy w mikrotasku, nad nami nie ma już żadnego try/catch użytkownika.
          handler.rejectNext(err);
        }
      });
    });
  }

  // Step 5: then + catch
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

  // FIX 3: T zostaje w unii — .catch NIE konsumuje toru sukcesu.
  // Jeśli promise się spełni, wartość przelatuje przez .catch nietknięta.
  catch<R = never>(onRejected?: OnRejected<R>): MyPromise<T | R> {
    return this.then<T | R>(undefined, onRejected);
  }

  // Step 7: statics — fabryki, nie funkcje sterujące. Produkują nowy promise,
  // zamiast zmieniać stan istniejącego, dlatego muszą być statyczne.
  static resolve<T>(value: T | PromiseLike<T>): MyPromise<T> {
    return new MyPromise<T>((res) => res(value));
  }

  static reject<R = never>(reason: any): MyPromise<R> {
    return new MyPromise<R>((_, rej) => rej(reason));
  }

  // Step 8: all — kombinator. Nie dotyka stanu żadnego z wejściowych promise'ów,
  // tylko obserwuje je i agreguje wynik w nowym.
  static all<T>(items: Array<T | PromiseLike<T>>): MyPromise<T[]> {
    return new MyPromise<T[]>((resolve, reject) => {
      const results: T[] = new Array(items.length);
      // Licznik, nie `results.length` — wartością spełnienia bywa `undefined`,
      // więc po samej tablicy nie da się poznać, które sloty są już wypełnione.
      let remaining = items.length;

      // Pusta tablica spełnia się od razu. Bez tego licznik nigdy nie dobiłby do zera.
      if (remaining === 0) {
        resolve(results);
        return;
      }

      items.forEach((item, i) => {
        // MyPromise.resolve normalizuje wejście: goła wartość, natywny Promise
        // i dowolny thenable trafiają na ten sam tor.
        MyPromise.resolve(item).then(
          (value) => {
            // Indeks z domknięcia — kolejność wyniku jest kolejnością WEJŚCIA,
            // nie kolejnością rozstrzygania.
            results[i] = value;
            remaining -= 1;
            if (remaining === 0) resolve(results);
          },
          // Fail-fast: pierwsze odrzucenie odrzuca całość. Pozostałe promise'y
          // biegną dalej — nie ma czego anulować — ale `settle` zignoruje
          // ich późniejsze próby, bo `isResolved` jest już zapalone.
          reject,
        );
      });
    });
  }
}

Promise.resolve()
  .then(() => {
    throw new Error("boom");
  })
  .then(() => console.log("A"))
  .catch((e) => {
    console.log("B:", e.message);
    return "z";
  })
  .then((v) => console.log("C:", v))
  .finally(() => "ignorowane?")
  .then((v) => console.log("D:", v));
