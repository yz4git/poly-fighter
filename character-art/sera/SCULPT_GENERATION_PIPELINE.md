# SERA — Four-view to actual 3D sculpt, quality-first workflow

Status: original four reference PNGs DONE, real new sculpt NOT YET generated.

## Source images ready

Actual original reference is `public/reference/female-turnaround.jpeg`.
`docs/sera-generation-input/` contains crop-only, non-imagined PNGs,
640 × 1280 each: `front.png`, `three-quarter.png`, `side.png`,
`back.png`, plus source-image SHA-256 manifest. The four views are
not independent camera renders of a 3D mesh; they are the user's original
consistent design art.

## Select sculpt topology BEFORE rigging

First generate **one unrigged high-quality character sculpt** from the
original images. Original objective: an angular stylized high-quality
low-poly look. Do NOT automatically reuse an elderly scanned person or
another unrelated realistic face, nor recreate the V2/V3 armor cylinders.

Potential 2026 generation sources:
- Tripo H3.1 `v3.1-20260211`, multiview image-to-3D. Supports multiple
  face/side/back images, PBR and UV, detailed geometry.
  Docs: https://developers.tripo3d.ai/en/docs/generation-multiview-to-model/standard
- fal 3D app can provide Tripo, Meshy, Hunyuan image-to-3D models once
  connected/authorized. Not connected/charged by this repository.
- Meshy v6 image-to-3D can optionally auto-rig later; separate visual
  approval is still required, especially around eyelids and hair roots.
  Docs: https://fal.ai/models/fal-ai/meshy/v6/image-to-3d/api

Do NOT pass the three-quarter view as a Tripo `left` or `right` view:
the Tripo API explicitly uses cardinal `front,left,back,right` keys.
Use front+back first. Add `side.png` only after validating whether it
represents `left` or `right` camera placement. A diagonal image passed as
an exact side confuses geometry. The original 3/4 view is for verification.

**No external generated 3D assets have been bought or generated here.**
Paid API calls require the account owner's authorization or connection.
Do not commit API keys, purchased meshes or copyrighted scans to GitHub.

## The first test is visual, not technical

1. Load unrigged output (GLB <=80MiB, <=400k triangles) in PolyFighter
   MODEL VIEW > ARTIST ASSET LAB; use fixed FRONT/3/4/SIDE/BACK/FACE/OUTFIT.
   The technical report must read `VISUAL_ONLY` and disable combat test.
2. Save real face, profile, hairstyle and outfit screenshots. Compare them
   with the four original reference PNGs; focus eyes, jaw, collar, hair
   attachment, silver forearm guards and blue asymmetrical tabard.
3. Reject artifacts: doubled faces, missing hair behind ears, melted
   fingers, flat card ponytail, disconnected sleeves, painted-on clothing.
   The model is NOT improved merely by adding detail to these flaws.
4. For accepted appearance only: manually sculpt/repair mesh, sculpt
   hair and garments from actual geometry; bake UV/PBR, retopologize game
   topology (<=110k triangle intake, <=32MiB for the combat sample).
5. Rig with Mixamo-style 20 mandatory bones or retargeted game skeleton.
   The test then exposes `TEST REAL PUNCH / KICK` to apply actual combat
   clips, not an invented idle motion.
6. After pose QA and human art approval, check two-fighter 60fps on actual
   iPhone. No CI screenshot or generated screenshot certifies art quality.

## Released? No.

Until every visual criterion and the rig/motion/iPhone checks pass, keep
the new 3D candidate OUT of `public/models/hero/` and the playable game
selection. Publish only screenshots in the draft PR where allowed.
