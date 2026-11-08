# SERA — Real art candidates and rejection history
Checked 2026-11-09 JST. This is an **asset procurement** document, not
evidence that SERA is complete. No purchase or artist commission placed.

## 0. PRIORITY TO EVALUATE ON iPHONE: EMA — independent game artist source, CC0 claim
- Original source: https://theunseenvulga.itch.io/3d-character-riggedema
- Author: THEUNSEENVULGA. Author describes an actually hand-authored
  former game character, **not** MakeHuman-based procedural model.
- Download listed as free/name-your-price; press `Download Now`, then
  `No thanks, just take me to the downloads`, and select `EMA.glb`.
- File size: **7.8 MB** (suitable for iPhone on-device trial), FBX 5.3 MB.
  Author states about **76k triangles**, rigged/Mixamo-ready, hand-painted.
- Author declares **CC0 free personal + commercial use and modification**.
  Confirm original full rights and source asset provenance; sale of unchanged
  files is explicitly discouraged. Not purchased or downloaded into project.
- State: **NEEDS REAL FACE/HAIR/COSTUME VISUAL REVIEW**. Do not claim art
  quality from author metadata. Use iPhone ARTIST ASSET LAB / GLB and inspect
  frontal face, 3/4 face, hair profile, outfit seams and a crouch/kick.
  Has not been approved as SERA, and cannot replace SERA without major
  original face/blue-black martial outfit changes.
- If acceptable, next step is sculpted face + outfit commission against
  actual editable original FBX/Blender sources, and separate gameplay rig QA.

## 0b. RESTRICTED: Renderpeople Sophia (free, photoreal human)
- Original publisher: https://renderpeople.com/free-3d-people/
- Official terms: https://renderpeople.com/general-terms-and-conditions/
- Section 4.1 explicitly permits commercial games, BUT section 4.3(b)
  prohibits making 3D data easily extractable or downloadable by end users.
- A public PolyFighter URL that directly serves the .glb could violate
  that condition. **Do not use as downloadable browser character** without
  express separate written authorization. Third-party mirroring on GitHub
  does not override the upstream publisher's terms.
- Technical or portrait comparison alone is not approval for final
  use. This is a license rejection, independent of art quality.

## 1. PURCHASE-ONLY, RIGHTS TO BE CONFIRMED: Pradipta Female Base Full Rig
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
- Marketplace rights are not assumed to cover a directly downloadable browser GLB. Obtain a **separate explicit web-delivery grant** before buying or integrating.

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
