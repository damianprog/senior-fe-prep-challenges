// bun test src/problems/14-promise/test/promise.test.ts

type PromiseStatus = "pending" | "fulfilled" | "rejected";

const PENDING: PromiseStatus = "pending";
const FULFILLED: PromiseStatus = "fulfilled";
const REJECTED: PromiseStatus = "rejected";

// Step 1: Define types and constants
//  - Executor
//  - OnFulfilled<T,R>
//  - OnRejected<R>
//  - Handler
//  - Update MyPromise<T> with types above
// Step 2: Define class fields
//  - handlers, status, value, isResolved
// Step 3: Implement settle, resolve, reject
// Step 4: constructor + Executor
// - Run tests for resolving / rejecting
// Step 5: Implement then<R> and catch
// Step 6: Implement handler execution
// - Run tests for then / catch and chaining
// Step 7: static resolve, static reject
// - Run tests for statics

type Executor<T> = (
  resolve: (value: T) => void,
  reject: (reason: any) => void,
) => void;

type OnFulfilled<T, R> = (value: T) => R;
type OnRejected<R> = (reason: any) => R;

type Handler = {
  onFulfilled: OnFulfilled<any, any> | undefined;
  onRejected: OnRejected<any> | undefined;
  resolveNext: (value: any) => void;
  rejectNext: (reason: any) => void;
};

export class MyPromise<T> {
  private handlers: Handler[] = [];
  private status: PromiseStatus = PENDING;
  private value: any = undefined;
  private isResolved: boolean = false;

  private settle(status: PromiseStatus, value: any): void {
    if (!this.isResolved) {
      this.status = status;
      this.value = value;
      this.isResolved = true;
      this.flushHandlers();
    }
  }

  private resolve = (value: T): void => {
    this.settle(FULFILLED, value);
  };

  private reject = (reason: any): void => {
    this.settle(REJECTED, reason);
  };

  constructor(executor: Executor<T>) {
    try {
      executor(this.resolve, this.reject);
    } catch (err) {
      this.reject(err);
    }
  }

  private flushHandlers(): void {
    if (this.status === PENDING) return;

    const pending = this.handlers;
    this.handlers = [];

    pending.forEach((handler) => {
      queueMicrotask(() => {
        const callback =
          this.status === FULFILLED ? handler.onFulfilled : handler.onRejected;

        if (!callback) {
          // brak callbacku → przepuść wartość dalej, ZACHOWUJĄC tor
          if (this.status === FULFILLED) handler.resolveNext(this.value);
          else handler.rejectNext(this.value);
          return;
        }

        try {
          handler.resolveNext(callback(this.value));
        } catch (err) {
          handler.rejectNext(err);
        }
      });
    });
  }

  then<R = T>(
    onFulfilled?: OnFulfilled<T, R>,
    onRejected?: OnRejected<R>,
  ): MyPromise<R> {
    const next = new MyPromise<R>((resolveNext, rejectNext) => {
      this.handlers.push({ onFulfilled, onRejected, resolveNext, rejectNext });
    });

    this.flushHandlers();
    return next;
  }
  catch<R>(onRejected: OnRejected<R>): MyPromise<R> {
    return this.then(undefined, onRejected);
  }
  static resolve() {
    throw new Error("Not implemented");
  }
  static reject() {
    throw new Error("Not implemented");
  }
}

// --- Examples ---
// Uncomment to test your implementation:

// --- Step 4: constructor + Executor ---
const p1 = new MyPromise((resolve: any) => resolve(42));
console.log(p1); // Expected: MyPromise { status: 'fulfilled', value: 42 }
//
const p2 = new MyPromise((_: any, reject: any) => reject("error"));
console.log(p2); // Expected: MyPromise { status: 'rejected', value: 'error' }

const p3 = new MyPromise(() => {
  throw new Error("oops");
});
console.log(p3); // Expected: MyPromise { status: 'rejected', value: Error: oops }
//
const p4 = new MyPromise((resolve: any) => {
  resolve(1);
  resolve(2);
});
console.log(p4); // Expected: MyPromise { status: 'fulfilled', value: 1 } (settled once)

const catchTooLate = new MyPromise((resolve) => {
  resolve(1);
  throw new Error("za późno");
});
console.log(catchTooLate);

// --- Step 6: then / catch and chaining ---
// const p5 = new MyPromise((resolve: any) => resolve(42))
// p5.then((v: any) => console.log(v))  // Expected: 42
//
// const p6 = new MyPromise((resolve: any) => resolve(1))
//   .then((v: any) => v + 1)
//   .then((v: any) => console.log(v))   // Expected: 2
//
// const p7 = new MyPromise((_: any, reject: any) => reject('error'))
// p7.catch((e: any) => console.log(e))  // Expected: "error"
//
// new MyPromise((_: any, reject: any) => reject('error'))
//   .catch(() => 'recovered')
//   .then((v: any) => console.log(v))   // Expected: "recovered"
//
// new MyPromise((resolve: any) => resolve(1))
//   .then(() => { throw new Error('handler error') })
//   .catch((e: any) => console.log(e.message))  // Expected: "handler error"

// --- Step 7: static resolve, static reject ---
// MyPromise.resolve(99).then((v: any) => console.log(v))   // Expected: 99
// MyPromise.reject('no').catch((e: any) => console.log(e))  // Expected: "no"
