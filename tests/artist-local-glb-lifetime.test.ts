import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { artistSourceLifetime, leaseLocalArtistGlbSource } from "../src/game/artist-local-glb-lifetime";
import { ArtistFrameTimingSampler } from "../src/game/artist-frame-timing";

test("local GLB lease destroys shared texture, material, geometry exactly once and closes bitmaps", () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const texture = new THREE.Texture();
  let closed = 0;
  texture.image = { close() { closed++; } };
  const material = new THREE.MeshStandardMaterial({ map: texture });
  root.add(new THREE.Mesh(geometry, material));
  root.add(new THREE.Mesh(geometry, material));
  let g = 0, m = 0, t = 0;
  geometry.addEventListener("dispose", () => { g++; });
  material.addEventListener("dispose", () => { m++; });
  texture.addEventListener("dispose", () => { t++; });
  const baseline = artistSourceLifetime();
  const release = leaseLocalArtistGlbSource(root);
  const active = artistSourceLifetime();
  assert.equal(active.loaded, baseline.loaded + 1);
  assert.equal(active.active, baseline.active + 1);
  release();
  release();
  assert.deepEqual([g, m, t, closed], [1, 1, 1, 1]);
  assert.equal(root.children.length, 0);
  const after = artistSourceLifetime();
  assert.equal(after.active, baseline.active);
  assert.equal(after.released, baseline.released + 1);
  assert.equal(after.geometriesDisposed, baseline.geometriesDisposed + 1);
  assert.equal(after.materialsDisposed, baseline.materialsDisposed + 1);
  assert.equal(after.texturesDisposed, baseline.texturesDisposed + 1);
  assert.equal(after.imageBitmapsClosed, baseline.imageBitmapsClosed + 1);
});

test("local GLB lease handles unique meshes and shared materials without double disposal", () => {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const a = new THREE.BufferGeometry();
  const b = new THREE.BufferGeometry();
  root.add(new THREE.Mesh(a, material), new THREE.Mesh(b, material));
  let disposedMaterial = 0;
  material.addEventListener("dispose", () => { disposedMaterial++; });
  const release = leaseLocalArtistGlbSource(root);
  release();
  assert.equal(disposedMaterial, 1);
  assert.equal(root.children.length, 0);
});

test("RAF sampler provides bounded p95 and slow-frame evidence without considering background suspension", () => {
  const sampler = new ArtistFrameTimingSampler();
  assert.equal(sampler.snapshot().samples, 0);
  sampler.record(100, true);
  for (let i = 1; i <= 250; i++) {
    sampler.record(100 + i * 16, true);
  }
  let metrics = sampler.snapshot();
  assert.equal(metrics.samples, 240);
  assert.equal(metrics.medianMs, 16);
  assert.equal(metrics.p95Ms, 16);
  assert.equal(metrics.over20msPercent, 0);
  sampler.record(100 + 250 * 16 + 120, true);
  metrics = sampler.snapshot();
  assert.ok(metrics.maxMs >= 120);
  assert.ok(metrics.over20msPercent > 0);
  sampler.record(100_000, false);
  sampler.record(101_000, true);
  metrics = sampler.snapshot();
  assert.equal(metrics.suspendedFrames, 0);
  sampler.record(104_000, true);
  assert.equal(sampler.snapshot().suspendedFrames, 1);
});

test("RAF timing is invariant to absolute timestamps, not just started at zero", () => {
  const sampler = new ArtistFrameTimingSampler();
  sampler.record(10_000);
  sampler.record(10_010);
  sampler.record(10_040);
  sampler.record(10_065);
  const result = sampler.snapshot();
  assert.deepEqual({samples:result.samples, median:result.medianMs, p95:result.p95Ms},
    {samples:3, median:25, p95:30});
});
