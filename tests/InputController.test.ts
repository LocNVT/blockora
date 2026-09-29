import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputController } from '../src/player/InputController';

/**
 * Minimal fake Document/HTMLCanvasElement built on Node's EventTarget, just
 * enough surface for InputController: addEventListener/removeEventListener,
 * plus a settable `pointerLockElement` so lock state can be simulated.
 */
class FakeCanvas extends EventTarget {}

class FakeDocument extends EventTarget {
  pointerLockElement: EventTarget | null = null;
}

function mouseDownEvent(button: number): Event {
  const event = new Event('mousedown', { cancelable: true });
  Object.defineProperty(event, 'button', { value: button });
  return event;
}

function mouseUpEvent(button: number): Event {
  const event = new Event('mouseup', { cancelable: true });
  Object.defineProperty(event, 'button', { value: button });
  return event;
}

function keyDownEvent(code: string): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'code', { value: code });
  return event;
}

function wheelEvent(deltaY: number): Event {
  const event = new Event('wheel', { cancelable: true });
  Object.defineProperty(event, 'deltaY', { value: deltaY });
  return event;
}

describe('InputController: break/place latches', () => {
  let doc: FakeDocument;
  let canvas: FakeCanvas;
  let controller: InputController;

  beforeEach(() => {
    doc = new FakeDocument();
    canvas = new FakeCanvas();
    controller = new InputController(
      canvas as unknown as HTMLCanvasElement,
      doc as unknown as Document,
    );
    // Simulate pointer lock being acquired.
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(controller.isLocked()).toBe(true);
  });

  afterEach(() => {
    controller.dispose();
  });

  it('LMB down sets isBreakHeld true; mouseup clears it', () => {
    expect(controller.isBreakHeld()).toBe(false);
    doc.dispatchEvent(mouseDownEvent(0));
    expect(controller.isBreakHeld()).toBe(true);
    // Break is a hold (isBreakHeld), so LMB never produces a consumeActions latch.
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
    expect(controller.isBreakHeld()).toBe(true);

    doc.dispatchEvent(mouseUpEvent(0));
    expect(controller.isBreakHeld()).toBe(false);
  });

  it('one RMB press sets placePressed true once', () => {
    doc.dispatchEvent(mouseDownEvent(2));
    expect(controller.consumeActions()).toEqual({ placePressed: true, dropPressed: false });
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
  });

  it('RMB down sets isUseHeld true; mouseup clears it', () => {
    expect(controller.isUseHeld()).toBe(false);
    doc.dispatchEvent(mouseDownEvent(2));
    expect(controller.isUseHeld()).toBe(true);
    doc.dispatchEvent(mouseUpEvent(2));
    expect(controller.isUseHeld()).toBe(false);
  });

  it('isUseHeld is independent of the one-shot placePressed latch', () => {
    doc.dispatchEvent(mouseDownEvent(2));
    expect(controller.consumeActions()).toEqual({ placePressed: true, dropPressed: false });
    // Latch consumed, but the button is still physically held.
    expect(controller.isUseHeld()).toBe(true);
  });

  it('mousedown on RMB while NOT locked does not set isUseHeld', () => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(controller.isLocked()).toBe(false);

    doc.dispatchEvent(mouseDownEvent(2));
    expect(controller.isUseHeld()).toBe(false);
  });

  it('isUseHeld is cleared on unlock', () => {
    doc.dispatchEvent(mouseDownEvent(2));
    expect(controller.isUseHeld()).toBe(true);

    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(controller.isUseHeld()).toBe(false);
  });

  it('dispose removes the mousedown/mouseup listeners: isUseHeld no longer responds afterward', () => {
    controller.dispose();
    doc.dispatchEvent(mouseDownEvent(2));
    expect(controller.isUseHeld()).toBe(false);
  });

  it('mousedown while NOT locked does not set isBreakHeld', () => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(controller.isLocked()).toBe(false);

    doc.dispatchEvent(mouseDownEvent(0));
    expect(controller.isBreakHeld()).toBe(false);
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
  });

  it('the click that acquires pointer lock does not itself hold break', () => {
    // Start unlocked, as if this is the very first click.
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(controller.isLocked()).toBe(false);

    // The mousedown that triggers the lock request arrives before locked=true
    // in a real browser too; simulate it firing while still unlocked.
    doc.dispatchEvent(mouseDownEvent(0));
    expect(controller.isBreakHeld()).toBe(false);
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
  });

  it('isBreakHeld is cleared on unlock', () => {
    doc.dispatchEvent(mouseDownEvent(0));
    expect(controller.isBreakHeld()).toBe(true);

    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(controller.isBreakHeld()).toBe(false);
  });

  it('dispose removes the mousedown listener: isBreakHeld no longer responds afterward', () => {
    controller.dispose();
    doc.dispatchEvent(mouseDownEvent(0));
    expect(controller.isBreakHeld()).toBe(false);
  });

  it('contextmenu is prevented', () => {
    const event = new Event('contextmenu', { cancelable: true });
    doc.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('dispose removes listeners: no action recorded after dispose', () => {
    controller.dispose();
    doc.dispatchEvent(mouseDownEvent(0));
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
  });

  it('one KeyQ press sets dropPressed true once, then false on next consume', () => {
    doc.dispatchEvent(keyDownEvent('KeyQ'));
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: true });
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
  });

  it('holding KeyQ (repeated keydown without keyup) does not repeat the drop action', () => {
    doc.dispatchEvent(keyDownEvent('KeyQ'));
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: true });
    // Simulate browser key-repeat: another keydown for the same code, no keyup between.
    doc.dispatchEvent(keyDownEvent('KeyQ'));
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
  });

  it('KeyQ is ignored while unlocked', () => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(controller.isLocked()).toBe(false);

    doc.dispatchEvent(keyDownEvent('KeyQ'));
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
  });

  it('pending drop is cleared on unlock', () => {
    doc.dispatchEvent(keyDownEvent('KeyQ'));
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));

    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
  });
});

describe('InputController: hotbar select/scroll', () => {
  let doc: FakeDocument;
  let canvas: FakeCanvas;
  let controller: InputController;

  beforeEach(() => {
    doc = new FakeDocument();
    canvas = new FakeCanvas();
    controller = new InputController(
      canvas as unknown as HTMLCanvasElement,
      doc as unknown as Document,
    );
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(controller.isLocked()).toBe(true);
  });

  afterEach(() => {
    controller.dispose();
  });

  it('Digit3 while locked selects slot index 2', () => {
    doc.dispatchEvent(keyDownEvent('Digit3'));
    expect(controller.consumeHotbarInput()).toEqual({ select: 2, scroll: 0 });
  });

  it('digits are ignored while unlocked', () => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(controller.isLocked()).toBe(false);

    doc.dispatchEvent(keyDownEvent('Digit5'));
    expect(controller.consumeHotbarInput()).toEqual({ select: null, scroll: 0 });
  });

  it('last digit pressed wins within a frame', () => {
    doc.dispatchEvent(keyDownEvent('Digit1'));
    doc.dispatchEvent(keyDownEvent('Digit9'));
    expect(controller.consumeHotbarInput()).toEqual({ select: 8, scroll: 0 });
  });

  it('wheel events accumulate and clear after consume', () => {
    doc.dispatchEvent(wheelEvent(120));
    doc.dispatchEvent(wheelEvent(120));
    doc.dispatchEvent(wheelEvent(-120));
    expect(controller.consumeHotbarInput()).toEqual({ select: null, scroll: 1 });
    expect(controller.consumeHotbarInput()).toEqual({ select: null, scroll: 0 });
  });

  it('pending hotbar input is cleared on unlock', () => {
    doc.dispatchEvent(keyDownEvent('Digit4'));
    doc.dispatchEvent(wheelEvent(120));

    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));

    expect(controller.consumeHotbarInput()).toEqual({ select: null, scroll: 0 });
  });

  it('dispose removes listeners: no hotbar input recorded after dispose', () => {
    controller.dispose();
    doc.dispatchEvent(keyDownEvent('Digit2'));
    doc.dispatchEvent(wheelEvent(120));
    expect(controller.consumeHotbarInput()).toEqual({ select: null, scroll: 0 });
  });
});

describe('InputController: inventory toggle/close (UI input)', () => {
  let doc: FakeDocument;
  let canvas: FakeCanvas;
  let controller: InputController;

  beforeEach(() => {
    doc = new FakeDocument();
    canvas = new FakeCanvas();
    controller = new InputController(
      canvas as unknown as HTMLCanvasElement,
      doc as unknown as Document,
    );
  });

  afterEach(() => {
    controller.dispose();
  });

  function lock(): void {
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event('pointerlockchange'));
  }

  function unlock(): void {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
  }

  it('KeyE toggles while locked', () => {
    lock();
    expect(controller.isLocked()).toBe(true);

    doc.dispatchEvent(keyDownEvent('KeyE'));
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: true, close: false });
    // Consumed once: next read is false until pressed again.
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: false, close: false });
  });

  it('KeyE toggles while unlocked', () => {
    unlock();
    expect(controller.isLocked()).toBe(false);

    doc.dispatchEvent(keyDownEvent('KeyE'));
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: true, close: false });
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: false, close: false });
  });

  it('holding KeyE (repeated keydown without keyup) does not repeat the toggle', () => {
    unlock();
    doc.dispatchEvent(keyDownEvent('KeyE'));
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: true, close: false });
    doc.dispatchEvent(keyDownEvent('KeyE'));
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: false, close: false });
  });

  it('Escape sets close latch only while unlocked', () => {
    unlock();
    doc.dispatchEvent(keyDownEvent('Escape'));
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: false, close: true });
  });

  it('Escape is ignored while locked', () => {
    lock();
    doc.dispatchEvent(keyDownEvent('Escape'));
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: false, close: false });
  });

  it('movement/look/action latches stay ignored while unlocked (existing behaviour)', () => {
    unlock();
    doc.dispatchEvent(keyDownEvent('KeyW'));
    doc.dispatchEvent(mouseDownEvent(0));
    doc.dispatchEvent(keyDownEvent('Digit3'));

    expect(controller.sample().forward).toBe(0);
    expect(controller.consumeActions()).toEqual({ placePressed: false, dropPressed: false });
    expect(controller.consumeHotbarInput()).toEqual({ select: null, scroll: 0 });
  });

  it('dispose removes listeners: no UI input recorded after dispose', () => {
    controller.dispose();
    doc.dispatchEvent(keyDownEvent('KeyE'));
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: false, close: false });
  });
});
