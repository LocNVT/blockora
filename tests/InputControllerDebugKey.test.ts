import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputController } from '../src/player/InputController';

class FakeCanvas extends EventTarget {}

class FakeDocument extends EventTarget {
  pointerLockElement: EventTarget | null = null;
}

function keyEvent(type: 'keydown' | 'keyup', code: string): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'code', { value: code });
  return event;
}

describe('InputController: F3 debug toggle', () => {
  let doc: FakeDocument;
  let canvas: FakeCanvas;
  let controller: InputController;

  function setLocked(locked: boolean): void {
    doc.pointerLockElement = locked ? canvas : null;
    doc.dispatchEvent(new Event('pointerlockchange'));
  }

  beforeEach(() => {
    doc = new FakeDocument();
    canvas = new FakeCanvas();
    controller = new InputController(canvas as unknown as HTMLCanvasElement, doc as unknown as Document);
  });

  afterEach(() => {
    controller.dispose();
  });

  it('F3 latches toggleDebug (unlocked and locked) and prevents the browser default', () => {
    for (const locked of [false, true]) {
      setLocked(locked);
      const event = keyEvent('keydown', 'F3');
      doc.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(controller.consumeUiInput().toggleDebug).toBe(true);
      expect(controller.consumeUiInput().toggleDebug).toBe(false);
      doc.dispatchEvent(keyEvent('keyup', 'F3'));
    }
  });

  it('suppresses key-repeat until F3 is released', () => {
    doc.dispatchEvent(keyEvent('keydown', 'F3'));
    doc.dispatchEvent(keyEvent('keydown', 'F3'));
    expect(controller.consumeUiInput().toggleDebug).toBe(true);
    doc.dispatchEvent(keyEvent('keydown', 'F3'));
    expect(controller.consumeUiInput().toggleDebug).toBe(false);
    doc.dispatchEvent(keyEvent('keyup', 'F3'));
    doc.dispatchEvent(keyEvent('keydown', 'F3'));
    expect(controller.consumeUiInput().toggleDebug).toBe(true);
  });

  it('does not disturb inventory latches or pointer-lock state', () => {
    setLocked(true);
    doc.dispatchEvent(keyEvent('keydown', 'F3'));
    expect(controller.isLocked()).toBe(true);
    expect(controller.consumeUiInput()).toEqual({ toggleInventory: false, close: false, toggleDebug: true });
  });
});
