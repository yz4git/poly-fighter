export type TpsLockOnProfileInput = {
  inStrikeRange: boolean;
  windup: boolean;
  threat: boolean;
  perfectEvade: boolean;
  renderTime: number;
  contactReadability: number;
};

export type TpsLockOnProfile = {
  lockLift: number;
  lockColor: number;
  pulse: number;
  groundPulse: number;
  groundOpacity: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeTpsLockOnProfile(input: TpsLockOnProfileInput): TpsLockOnProfile {
  const lockLift = input.inStrikeRange ? 0.62 : 0.46;
  const lockColor = input.perfectEvade
    ? 0x6dffb8
    : input.threat
      ? 0xff506f
      : input.windup
        ? 0xffc45a
        : input.inStrikeRange
          ? 0xffd45c
          : 0x7ce8ff;

  const pulseRate = input.threat ? 14.0 : input.windup ? 8.5 : 5.5;
  const pulse = (
    input.threat
      ? 1.02
      : input.windup
        ? 0.96
        : input.inStrikeRange
          ? 0.88
          : 0.86
  ) + Math.sin(input.renderTime * pulseRate) * (
    input.threat ? 0.075 : input.windup ? 0.06 : 0.045
  );

  const groundPulse = (
    input.threat ? 1.08 : input.windup ? 1.02 : 0.95
  ) + Math.sin(input.renderTime * pulseRate) * (
    input.threat ? 0.10 : 0.06
  );

  const baseGroundOpacity = input.threat
    ? 0.68
    : input.windup
      ? 0.46
      : input.inStrikeRange
        ? 0.34
        : 0.22;

  return {
    lockLift,
    lockColor,
    pulse,
    groundPulse,
    groundOpacity: baseGroundOpacity * (1 - clamp01(input.contactReadability) * 0.46),
  };
}
