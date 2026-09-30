import type { MovementInput } from './playerPhysics';
import { requestLockSafely } from '../platform/pointerLock';

/** Ctrl/Shift combos we can prevent-default for while pointer-locked (see note below). */
const BLOCKABLE_MODIFIER_COMBOS = new Set(['KeyA', 'KeyS', 'KeyD']);

const MOUSE_BUTTON_BREAK = 0;
const MOUSE_BUTTON_PLACE = 2;

/** KeyboardEvent.code -> hotbar slot index for Digit1..Digit9. */
const HOTBAR_DIGIT_CODES: readonly string[] = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
];

/**
 * Place/drop are one-shot latches consumed once per frame via `consumeActions()`.
 * Break is a hold action — see `isBreakHeld()`. RMB is also independently
 * queryable as a hold action via `isUseHeld()` (used for eating food).
 */
export interface BlockActions {
  placePressed: boolean;
  dropPressed: boolean;
  /** True on the single frame LMB transitioned from up to down (the "attack" edge); see `isBreakHeld()` for the hold state. */
  attackPressed: boolean;
}

/** Pending hotbar selection/scroll input consumed once per frame via `consumeHotbarInput()`. */
export interface HotbarInput {
  /** Slot index 0..8 from the last Digit1..Digit9 press this frame, or null if none. */
  select: number | null;
  /** Net scroll steps accumulated this frame (+1 per wheel event with deltaY > 0). */
  scroll: number;
}

/** One-shot inventory-screen open/close latches consumed once per frame via `consumeUiInput()`. */
export interface UiInput {
  /** KeyE pressed this frame (recorded regardless of pointer-lock state). */
  toggleInventory: boolean;
  /** Escape pressed this frame while unlocked. */
  close: boolean;
  /** F3 pressed this frame (recorded in any pointer-lock state; repeats suppressed). */
  toggleDebug: boolean;
}

/**
 * Tracks keyboard state, pointer-lock mouse-look deltas, and break/place
 * mouse-button presses for the player. Call `sample()` once per frame to get
 * a movement snapshot and reset accumulated mouse movement; call
 * `consumeActions()` once per frame to read and clear pending break/place
 * presses; call `dispose()` on teardown to remove all listeners.
 */
export class InputController {
  private readonly pressed = new Set<string>();
  /** Tracks held keys while unlocked, separately from `pressed`, purely for one-shot repeat suppression (KeyE/Escape). */
  private readonly heldUnlocked = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private locked = false;
  private breakHeld = false;
  private useHeld = false;
  private pendingPlace = false;
  private pendingDrop = false;
  private pendingAttack = false;
  private pendingHotbarSelect: number | null = null;
  private pendingHotbarScroll = 0;
  private pendingToggleInventory = false;
  private pendingClose = false;
  private pendingToggleDebug = false;
  private debugKeyHeld = false;

  private readonly doc: Document;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F3') {
      // Browsers bind F3 to "find next"; always claim it, locked or not.
      event.preventDefault();
      if (!this.debugKeyHeld) {
        this.pendingToggleDebug = true;
      }
      this.debugKeyHeld = true;
      return;
    }
    if (!this.locked) {
      // Movement/look/action state (`pressed`) stays untouched while
      // unlocked (sample()/consumeActions() must keep ignoring it), but
      // KeyE/Escape still need repeat suppression — tracked separately via
      // `heldUnlocked` so holding a key doesn't spam the one-shot latch.
      const isRepeat = this.heldUnlocked.has(event.code);
      this.heldUnlocked.add(event.code);

      if (event.code === 'KeyE' && !isRepeat) {
        this.pendingToggleInventory = true;
      }
      if (event.code === 'Escape' && !isRepeat) {
        this.pendingClose = true;
      }
      return;
    }

    // Native key-repeat re-fires keydown without an intervening keyup while a
    // key is held; `pressed` already containing the code is how we detect
    // that and avoid repeating one-shot actions (Q, E) every repeat tick.
    const isRepeat = this.pressed.has(event.code);
    this.pressed.add(event.code);

    if (event.code === 'KeyE' && !isRepeat) {
      this.pendingToggleInventory = true;
    }
    // Note: Ctrl+W closes/reloads the tab in most browsers and cannot be
    // prevented via preventDefault(); only some Ctrl+<key> combos below are
    // actually blockable, so this is best-effort while pointer-locked.
    if (this.locked && event.ctrlKey && BLOCKABLE_MODIFIER_COMBOS.has(event.code)) {
      event.preventDefault();
    }
    const digitIndex = HOTBAR_DIGIT_CODES.indexOf(event.code);
    if (digitIndex !== -1) {
      this.pendingHotbarSelect = digitIndex;
    }
    if (event.code === 'KeyQ' && !isRepeat) {
      this.pendingDrop = true;
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.locked) {
      return;
    }
    if (event.deltaY > 0) {
      this.pendingHotbarScroll += 1;
    } else if (event.deltaY < 0) {
      this.pendingHotbarScroll -= 1;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
    this.heldUnlocked.delete(event.code);
    if (event.code === 'F3') {
      this.debugKeyHeld = false;
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) {
      return;
    }
    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    // Only while already locked: the click that acquires pointer lock must
    // not also register as a break/place action.
    if (!this.locked) {
      return;
    }
    if (event.button === MOUSE_BUTTON_BREAK) {
      if (!this.breakHeld) {
        // Edge of the hold (not a repeat while already held) — one attack per press.
        this.pendingAttack = true;
      }
      this.breakHeld = true;
    } else if (event.button === MOUSE_BUTTON_PLACE) {
      this.pendingPlace = true;
      this.useHeld = true;
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === MOUSE_BUTTON_BREAK) {
      this.breakHeld = false;
    } else if (event.button === MOUSE_BUTTON_PLACE) {
      this.useHeld = false;
    }
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onPointerLockChange = (): void => {
    this.locked = this.doc.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.releaseAll();
    }
  };

  /** Drops held keys, pending look deltas, and pending actions so nothing sticks after focus loss. */
  private readonly releaseAll = (): void => {
    this.pressed.clear();
    this.heldUnlocked.clear();
    this.debugKeyHeld = false;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.breakHeld = false;
    this.useHeld = false;
    this.pendingPlace = false;
    this.pendingDrop = false;
    this.pendingAttack = false;
    this.pendingHotbarSelect = null;
    this.pendingHotbarScroll = 0;
  };

  private readonly onCanvasClick = (): void => {
    requestLockSafely(this.canvas);
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    doc: Document = document,
  ) {
    this.doc = doc;
    this.doc.addEventListener('keydown', this.onKeyDown);
    this.doc.addEventListener('keyup', this.onKeyUp);
    this.doc.addEventListener('mousemove', this.onMouseMove);
    this.doc.addEventListener('mousedown', this.onMouseDown);
    this.doc.addEventListener('mouseup', this.onMouseUp);
    this.doc.addEventListener('wheel', this.onWheel);
    this.doc.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.doc.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('click', this.onCanvasClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    // Guarded: tests construct InputController with a fake Document but no
    // global `window` (node test environment, no jsdom/happy-dom dependency).
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.releaseAll);
    }
  }

  isLocked(): boolean {
    return this.locked;
  }

  /** True while LMB is held and the pointer is locked; cleared on mouseup, unlock, blur, or dispose. */
  isBreakHeld(): boolean {
    return this.breakHeld;
  }

  /**
   * True while RMB is held and the pointer is locked; cleared on mouseup,
   * unlock, blur, or dispose. Independent of `consumeActions().placePressed`
   * (the one-shot place/use latch) — this is purely a hold query, used to
   * accumulate eat progress while a food item is selected.
   */
  isUseHeld(): boolean {
    return this.useHeld;
  }

  private isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Returns a snapshot of current movement/look input and clears mouse deltas. */
  sample(): MovementInput {
    let forward = 0;
    if (this.isDown('KeyW')) forward += 1;
    if (this.isDown('KeyS')) forward -= 1;

    let right = 0;
    if (this.isDown('KeyD')) right += 1;
    if (this.isDown('KeyA')) right -= 1;

    const input: MovementInput = {
      forward,
      right,
      jump: this.isDown('Space'),
      sprint: this.isDown('ShiftLeft'),
      crouch: this.isDown('ControlLeft'),
      lookDeltaX: this.mouseDeltaX,
      lookDeltaY: this.mouseDeltaY,
    };

    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    return input;
  }

  /**
   * Returns and clears pending place/drop presses (one action per press;
   * holding never repeats). Break is a hold action, see `isBreakHeld()`.
   */
  consumeActions(): BlockActions {
    const actions: BlockActions = {
      placePressed: this.pendingPlace,
      dropPressed: this.pendingDrop,
      attackPressed: this.pendingAttack,
    };
    this.pendingPlace = false;
    this.pendingDrop = false;
    this.pendingAttack = false;
    return actions;
  }

  /** Returns and clears pending hotbar select/scroll input (see `HotbarInput`). */
  consumeHotbarInput(): HotbarInput {
    const input: HotbarInput = {
      select: this.pendingHotbarSelect,
      scroll: this.pendingHotbarScroll,
    };
    this.pendingHotbarSelect = null;
    this.pendingHotbarScroll = 0;
    return input;
  }

  /** Returns and clears pending inventory-screen toggle/close latches (see `UiInput`). */
  consumeUiInput(): UiInput {
    const input: UiInput = {
      toggleInventory: this.pendingToggleInventory,
      close: this.pendingClose,
      toggleDebug: this.pendingToggleDebug,
    };
    this.pendingToggleInventory = false;
    this.pendingClose = false;
    this.pendingToggleDebug = false;
    return input;
  }

  dispose(): void {
    this.doc.removeEventListener('keydown', this.onKeyDown);
    this.doc.removeEventListener('keyup', this.onKeyUp);
    this.doc.removeEventListener('mousemove', this.onMouseMove);
    this.doc.removeEventListener('mousedown', this.onMouseDown);
    this.doc.removeEventListener('mouseup', this.onMouseUp);
    this.doc.removeEventListener('wheel', this.onWheel);
    this.doc.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.doc.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this.releaseAll);
    }
    this.pressed.clear();
    this.heldUnlocked.clear();
  }
}
