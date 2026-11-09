# SERA — Professional Character Commission / 3D Artist Handoff

Status: **Art procurement / NOT an accepted model**.
Reference: \`public/reference/female-turnaround.jpeg\`.
Game: PolyFighter, third-person / virtual-fighter style fighting game,
Three.js/WebGL iPhone Safari 60fps target.

## Actual source-image art direction — corrected from V2/V3

The original `public/reference/female-turnaround.jpeg` is a *purposeful
high-end FACETED, low-poly-style female fighter*. Do **not** substitute
a generic photoreal MakeHuman face, elderly scan, super-real skin or a
cartoonish Blender Rain look simply because those are available. Commercial
quality means **precision matching SERA's stylized identity**, not maximal
poly count or photoreal materials.

Verified crop-only, same-character sources for multi-view reconstruction:

- `docs/sera-generation-input/front.png` — original front design
- `docs/sera-generation-input/three-quarter.png` — same authored 3/4 design
- `docs/sera-generation-input/side.png` — real ear/jaw/ponytail silhouette
- `docs/sera-generation-input/back.png` — ponytail attachment / cape design
- `docs/sera-generation-input/manifest.json` — SHA-256 provenance

Art priorities directly supported by those four views:

1. **Face**: wide sharp angular brows, narrow almond eyes, planar cheek/jaw
   transitions, confident expression, defined nose bridge; avoid doll eyes,
   uniform MakeHuman smoothing or rounded cartoon face.
2. **Hair**: high black ponytail with large **tapered sculpted masses**, clean
   tied-root geometry and defined face-framing locks. No spaghetti strands,
   cylindrical tubes, comb teeth or round plastic hair cap.
3. **Suit**: cobalt-blue raised collar + vest over black cropped armor,
   purposeful exposed midriff, asymmetrical blue waist tabard, black
   leggings, blue/black angular shin boots. Two elongated light silver
   guards along the forearms. Build every part as designed costume topology,
   not generic boxes glued to a source figure.
4. **Surface**: planar facets as a design language. Preserve believable
   curvature/anatomy at movable joints and a readable head. Use controlled
   shading (facets on armor, selective smoothness on skin) instead of
   uniform faceted normals or glossy everywhere.
5. **Performance**: original reference says approximately 11.5k polygons
   and 1.68 m height. This is a *source-art target*, not a license to drop
   facial fidelity below the reference. Aim 30–55k triangles after measured
   mobile retopo, with authentic texture details rather than high noise.

Face/head/ponytail still-frame quality **must pass in front, 3/4 and
profile views** BEFORE facial retargeting or armor detailing. No automated
polygon or color change can substitute for sculpt design acceptance.

## Director's brief (Japanese)

SERAを「市販格闘ゲームの主役として成立する」品質で造形する。
MakeHuman風の汎用顔、筒状の髪、四角い装甲、カラーパーツの追加だけで
独自性を表すデザインは不採用。顔・頭髪・衣装の一体的な美術設計を重視する。

- 顔: 元のSERA設定画の顔を最優先。目、まぶた、鼻、口唇、顎、
  頬骨の平面を専門的に造形。肌は皮膚らしいラフネス変化を持つ。
  無表情、睨み、笑み、被弾、攻撃集中の表情を持つ。
- 髪: 濃い黒〜青黒の高いポニーテール、顔周りの自然な束、分け目と生え際。
  立体的なヘアカード/束メッシュ、綺麗な毛先、格闘モーションで破綻しない。
  針/筒/一本ずつの丸棒のように見える毛束は不可。
- 衣装: 黒＋深いコバルトのオリジナル格闘衣装。
  体の動きに沿う布・パターン・縫い目、独立した装甲とグローブ、
  非対称の腰布、膝関節周囲の正しいクリアランス。
  身体を貫通する浮いた装甲、板、単色スポーツウェアは不可。
- シルエット: 引いた戦闘カメラでもSERAと分かる非対称デザイン。
  顔アップ・遠距離の両方を必ず評価。

## Approval gates — pass in order

1. **Pre-production**: 3 orthographic body drawings (front/side/back) +
   3/4 full body + facial expression sheet. Artist shall get visual approval
   BEFORE any detailed sculpting, else avoid rework.
2. **Beauty sculpt**: real face, bangs, tied hair, 100% authored costume.
   Static, no game rig. Quality must already exceed SERA V2/V3.
3. **Retopo/UV/PBR**: 2D texture atlas, normal map and roughness maps for
   skin, hair, fabric, armor and boots; physically distinct material response.
4. **Motion-ready**: skeleton with compatible named deform joints, weights
   for body/hair/garments, shape keys. No disconnected arm or shoulder pads.
5. **Deformation test**: guard, jab, cross, high kick, low kick, crouch,
   air kick, hit, knockdown; examine intersections in front/side/back.
6. **Runtime**: render in the actual Three.js in-app ARTIST ASSET LAB and
   preserve facial quality at gameplay distance. Profile on TWO iPhone
   fighters with scenery/VFX aiming for stable 60fps and acceptable memory.

## Deliverable files

- \`sera-production.blend\` with organized objects, base mesh, costume, hair,
  weight painting, armature, source image textures and custom shape keys.
- \`sera-production.glb\` glTF 2.0, Y up, +Z forward or clearly documented
  transform, bind-pose skeleton, real packed textures, no external dependencies.
- Optional FBX if needed for retarget/debug; .blend should be authoritative.
- Color/normal/roughness/metallic/ambient-occlusion baked texture maps;
  no purely material-parameter mockup passed as fully textured artwork.
- LOD0/LOD1/LOD2 or demonstrably measured efficient in-game solution.
- A-pose/T-pose; recorded bone names and rest transforms;
  facial expressions using blend shapes (or compatible bone-driven rig).
- 6 images: front / 3/4 / side / back / face closeup / garment closeup;
  8 motion-pose captures from the same actual model.
- Provenance and license/commission contract:
  **commercial game use, derivatives, distribution of game binaries,
  redistribution inside browser-delivered downloadable GLBs** expressly
  permitted. Web games inherently allow model bytes to be extracted by
  players. Third-party asset-store terms often differ from CC0.

## Preliminary mobile size envelope (not a replacement for profiler)

- Full-res hero ~30k–55k triangles target, up to ~100k in portrait-only
  quality when justified. Avoid thousands of tiny separate draw calls.
- Prefer ~1K–2K atlases with full-res face prioritized. Use glTF
  KTX2/BasisU after testing decoder support, and Meshopt as appropriate.
- Idle + combat update budget to be measured with two simultaneous skinned
  rigs and arena effects on iPhone Safari. Protect 60fps over pure polygon
  count or high-resolution textures. Capture memory and performance.
- A single good-looking model is enough to pass art direction; don't
  bulk generate the entire cast until SERA is accepted.

## Ownership and delivery

- The artist must identify every source asset, texture, sculpt base,
  stock scan, model or kit used. Reject missing provenance or uncertain
  source ownership. A paid license for a raw 3D asset does not necessarily
  include permission to host and redistribute its original files on GitHub.
- PR artifacts and browser model intake are REVIEW ONLY. Approval.json
  requires exact GLB hash and separate human review of visual quality
  and real mobile performance; no automated art score approves a model.
