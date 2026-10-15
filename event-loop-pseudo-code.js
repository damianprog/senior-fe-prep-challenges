// Uproszczony model event loopa przeglądarki
const macrotaskQueue = []; // setTimeout, zdarzenia, I/O
const microtaskQueue = []; // .then, await, queueMicrotask

function eventLoop() {
  while (true) {
    // 1. Weź JEDEN macrotask (jeśli jest)
    const task = macrotaskQueue.shift();
    if (task) task(); // wykonuje się na call stacku do końca

    // 2. Opróżnij CAŁĄ kolejkę microtasków,
    //    także te dodane w trakcie jej opróżniania
    while (microtaskQueue.length > 0) {
      const micro = microtaskQueue.shift();
      micro();
    }

    // 3. Ewentualny render (ok. 60 razy/s, jeśli przeglądarka uzna to za potrzebne)
    if (shouldRender()) {
      runRequestAnimationFrameCallbacks();
      render(); // style → layout → paint
    }

    // 4. Jeśli nic nie ma w kolejkach, czekaj na nowe zadanie
    if (macrotaskQueue.length === 0) waitForNewTask();
  }
}
