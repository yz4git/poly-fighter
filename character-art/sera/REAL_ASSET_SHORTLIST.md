# SERA — Real art candidates and rejection history
Checked 2026-11-09 JST. This is an **asset procurement** document, not
evidence that SERA is complete. No purchase or artist commission placed.

## 1. RECOMMENDED FACE/BODY START: Pradipta Female Base Full Rig
- Creator/store: https://www.renderhub.com/pradipta/female-base-full-rig
- Listed price: $20 USD (check current price at purchase).
- Listed rights: RenderHub Extended Use License; commercial use supported.
  Verify the detailed agreement for derivative costume/face modifications,
  browser-delivered GLB, packaging rules and attribution before checkout.
- Source: .blend/.fbx/.ma/.obj/.uasset. PBR textures. Rigged.
- Listed 36,658 polygons and 40,834 vertices, 19 texture files.
- Preview: well-defined actual face, eyebrows, lips, lashes, coherent tied
  hair and skin tones. More compatible with SERA's semi-realistic direction
  than generative MakeHuman or Attractor Mechanic.
- **NOT a finished SERA**. Must author SERA-specific original cobalt/black
  martial-tech uniform and long dark high ponytail; refine face to match the
  existing SERA original 4-view reference. Full asset may be >800MB and body
  textures are 8K — downsample and bake to mobile PBR, retopologize as
  needed, and retarget.
- No raw paid model files in this public repository without a grant. Paid
  item has NOT been purchased by the assistant.

## 2. ALTERNATIVE: Devall Assets Diverse Rigged Character Pack Vol. 1
- Source: https://devallassets.itch.io/diverse-rigged-character-pack-vol-1-9-game-ready-humans
- Listed price $19.99 USD.
- Seller advertises CC0. Each of 9 characters has GLB + Blender source,
  53-bone rig, 15–22k vertices, PBR maps. Verify the exact purchased
  content, rights and style before use.
- Downsides: generic casual outfits and uncertain distinctiveness of face.
  Source purchase is required; no SERA visual proof yet.

## 3. STYLE/TECH REFERENCE ONLY: Blender Studio Rain v3
- https://studio.blender.org/characters/rain/v3/
- CC-BY licensed, stylized high-quality facial controls / hair and rig.
- Does NOT look like SERA; should NOT be silently shipped or cloned.

## 4. REJECTED: VideoIntoBlenderModel / Attractor Mechanic (CC0 claimed)
- Source: https://github.com/s0ck3t/VideoIntoBlenderModel
- Pinned commit: c1f1fa8f01524d60197c4d65306349e266d339cb
- Author's asset manifest claims CC0 for the model (independently confirm
  provenance for any production use).
- Actual Blender import/export + fixed Y-up conversion and six genuine
  perspective views: GitHub Actions 42500874824.
- Data: 63,995 polygon faces, 52 facial shape keys, 4K atlas, valid skinned
  source. Unoptimized GLB output **137,950,672 bytes (~132 MiB)**. It is
  NOT within the mobile lab <=32 MiB hard cap.
- Actual visual inspection: exaggerated bulging circular eyes, rough face
  texture, polygonally spiked ponytail and busy mechanic outfit. Costume
  topology is coherent, but face/hair aesthetics are unacceptable for SERA.
- **REJECTED** as a candidate SERA or final art baseline. Keep this source
  only as a technical example of an intact, rigged independent sculpt
  (better technical geometry cannot replace high-quality art direction).
- No automatic copy to public/models/hero. Images from real Blender
  3D are available in the referenced Actions run artifact.

## Non-negotiable acceptance

1. New portrait must pass face/hair art review at native game camera and
   close-up BEFORE further programming or mesh optimization.
2. Request permission for source/commission work, derivatives, game
   distribution and browser-exposed 3D files. Avoid unlicensed stock scans.
3. Confirm 3D model is an actual editable deliverable with independent
   fit-to-body costume, realistic facial planes and controllable hair,
   not a marketing render, 2D image or procedural box/pipe construction.
4. Then rig, retarget to PolyFighter, bake/atlas, enforce measured 60fps on
   actual iPhone with both skinned fighters. Keep old game as fallback.
