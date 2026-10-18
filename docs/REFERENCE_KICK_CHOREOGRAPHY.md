# Reference-based kick choreography

The default Quaternius skin bakes four complete kick clips on each target
skeleton. `reference-kick-choreography.ts` describes preparation, chamber,
contact, follow-through, retraction and return to the common guard. The bake
uses measured limb lengths and the existing authored-contact timeline; moveTick,
hitstop, hitboxes and arena movement still own gameplay time and position.

The striking hip drives forward before full extension. The planted foot turns
around its ball while the heel moves; its toe stays fixed. The striking knee
chambers before contact, retains a small bend at impact, then retracts before
the foot returns to the floor. The pelvis, thorax, guarding hand and free arm
are posed together. A contact-calibrated ankle frame avoids the boot-roll
singularity of reconstructing a foot from each frame's swinging shin.

These are independent implementations informed by:

- [3D Fighter animation authoring](https://github.com/clintcan/3d-fighter/blob/main/tools/build_fight_animations.gd): explicit kick landmarks, support-foot pivot, hip drive, counterbalance and retraction.
- [Overgrowth character script](https://github.com/WolfireGames/overgrowth/blob/main/Data/Scripts/aschar.as): separate planted and swinging foot states and deliberate stance ownership.
- [Lugaru combat](https://github.com/WolfireGames/lugaru/blob/master/Source/Objects/Person.cpp): corresponding attack/reaction phases; PolyFighter continues to use one gameplay event timeline rather than introducing a second animation clock.

No game models, animation files or code from these projects are bundled here.
Existing Quaternius assets keep their existing notices. The old imported-leg
preservation constraint is replaced by geometry checks on both real skeletons:
constant bone lengths, planted toe, flat support sole, contact knee extension,
visible pre-contact chamber and post-contact retraction, ankle continuity and
common guard endpoints. The WebGL kick audit also checks consecutive kicks and
the corrections-off and corrections-on presentation paths.
