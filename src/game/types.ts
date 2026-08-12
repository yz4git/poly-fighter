export type HitLevel = "HIGH" | "MID" | "LOW" | "THROW";

export type FighterState =
  | "IDLE"
  | "WALK"
  | "CROUCH"
  | "JUMP"
  | "SIDESTEP"
  | "GUARD"
  | "ATTACK"
  | "HIT"
  | "BLOCK_STUN"
  | "KNOCKDOWN"
  | "WAKEUP"
  | "THROW"
  | "KO"
  | "RING_OUT";

export type AnimationName =
  | "idle"
  | "walk"
  | "crouch"
  | "jump"
  | "sidestep"
  | "punch"
  | "kick"
  | "guard"
  | "hit"
  | "knockdown"
  | "wakeup"
  | "throw"
  | "ko";

export type ActionButton = "punch" | "kick" | "guard";
export type DirectionButton = "left" | "right" | "up" | "down";
export type InputAction = ActionButton | DirectionButton;

export interface InputFrame {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  punch: boolean;
  kick: boolean;
  guard: boolean;
}

export const EMPTY_INPUT: InputFrame = {
  left: false,
  right: false,
  up: false,
  down: false,
  punch: false,
  kick: false,
  guard: false,
};

export interface MoveDefinition {
  id: string;
  label: string;
  input: string;
  animation: AnimationName;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  guardDamage: number;
  hitStun: number;
  blockStun: number;
  knockback: number;
  hitLevel: HitLevel;
  tracking: number;
  cancelWindow: number;
  hitStop: number;
  reach: number;
  width: number;
  height: number;
  power: number;
  knockdown?: boolean;
  launcher?: boolean;
}

export interface BodySpec {
  height: number;
  shoulderWidth: number;
  clavicleWidth?: number;
  chestWidth?: number;
  chestDepth: number;
  waistWidth: number;
  pelvisWidth?: number;
  hipWidth: number;
  armLength: number;
  upperArmMass?: number;
  forearmMass?: number;
  legLength: number;
  thighMass?: number;
  calfMass?: number;
  neckLength?: number;
  muscle: number;
  headWidth: number;
  headDepth?: number;
  jawWidth: number;
  cheekWidth?: number;
  browDepth?: number;
  noseLength?: number;
  handScale: number;
  footScale: number;
  longPanels?: boolean;
}

export interface FighterDefinition {
  id: string;
  name: string;
  callsign: string;
  archetype: "POWER" | "SPEED";
  colors: {
    primary: number;
    secondary: number;
    accent: number;
    skin: number;
    hair: number;
    glow: number;
  };
  body: BodySpec;
  moves: Record<string, MoveDefinition>;
}

export interface Hurtbox {
  kind: "HEAD" | "BODY" | "LEGS";
  centerX: number;
  centerY: number;
  centerZ: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}

export interface HitEvent {
  attacker: string;
  defender: string;
  move: MoveDefinition;
  blocked: boolean;
  counter: boolean;
  throwEscape: boolean;
  damage: number;
  position: { x: number; y: number; z: number };
}

export interface HudSnapshot {
  phase: "TITLE" | "SELECT" | "MATCH" | "RESULT";
  round: number;
  timer: number;
  p1Health: number;
  p2Health: number;
  p1Wins: number;
  p2Wins: number;
  p1Name: string;
  p2Name: string;
  message: string;
  p1State: FighterState;
  p2State: FighterState;
}

export function cloneInput(input: InputFrame): InputFrame {
  return { ...input };
}

export function isInputEmpty(input: InputFrame): boolean {
  return !(
    input.left ||
    input.right ||
    input.up ||
    input.down ||
    input.punch ||
    input.kick ||
    input.guard
  );
}
