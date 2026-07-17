/**
 * reservationLock unit tests.
 *
 * Verifica el primitivo de serialización en memoria: operaciones para el MISMO reservationId corren
 * en fila (nunca solapadas), operaciones para reservationIds DISTINTOS corren en paralelo, y una
 * operación que falla no bloquea a la siguiente encolada para ese mismo id.
 */

const { withReservationLock } = require('../../../../src/infrastructure/concurrency/reservationLock');

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('withReservationLock', () => {
  it('serializa operaciones del MISMO id: la segunda no arranca hasta que la primera termina', async () => {
    const events = [];
    const op = (label, ms) => withReservationLock('r1', async () => {
      events.push(`start-${label}`);
      await delay(ms);
      events.push(`end-${label}`);
      return label;
    });

    // A es lenta (30ms), B es rápida (5ms). Sin lock, B terminaría ANTES que A (interleave).
    const [a, b] = await Promise.all([op('A', 30), op('B', 5)]);

    expect(a).toBe('A');
    expect(b).toBe('B');
    expect(events).toEqual(['start-A', 'end-A', 'start-B', 'end-B']);
  });

  it('NO bloquea entre ids distintos: r1 y r2 corren solapados', async () => {
    const events = [];
    const op = (key, label, ms) => withReservationLock(key, async () => {
      events.push(`start-${label}`);
      await delay(ms);
      events.push(`end-${label}`);
    });

    await Promise.all([op('r1', 'A', 30), op('r2', 'B', 5)]);

    // Ambas arrancan antes de que cualquiera termine (paralelo real), y B (rápida) termina primero.
    expect(events.slice(0, 2).sort()).toEqual(['start-A', 'start-B']);
    expect(events.indexOf('end-B')).toBeLessThan(events.indexOf('end-A'));
  });

  it('devuelve el valor de la operación y propaga su rechazo al llamador', async () => {
    await expect(withReservationLock('r1', async () => 42)).resolves.toBe(42);
    await expect(withReservationLock('r1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('una operación que falla NO bloquea a la siguiente encolada para el mismo id', async () => {
    const p1 = withReservationLock('r1', async () => { await delay(10); throw new Error('boom'); });
    const p2 = withReservationLock('r1', async () => 'second');

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('second');
  });

  it('operaciones encoladas para el mismo id se ejecutan en orden de llegada', async () => {
    const order = [];
    const op = (label) => withReservationLock('r1', async () => {
      await delay(5);
      order.push(label);
    });

    await Promise.all([op('first'), op('second'), op('third')]);

    expect(order).toEqual(['first', 'second', 'third']);
  });
});
