import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
for (const variant of ["male", "female"]) {
  const bytes = readFileSync("public/models/quaternius/ubc-superhero-" + variant + "-flat.glb");
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const root = gltf.scene;
  root.updateWorldMatrix(true, true);
  const nodes = [];
  root.traverse((node) => {
    if (/(?:hand|thumb|index|middle|ring|pinky|little)_/i.test(node.name)) {
      const pos = node.getWorldPosition(new THREE.Vector3());
      const quat = node.getWorldQuaternion(new THREE.Quaternion());
      nodes.push({
        name: node.name,
        parent: node.parent?.name ?? null,
        children: node.children.map(x=>x.name),
        local: node.position.toArray().map(n=>+n.toFixed(4)),
        world: pos.toArray().map(n=>+n.toFixed(4)),
        bindQuat: quat.toArray().map(n=>+n.toFixed(4)),
      });
    }
  });
  const skinned=[];
  root.traverse((node)=>{
    if(node.isSkinnedMesh)skinned.push({name:node.name,bones:node.skeleton.bones.filter(x=>/(?:thumb|index|middle|ring|pinky|little)_/i.test(x.name)).map(x=>x.name)});
  });
  console.log("CMU_FINGER_RIG",JSON.stringify({variant,nodes,skinned}));
}
