# Grounded kick motion

All four imported kick clips are authored once per body type by `createCombatMotionLibrary`. Supporting feet use one solve against the ready-stance floor and a level sole. The strike leg retains the source thigh/calf rotations. Dash Kick removes the source jump from the pelvis track while preserving the strike pose and torso motion. Common ready poses handle entry and recovery.

The six runtime kick wrappers have been removed. Presentation no longer repeatedly solves the strike leg, retreats the model, or changes the pose again after sampling. TPS root yaw is set from the opponent direction before world-space presentation work. The motion-correction switch controls optional runtime conditioning.

Gameplay timing, reach, hitboxes and simulation positions remain owned by the combat runtime. Real male/female skeleton tests check strike geometry, grounded support and ankle continuity. WebGL audits inspect the final rendered bones and linked kicks instead of wrapper telemetry.
